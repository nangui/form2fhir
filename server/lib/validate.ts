import type { ValidationIssue } from '../../shared/types'
import { ServiceUnavailableError } from './errors'
import { type HttpOptions, requestSignal } from './http'

export interface ValidationResult {
  valid: boolean
  issues: ValidationIssue[]
}

const LOINC_SYSTEM = 'http://loinc.org'
// Any other spelling of the LOINC system must not slip past the allowlist.
const LOINC_SYSTEM_PATTERN = /loinc\.org|^urn:oid:2\.16\.840\.1\.113883\.6\.1$/i
// rendering-xhtml, rendering-markdown, rendering-style…: all can smuggle markup into the preview.
const RENDERING_EXTENSION = 'http://hl7.org/fhir/StructureDefinition/rendering-'
// $validate answers 200 for valid/invalid resources and 400/422 when it can't process them, always
// with an OperationOutcome. Anything else (401, 404, 429, 5xx…) is not a validation result.
const VALIDATION_STATUSES = [200, 400, 422]
const STATUSES = ['draft', 'active', 'retired', 'unknown']
const ITEM_TYPES = [
  'group', 'display', 'boolean', 'decimal', 'integer', 'date', 'dateTime', 'time',
  'string', 'text', 'url', 'choice', 'open-choice', 'attachment', 'reference', 'quantity'
]

/**
 * Local checks first, then HAPI `$validate`. Both always run (unless the value is not even a
 * Questionnaire) so the model gets every error at once: Claude iterations are the scarce resource.
 */
export async function validateQuestionnaire(
  questionnaire: unknown,
  allowedCodes: ReadonlySet<string>,
  options: HttpOptions
): Promise<ValidationResult> {
  const local = checkQuestionnaire(questionnaire, allowedCodes)
  const hapi = isQuestionnaire(questionnaire) ? await validateWithHapi(questionnaire, options) : []
  const issues = [...local, ...hapi]
  return { valid: !issues.some(issue => issue.severity === 'error'), issues }
}

/** Checks HAPI can't do for us: LOINC allowlist, usable choice items, no HTML, precise linkId errors. */
export function checkQuestionnaire(questionnaire: unknown, allowedCodes: ReadonlySet<string>): ValidationIssue[] {
  if (!isQuestionnaire(questionnaire)) {
    return [localError('The submitted value must be a FHIR Questionnaire object (resourceType "Questionnaire").')]
  }

  const issues: ValidationIssue[] = []
  if (!STATUSES.includes(questionnaire.status as string)) {
    issues.push(localError(`status must be one of ${STATUSES.join(', ')}.`, 'Questionnaire.status'))
  }
  if (!Array.isArray(questionnaire.item) || questionnaire.item.length === 0) {
    issues.push(localError('The Questionnaire must contain at least one item.', 'Questionnaire.item'))
  } else {
    checkItems(questionnaire.item, 'Questionnaire', new Set(), issues)
  }
  walk(questionnaire, 'Questionnaire', (node, path) => checkNode(node, path, allowedCodes, issues))
  return issues
}

export async function validateWithHapi(resource: unknown, options: HttpOptions): Promise<ValidationIssue[]> {
  const request = requestSignal(options, 20_000)
  const unavailable = new ServiceUnavailableError('validator', `The FHIR validator (${new URL(options.baseUrl).host}) did not respond. Try again in a minute.`)

  let response: Response
  try {
    response = await (options.fetch ?? fetch)(new URL(`${options.baseUrl}/Questionnaire/$validate`), {
      method: 'POST',
      headers: { 'content-type': 'application/fhir+json', 'accept': 'application/fhir+json' },
      body: JSON.stringify(resource),
      signal: request.signal
    })
  } catch (error) {
    if (request.callerAborted()) throw error
    throw unavailable
  }

  if (!VALIDATION_STATUSES.includes(response.status)) throw unavailable
  const body = await response.json().catch(() => undefined) as { resourceType?: unknown, issue?: unknown } | undefined
  if (body?.resourceType !== 'OperationOutcome' || !Array.isArray(body.issue)) throw unavailable
  return parseOperationOutcome(body)
}

export function parseOperationOutcome(outcome: unknown): ValidationIssue[] {
  const rawIssues = (outcome as { issue?: unknown }).issue
  if (!Array.isArray(rawIssues)) return []
  const seen = new Set<string>()
  const issues: ValidationIssue[] = []

  for (const raw of rawIssues as Record<string, unknown>[]) {
    const severity = raw.severity === 'fatal' || raw.severity === 'error' ? 'error' : raw.severity === 'warning' ? 'warning' : undefined
    if (!severity) continue
    const location = firstString(raw.expression) ?? firstString(raw.location)
    const message = String(raw.diagnostics ?? (raw.details as { text?: string } | undefined)?.text ?? 'Unknown validation issue')
    const key = `${severity}|${location}|${message}`
    if (seen.has(key)) continue
    seen.add(key)
    issues.push({ severity, source: 'hapi', message, ...(location ? { location } : {}) })
  }
  return issues
}

function checkItems(items: unknown[], parentPath: string, linkIds: Set<string>, issues: ValidationIssue[]) {
  items.forEach((raw, i) => {
    const path = `${parentPath}.item[${i}]`
    const item = (raw ?? {}) as Record<string, unknown>

    const linkId = typeof item.linkId === 'string' ? item.linkId.trim() : ''
    if (!linkId) {
      issues.push(localError('Every item needs a non-empty string linkId.', path))
    } else if (linkIds.has(linkId)) {
      issues.push(localError(`Duplicate linkId "${linkId}". linkIds must be unique in the whole Questionnaire.`, path))
    } else {
      linkIds.add(linkId)
    }

    if (!ITEM_TYPES.includes(item.type as string)) {
      issues.push(localError(`Unknown item type "${String(item.type)}". Use one of: ${ITEM_TYPES.join(', ')}.`, path))
    }
    // answerValueSet is not allowed: we can't verify LOINC answer-list IDs, and the preview can't
    // expand a value set without a terminology server. List the answers explicitly instead.
    if (item.answerValueSet !== undefined) {
      issues.push(localError(`Item "${linkId}" uses answerValueSet. List the answers in answerOption instead.`, path))
    } else if ((item.type === 'choice' || item.type === 'open-choice')
      && (!Array.isArray(item.answerOption) || item.answerOption.length === 0)) {
      issues.push(localError(`Choice item "${linkId}" needs a non-empty answerOption list.`, path))
    }
    if (Array.isArray(item.item)) checkItems(item.item, path, linkIds, issues)
  })
}

function checkNode(node: Record<string, unknown>, path: string, allowedCodes: ReadonlySet<string>, issues: ValidationIssue[]) {
  if (typeof node.system === 'string' && LOINC_SYSTEM_PATTERN.test(node.system)) {
    if (node.system !== LOINC_SYSTEM) {
      issues.push(localError(`Use exactly "${LOINC_SYSTEM}" as the LOINC system (got "${node.system}").`, path))
    }
    if (!allowedCodes.has(String(node.code))) {
      issues.push(localError(
        `LOINC code "${String(node.code)}" was not returned by search_loinc in this run. Search for it, or remove the code. Never invent LOINC codes.`,
        path
      ))
    }
  }
  if (typeof node.url === 'string' && node.url.startsWith(RENDERING_EXTENSION)) {
    issues.push(localError('Rendering extensions (xhtml, markdown, style) are not allowed. Use plain text.', path))
  }
}

function firstString(value: unknown): string | undefined {
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : undefined
}

/** Visits every object in the resource, with its FHIRPath-like location. */
function walk(value: unknown, path: string, visit: (node: Record<string, unknown>, path: string) => void) {
  if (Array.isArray(value)) {
    value.forEach((child, i) => walk(child, `${path}[${i}]`, visit))
  } else if (value && typeof value === 'object') {
    visit(value as Record<string, unknown>, path)
    for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`, visit)
  }
}

function isQuestionnaire(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && (value as { resourceType?: unknown }).resourceType === 'Questionnaire'
}

function localError(message: string, location?: string): ValidationIssue {
  return { severity: 'error', source: 'local', message, ...(location ? { location } : {}) }
}
