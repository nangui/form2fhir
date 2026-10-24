import type { ValidationIssue } from '../../shared/types'
import { ServiceUnavailableError } from './errors'
import { type HttpOptions, requestSignal } from './http'
import type { AnswerScore, SearchEvidence } from './loinc'

export interface ValidationResult {
  valid: boolean
  issues: ValidationIssue[]
}

/** A bare allowlist is still accepted: it simply has no scores or panels to check against. */
export type Evidence = ReadonlySet<string> | SearchEvidence

interface Panel {
  code: string
  members: ReadonlySet<string>
}

const LOINC_SYSTEM = 'http://loinc.org'
const ORDINAL_VALUE = 'http://hl7.org/fhir/StructureDefinition/ordinalValue'
// Renderers such as LHC-Forms also read these as answer scores: only ordinalValue is allowed.
const SCORE_EXTENSIONS = [
  ORDINAL_VALUE,
  'http://hl7.org/fhir/StructureDefinition/itemWeight',
  'http://hl7.org/fhir/StructureDefinition/questionnaire-ordinalValue',
  'http://hl7.org/fhir/StructureDefinition/iso21090-CO-value'
]
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
  evidence: Evidence,
  options: HttpOptions
): Promise<ValidationResult> {
  const local = checkQuestionnaire(questionnaire, evidence)
  const hapi = isQuestionnaire(questionnaire) ? await validateWithHapi(questionnaire, options) : []
  const issues = [...local, ...hapi]
  return { valid: !issues.some(issue => issue.severity === 'error'), issues }
}

/**
 * Checks HAPI can't do for us: LOINC allowlist, answer scores carried as ordinalValue, items that
 * stray from their declared panel (warning), usable choice items, no HTML, precise linkId errors.
 */
export function checkQuestionnaire(questionnaire: unknown, rawEvidence: Evidence): ValidationIssue[] {
  if (!isQuestionnaire(questionnaire)) {
    return [localError('The submitted value must be a FHIR Questionnaire object (resourceType "Questionnaire").')]
  }

  const evidence = toEvidence(rawEvidence)
  const issues: ValidationIssue[] = []
  if (!STATUSES.includes(questionnaire.status as string)) {
    issues.push(localError(`status must be one of ${STATUSES.join(', ')}.`, 'Questionnaire.status'))
  }
  if (!Array.isArray(questionnaire.item) || questionnaire.item.length === 0) {
    issues.push(localError('The Questionnaire must contain at least one item.', 'Questionnaire.item'))
  } else {
    const panel = findPanel(questionnaire.code, evidence)
    checkItems(questionnaire.item, 'Questionnaire', { linkIds: new Set(), evidence, panel }, issues)
  }
  walk(questionnaire, 'Questionnaire', (node, path) => checkNode(node, path, evidence.codes, issues))
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

interface ItemContext {
  linkIds: Set<string>
  evidence: SearchEvidence
  /** The panel declared by the nearest coded ancestor (or the Questionnaire), if search_loinc returned it. */
  panel?: Panel
}

function checkItems(items: unknown[], parentPath: string, context: ItemContext, issues: ValidationIssue[]) {
  items.forEach((raw, i) => {
    const path = `${parentPath}.item[${i}]`
    const item = (raw ?? {}) as Record<string, unknown>

    const linkId = typeof item.linkId === 'string' ? item.linkId.trim() : ''
    if (!linkId) {
      issues.push(localError('Every item needs a non-empty string linkId.', path))
    } else if (context.linkIds.has(linkId)) {
      issues.push(localError(`Duplicate linkId "${linkId}". linkIds must be unique in the whole Questionnaire.`, path))
    } else {
      context.linkIds.add(linkId)
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
    if (Array.isArray(item.answerOption)) {
      const scores = loincCodes(item.code).map(code => context.evidence.answerScores.get(code)).find(Boolean)
      checkAnswerWeights(item.answerOption, linkId, path, scores, issues)
    }

    const ownPanel = findPanel(item.code, context.evidence)
    if (!ownPanel && context.panel) checkPanelMembership(item.code, context.panel, path, issues)
    if (Array.isArray(item.item)) checkItems(item.item, path, { ...context, panel: ownPanel ?? context.panel }, issues)
  })
}

/**
 * Scored scales (PHQ-9, AUDIT-C…) are only usable if each answer carries its weight. The LOINC
 * scores of the item's own question are checked exactly. Otherwise a partially weighted list is a
 * mistake; but when LOINC scores the question, only its scored answers must be weighted ("Don't
 * know", or a form-specific "Prefer not to say", may stay unweighted).
 */
function checkAnswerWeights(
  options: unknown[],
  linkId: string,
  path: string,
  scores: ReadonlyMap<string, AnswerScore> | undefined,
  issues: ValidationIssue[]
) {
  let coded = 0
  let weighted = 0
  options.forEach((raw, i) => {
    const option = (raw ?? {}) as Record<string, unknown>
    const coding = option.valueCoding as Record<string, unknown> | undefined
    const optionPath = `${path}.answerOption[${i}]`
    const scoreUrls = [...scoreExtensionUrls(option), ...(coding && typeof coding === 'object' ? scoreExtensionUrls(coding) : [])]
    if (scoreUrls.some(url => url !== ORDINAL_VALUE)) {
      issues.push(localError(`Give answer scores only with the ${ORDINAL_VALUE} extension.`, optionPath))
    } else if (scoreUrls.length > 1) {
      issues.push(localError('An answer must carry at most one ordinalValue.', optionPath))
    }
    if (!coding || typeof coding !== 'object') return
    const weight = ordinalValue(option) ?? ordinalValue(coding)
    const score = coding.system === LOINC_SYSTEM ? scores?.get(String(coding.code)) : undefined
    if (scores ? typeof score === 'number' || score === 'disputed' : true) {
      coded++
      if (weight) weighted++
    }
    if (weight && typeof weight.valueDecimal !== 'number') {
      issues.push(localError('The ordinalValue of an answer must be a number in valueDecimal.', optionPath))
      return
    }
    if (score === undefined || score === null) return
    const label = `Answer "${String(coding.code)}" (${String(coding.display ?? '')})`
    if (score === 'disputed') {
      issues.push(localError(`${label}: LOINC sources give different scores for this answer to this question, so its score cannot be verified. Leave this answer's code out (use valueString), or leave the item uncoded.`, optionPath))
      return
    }
    if (!weight) {
      issues.push(localError(`${label} has LOINC score ${score}: add it as an ordinalValue extension with valueDecimal ${score}.`, optionPath))
    } else if (weight.valueDecimal !== score) {
      issues.push(localError(`${label} has ordinalValue ${String(weight.valueDecimal)}, but its LOINC score is ${score}.`, optionPath))
    }
  })
  if (weighted > 0 && weighted < coded) {
    issues.push(localError(`Item "${linkId}": either every coded answer carries an ordinalValue or none does (${weighted} of ${coded} do).`, path))
  }
}

function scoreExtensionUrls(element: Record<string, unknown>): string[] {
  const extensions = Array.isArray(element.extension) ? element.extension as Record<string, unknown>[] : []
  return extensions.map(extension => String(extension?.url)).filter(url => SCORE_EXTENSIONS.includes(url))
}

function ordinalValue(element: Record<string, unknown>): Record<string, unknown> | undefined {
  const extensions = Array.isArray(element.extension) ? element.extension as Record<string, unknown>[] : []
  return extensions.find(extension => extension?.url === ORDINAL_VALUE)
}

/**
 * A warning only: NLM's form definitions are not exhaustive (AUDIT-C lists 68517-2 where the
 * printed form asks 68518-0), so a stray code deserves a second look, not a rejection.
 */
function checkPanelMembership(code: unknown, panel: Panel, path: string, issues: ValidationIssue[]) {
  for (const loincCode of loincCodes(code)) {
    if (panel.members.has(loincCode)) continue
    issues.push({
      severity: 'warning',
      source: 'local',
      message: `LOINC code ${loincCode} is not one of the official questions of panel ${panel.code}. Check whether the panel has its own code for this question.`,
      location: path
    })
  }
}

function findPanel(code: unknown, evidence: SearchEvidence): Panel | undefined {
  for (const loincCode of loincCodes(code)) {
    const members = evidence.panels.get(loincCode)
    if (members) return { code: loincCode, members }
  }
  return undefined
}

function loincCodes(code: unknown): string[] {
  if (!Array.isArray(code)) return []
  return (code as Record<string, unknown>[])
    .filter(coding => coding?.system === LOINC_SYSTEM && typeof coding.code === 'string')
    .map(coding => coding.code as string)
}

function toEvidence(evidence: Evidence): SearchEvidence {
  if ('codes' in evidence) return evidence
  return { codes: new Set(evidence), answerScores: new Map(), panels: new Map() }
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
