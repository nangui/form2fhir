import { describe, expect, it } from 'vitest'
import { itemSources } from './sources'

const Q = {
  resourceType: 'Questionnaire',
  item: [
    { linkId: 'vitals', type: 'group', text: 'Vital signs', item: [{ linkId: 'hr', type: 'decimal', text: 'Heart rate' }] },
    { linkId: 'smoker', type: 'boolean', text: 'Smoker?' }
  ]
}
const TEXT = { kind: 'text' as const, text: 'VITAL SIGNS\nHeart   rate: ____ /min\nSmoker?  [ ] Yes [ ] No' }

describe('itemSources', () => {
  it('keeps one excerpt per item, in item order, and checks it against pasted text', () => {
    const sources = itemSources({ smoker: 'Smoker? [ ] Yes [ ] No', hr: 'Heart rate: ____ /min', vitals: 'VITAL SIGNS' }, Q, TEXT)

    expect(sources).toEqual([
      { linkId: 'vitals', excerpt: 'VITAL SIGNS', found: true },
      { linkId: 'hr', excerpt: 'Heart rate: ____ /min', found: true },
      { linkId: 'smoker', excerpt: 'Smoker? [ ] Yes [ ] No', found: true }
    ])
  })

  it('flags an excerpt that is not in the pasted text, ignoring case and spacing only', () => {
    const [hr] = itemSources({ hr: 'Pulse rate' }, Q, TEXT)
    expect(hr).toEqual({ linkId: 'hr', excerpt: 'Pulse rate', found: false })
    expect(itemSources({ hr: 'heart RATE' }, Q, TEXT)[0]!.found).toBe(true)
  })

  it('cannot check a PDF or an image', () => {
    expect(itemSources({ hr: 'Heart rate' }, Q, { kind: 'pdf', data: Buffer.from('') })).toEqual([{ linkId: 'hr', excerpt: 'Heart rate', found: null }])
  })

  it('drops unknown linkIds, non-strings, blanks and anything that is not an object, and caps the length', () => {
    expect(itemSources({ nope: 'x', hr: 42, smoker: '   ' }, Q, TEXT)).toEqual([])
    expect(itemSources('Heart rate', Q, TEXT)).toEqual([])
    expect(itemSources(undefined, Q, TEXT)).toEqual([])
    expect(itemSources({ hr: 'a'.repeat(1000) }, Q, TEXT)[0]!.excerpt).toHaveLength(300)
  })
})
