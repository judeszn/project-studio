import type { ExperimentRecord, Measurement } from './schema'

// Deterministic checks on model output. Nothing here calls a model, and every
// check fails closed: anything it cannot confirm is reported, never assumed OK.

export type ParseResult =
  | { ok: true; record: ExperimentRecord }
  | { ok: false; errors: string[] }

export interface UngroundedNumber {
  path: string
  value: number
}

export interface Verification {
  parse: ParseResult
  missingFields: string[]
  ungrounded: UngroundedNumber[]
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === 'string')

const RECORD_KEYS = [
  'experiment_title',
  'materials',
  'observations',
  'measurements',
  'results',
  'missing_information',
]
const MEASUREMENT_KEYS = ['quantity', 'value', 'unit']

function unknownKeys(obj: Record<string, unknown>, allowed: string[], at: string): string[] {
  return Object.keys(obj)
    .filter((k) => !allowed.includes(k))
    .map((k) => `${at}${k}: unexpected field`)
}

export function parseRecord(raw: string): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { ok: false, errors: ['output is not valid JSON'] }
  }
  if (!isObject(data)) return { ok: false, errors: ['output is not a JSON object'] }

  const errors = unknownKeys(data, RECORD_KEYS, '')
  for (const key of ['experiment_title', 'results']) {
    if (typeof data[key] !== 'string') errors.push(`${key}: expected a string`)
  }
  for (const key of ['materials', 'observations', 'missing_information']) {
    if (!isStringArray(data[key])) errors.push(`${key}: expected an array of strings`)
  }
  if (!Array.isArray(data.measurements)) {
    errors.push('measurements: expected an array')
  } else {
    data.measurements.forEach((m: unknown, i: number) => {
      const at = `measurements[${i}]`
      if (!isObject(m)) {
        errors.push(`${at}: expected an object`)
        return
      }
      errors.push(...unknownKeys(m, MEASUREMENT_KEYS, `${at}.`))
      if (typeof m.quantity !== 'string') errors.push(`${at}.quantity: expected a string`)
      if (typeof m.unit !== 'string') errors.push(`${at}.unit: expected a string`)
      if (typeof m.value !== 'number' || !Number.isFinite(m.value)) {
        errors.push(`${at}.value: expected a finite number`)
      }
    })
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, record: data as unknown as ExperimentRecord }
}

// The model's own `missing_information` list is deliberately not consulted:
// what is missing is decided here, from the record itself.
export function findMissingFields(record: ExperimentRecord): string[] {
  const missing: string[] = []
  if (record.experiment_title.trim() === '') missing.push('experiment_title')
  if (record.materials.every((s) => s.trim() === '')) missing.push('materials')
  if (record.observations.every((s) => s.trim() === '')) missing.push('observations')
  if (record.measurements.length === 0) missing.push('measurements')
  if (record.results.trim() === '') missing.push('results')
  return missing
}

// Unsigned decimals, with optional thousands separators ("1,500" -> 1500).
// A comma not followed by exactly three digits is a list separator.
const NUMBER = /\d+(?:,\d{3})*(?:\.\d+)?|\.\d+/g

export function extractNumbers(text: string): number[] {
  return (text.match(NUMBER) ?? []).map((token) => Number(token.replace(/,/g, '')))
}

const sameNumber = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))

// Every number in the record must also appear in the student's note. A number
// that does not is reported as ungrounded: the model may have read it off the
// photo or invented it, and code cannot tell which, so the student must confirm.
// Known limits: sign is ignored, units are not compared, and numbers written as
// words ("three") are not recognised on either side.
export function checkGrounding(record: ExperimentRecord, note: string): UngroundedNumber[] {
  const noteNumbers = extractNumbers(note)
  const grounded = (n: number) =>
    Number.isFinite(n) && noteNumbers.some((m) => sameNumber(m, Math.abs(n)))

  const ungrounded: UngroundedNumber[] = []
  const checkText = (path: string, text: string) => {
    for (const value of extractNumbers(text)) {
      if (!grounded(value)) ungrounded.push({ path, value })
    }
  }

  checkText('experiment_title', record.experiment_title)
  record.materials.forEach((s, i) => checkText(`materials[${i}]`, s))
  record.observations.forEach((s, i) => checkText(`observations[${i}]`, s))
  record.measurements.forEach((m: Measurement, i) => {
    if (!grounded(m.value)) ungrounded.push({ path: `measurements[${i}].value`, value: m.value })
    checkText(`measurements[${i}].quantity`, m.quantity)
  })
  checkText('results', record.results)
  return ungrounded
}

export function verifyRecord(raw: string, note: string): Verification {
  const parse = parseRecord(raw)
  if (!parse.ok) return { parse, missingFields: [], ungrounded: [] }
  return {
    parse,
    missingFields: findMissingFields(parse.record),
    ungrounded: checkGrounding(parse.record, note),
  }
}
