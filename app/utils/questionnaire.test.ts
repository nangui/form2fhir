import { describe, expect, it } from 'vitest'
import type { ValidationIssue } from '../../shared/types'
import { groupIssues, listCodes, loincCoverage } from './questionnaire'

const LOINC = 'http://loinc.org'
const questionnaire = {
  resourceType: 'Questionnaire',
  code: [{ system: LOINC, code: '44249-1', display: 'PHQ-9 panel' }],
  item: [
    { linkId: 'intro', type: 'display', text: 'Over the last 2 weeks…' },
    {
      linkId: 'g',
      type: 'group',
      text: 'Vitals',
      item: [
        { linkId: 'hr', type: 'integer', text: 'Heart rate', code: [{ system: LOINC, code: '8867-4', display: 'Heart rate' }] },
        { linkId: 'note', type: 'string', text: 'Notes' },
        { linkId: 'snomed', type: 'string', text: 'Other', code: [{ system: 'http://snomed.info/sct', code: '1' }] }
      ]
    }
  ]
}

describe('listCodes', () => {
  it('lists the panel code and every question with its LOINC code, if any', () => {
    expect(listCodes(questionnaire)).toEqual([
      { linkId: '(Questionnaire)', text: 'PHQ-9 panel', code: '44249-1', display: 'PHQ-9 panel' },
      { linkId: 'hr', text: 'Heart rate', code: '8867-4', display: 'Heart rate' },
      { linkId: 'note', text: 'Notes' },
      { linkId: 'snomed', text: 'Other' }
    ])
  })

  it('returns nothing for a value that is not a Questionnaire', () => {
    expect(listCodes('nope')).toEqual([])
  })
})

describe('loincCoverage', () => {
  it('counts coded question items, ignoring groups, display items and the panel code', () => {
    expect(loincCoverage(questionnaire)).toEqual({ coded: 1, total: 3 })
  })
})

describe('groupIssues', () => {
  it('collapses identical messages and keeps their locations, errors first', () => {
    const issues: ValidationIssue[] = [
      { severity: 'warning', source: 'hapi', message: 'code cannot be checked', location: 'Questionnaire.item[0].code[0]' },
      { severity: 'warning', source: 'hapi', message: 'code cannot be checked', location: 'Questionnaire.item[1].code[0]' },
      { severity: 'error', source: 'local', message: 'Duplicate linkId' }
    ]

    expect(groupIssues(issues)).toEqual([
      { severity: 'error', source: 'local', message: 'Duplicate linkId', count: 1, locations: [] },
      { severity: 'warning', source: 'hapi', message: 'code cannot be checked', count: 2, locations: ['Questionnaire.item[0].code[0]', 'Questionnaire.item[1].code[0]'] }
    ])
  })
})
