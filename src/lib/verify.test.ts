import { describe, expect, it } from 'vitest'
import type { ExperimentRecord } from './schema'
import {
  checkGrounding,
  extractNumbers,
  findMissingFields,
  parseRecord,
  verifyRecord,
} from './verify'

const NOTE =
  'We poured 500 ml of muddy water through sand, gravel and charcoal. ' +
  'After 12.5 minutes we collected 430 ml. The water looked clearer.'

const record = (overrides: Partial<ExperimentRecord> = {}): ExperimentRecord => ({
  experiment_title: 'Water filtration',
  materials: ['sand', 'gravel', 'charcoal'],
  observations: ['The water looked clearer'],
  measurements: [
    { quantity: 'water poured', value: 500, unit: 'ml' },
    { quantity: 'water collected', value: 430, unit: 'ml' },
  ],
  results: 'Collected 430 ml after 12.5 minutes',
  missing_information: [],
  ...overrides,
})

describe('parseRecord', () => {
  it('accepts a well-formed record', () => {
    expect(parseRecord(JSON.stringify(record()))).toEqual({ ok: true, record: record() })
  })

  it('rejects text that is not JSON', () => {
    expect(parseRecord('Here is your record: {...}')).toEqual({
      ok: false,
      errors: ['output is not valid JSON'],
    })
  })

  it('rejects JSON that is not an object', () => {
    expect(parseRecord('[]').ok).toBe(false)
    expect(parseRecord('null').ok).toBe(false)
  })

  it('reports every missing or mistyped field', () => {
    const result = parseRecord(JSON.stringify({ experiment_title: 7, materials: 'sand' }))
    expect(result).toEqual({
      ok: false,
      errors: [
        'experiment_title: expected a string',
        'results: expected a string',
        'materials: expected an array of strings',
        'observations: expected an array of strings',
        'missing_information: expected an array of strings',
        'measurements: expected an array',
      ],
    })
  })

  it('rejects a measurement whose value is a string', () => {
    const bad = { ...record(), measurements: [{ quantity: 'volume', value: '500', unit: 'ml' }] }
    expect(parseRecord(JSON.stringify(bad))).toEqual({
      ok: false,
      errors: ['measurements[0].value: expected a finite number'],
    })
  })

  it('rejects fields the schema does not define', () => {
    const bad = { ...record(), grade: 'A' }
    expect(parseRecord(JSON.stringify(bad))).toEqual({
      ok: false,
      errors: ['grade: unexpected field'],
    })
  })
})

describe('findMissingFields', () => {
  it('finds nothing missing in a complete record', () => {
    expect(findMissingFields(record())).toEqual([])
  })

  it('lists each empty field', () => {
    const empty = record({
      experiment_title: '  ',
      materials: [],
      observations: [''],
      measurements: [],
      results: '',
    })
    expect(findMissingFields(empty)).toEqual([
      'experiment_title',
      'materials',
      'observations',
      'measurements',
      'results',
    ])
  })

  it('ignores what the model says is missing', () => {
    expect(findMissingFields(record({ missing_information: ['temperature'] }))).toEqual([])
  })
})

describe('extractNumbers', () => {
  it('reads integers, decimals and thousands separators', () => {
    expect(extractNumbers('1,500 ml, then 12.5 min and .5 g')).toEqual([1500, 12.5, 0.5])
  })

  it('treats other commas as list separators', () => {
    expect(extractNumbers('trials 1,2,3')).toEqual([1, 2, 3])
  })

  it('returns nothing for text without digits', () => {
    expect(extractNumbers('three cups of water')).toEqual([])
  })
})

describe('checkGrounding', () => {
  it('passes when every number is in the note', () => {
    expect(checkGrounding(record(), NOTE)).toEqual([])
  })

  it('flags a measurement the note never mentions', () => {
    const invented = record({
      measurements: [{ quantity: 'pH', value: 7.2, unit: '' }],
    })
    expect(checkGrounding(invented, NOTE)).toEqual([{ path: 'measurements[0].value', value: 7.2 }])
  })

  it('flags numbers inside free-text fields', () => {
    const invented = record({ results: 'Turbidity dropped by 86 percent' })
    expect(checkGrounding(invented, NOTE)).toEqual([{ path: 'results', value: 86 }])
  })

  it('matches the same number written differently', () => {
    const rewritten = record({
      measurements: [{ quantity: 'time', value: 12.5, unit: 'min' }],
      results: 'Took 12.50 minutes',
    })
    expect(checkGrounding(rewritten, NOTE)).toEqual([])
  })

  it('flags every number when the note has none', () => {
    expect(checkGrounding(record(), 'The water looked clearer.')).toHaveLength(4)
  })
})

describe('verifyRecord', () => {
  it('skips content checks when the output does not parse', () => {
    expect(verifyRecord('not json', NOTE)).toEqual({
      parse: { ok: false, errors: ['output is not valid JSON'] },
      missingFields: [],
      ungrounded: [],
    })
  })

  it('runs all checks on a parsed record', () => {
    const raw = JSON.stringify(record({ results: '', observations: ['Lost 70 ml'] }))
    const result = verifyRecord(raw, NOTE)
    expect(result.parse.ok).toBe(true)
    expect(result.missingFields).toEqual(['results'])
    expect(result.ungrounded).toEqual([{ path: 'observations[0]', value: 70 }])
  })
})
