import type { ValidationIssue } from '../../shared/types'

const LOINC = 'http://loinc.org'

interface Coding { system?: string, code?: string, display?: string }
interface Item { linkId?: string, type?: string, text?: string, code?: Coding[], item?: Item[] }

export interface CodeRow {
  linkId: string
  text: string
  code?: string
  display?: string
}

export interface IssueGroup extends ValidationIssue {
  count: number
  locations: string[]
}

/** The panel code (if any), then every question item with its LOINC code. */
export function listCodes(questionnaire: unknown): CodeRow[] {
  if (!isQuestionnaire(questionnaire)) return []
  const rows: CodeRow[] = []
  const panel = loincCoding(questionnaire.code)
  if (panel) rows.push({ linkId: '(Questionnaire)', text: panel.display ?? '', code: panel.code, display: panel.display })
  for (const item of questions(questionnaire.item)) {
    const coding = loincCoding(item.code)
    rows.push({
      linkId: item.linkId ?? '',
      text: item.text ?? '',
      ...(coding ? { code: coding.code, display: coding.display } : {})
    })
  }
  return rows
}

/** Share of question items (not groups or display text) that carry a LOINC code. */
export function loincCoverage(questionnaire: unknown): { coded: number, total: number } {
  const items = isQuestionnaire(questionnaire) ? questions(questionnaire.item) : []
  return { coded: items.filter(item => loincCoding(item.code)).length, total: items.length }
}

/** Collapses repeated messages (e.g. 51 × "code cannot be checked") into one row, errors first. */
export function groupIssues(issues: ValidationIssue[]): IssueGroup[] {
  const groups = new Map<string, IssueGroup>()
  for (const issue of issues) {
    const key = `${issue.severity}|${issue.source}|${issue.message}`
    const group = groups.get(key) ?? { severity: issue.severity, source: issue.source, message: issue.message, count: 0, locations: [] }
    group.count++
    if (issue.location) group.locations.push(issue.location)
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => Number(a.severity === 'warning') - Number(b.severity === 'warning'))
}

function questions(items: Item[] | undefined): Item[] {
  return (items ?? []).flatMap(item => [
    ...(item.type === 'group' || item.type === 'display' ? [] : [item]),
    ...questions(item.item)
  ])
}

function loincCoding(codes: Coding[] | undefined): Coding | undefined {
  return Array.isArray(codes) ? codes.find(c => c.system === LOINC && c.code) : undefined
}

function isQuestionnaire(value: unknown): value is { code?: Coding[], item?: Item[] } {
  return !!value && typeof value === 'object' && (value as { resourceType?: unknown }).resourceType === 'Questionnaire'
}
