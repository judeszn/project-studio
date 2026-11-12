import { LOGON_ACTIONS } from './schema'
import type { EventAction, LogEvent } from './schema'

// Reads a case file an analyst opens from disk. Everything here runs in the
// page: the file is parsed and checked locally, and nothing in this module
// can send it anywhere. A file that fails any check is refused whole, with
// every reason listed; nothing is repaired, guessed or dropped.
//
// The format is the one `npm run lanl -- case` writes (docs/CASE_FILE.md):
//   spec.id      the case's name
//   source       where the records came from
//   modelNotes   instructions that go to the model with the events
//   events[]     { evidence, provenance }: the row a model sees, and the
//                original record it was derived from
// Only `evidence` rows and `modelNotes` ever reach a model. Provenance stays
// beside the evidence for the analyst. Fields the format does not name are
// refused, so a file cannot carry anything (labels, say) the page would
// silently ignore or pass on.

// Measured 2026-11-12: 50 events fit Gemini Nano's context window.
export const MAX_CASE_EVENTS = 50
export const MAX_CASE_BYTES = 2 * 1024 * 1024
export const MAX_MODEL_NOTES = 5
export const MAX_NOTE_CHARS = 1000

// The event types a case file may hold: authentication events.
export const AUTH_ACTIONS: readonly EventAction[] = [
  ...LOGON_ACTIONS,
  'logoff',
  'ticket-granting ticket',
  'service ticket',
  'AuthMap',
  'ScreenLock',
  'ScreenUnlock',
]
const AUTH_OUTCOMES: readonly LogEvent['outcome'][] = ['success', 'denied']

export interface Provenance {
  file: string
  line: number
  raw: string // the original record, exactly as it was read
}

export interface CaseSource {
  dataset: string
  citation: string
  file: string
  sha256?: string
}

export interface LoadedCase {
  id: string
  source: CaseSource
  modelNotes: string[]
  events: LogEvent[]
  provenance: Record<string, Provenance> // by event ID; never sent to a model
}

export type CaseFileResult = { ok: true; case: LoadedCase } | { ok: false; errors: string[] }

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

const EVIDENCE_KEYS = ['id', 'date', 'time', 'source', 'actor', 'action', 'target', 'outcome', 'logonType', 'detail']
const EVIDENCE_TEXT = ['id', 'date', 'time', 'actor', 'target', 'detail'] as const
const SPEC_KEYS = ['id', 'start', 'end', 'computers', 'users', 'maxEvents']
const SOURCE_KEYS = ['dataset', 'citation', 'file', 'sha256']
const PROVENANCE_KEYS = ['file', 'line', 'raw']

function unexpected(obj: Record<string, unknown>, allowed: string[], at: string): string[] {
  return Object.keys(obj)
    .filter((k) => !allowed.includes(k))
    .map((k) => `${at}${k}: unexpected field`)
}

function checkEvent(entry: unknown, at: string, errors: string[]) {
  if (!isObject(entry)) return errors.push(`${at}: expected an object`)
  errors.push(...unexpected(entry, ['evidence', 'provenance'], `${at}.`))
  const { evidence, provenance } = entry

  if (!isObject(evidence)) {
    errors.push(`${at}.evidence: expected an object`)
  } else {
    errors.push(...unexpected(evidence, EVIDENCE_KEYS, `${at}.evidence.`))
    for (const key of EVIDENCE_TEXT) {
      if (!isText(evidence[key])) errors.push(`${at}.evidence.${key}: expected text`)
    }
    if (isText(evidence.id) && !/^E\d+$/.test(evidence.id)) {
      errors.push(`${at}.evidence.id: expected an ID such as E01, got "${evidence.id}"`)
    }
    if (evidence.source !== 'identity') {
      errors.push(`${at}.evidence.source: expected "identity"`)
    }
    if (!AUTH_ACTIONS.includes(evidence.action as EventAction)) {
      errors.push(`${at}.evidence.action: "${String(evidence.action)}" is not a supported event type`)
    }
    if (!AUTH_OUTCOMES.includes(evidence.outcome as LogEvent['outcome'])) {
      errors.push(`${at}.evidence.outcome: expected one of ${AUTH_OUTCOMES.join(', ')}`)
    }
    if (evidence.logonType !== undefined && !isText(evidence.logonType)) {
      errors.push(`${at}.evidence.logonType: expected text`)
    }
  }

  if (!isObject(provenance)) {
    errors.push(`${at}.provenance: expected an object`)
  } else {
    errors.push(...unexpected(provenance, PROVENANCE_KEYS, `${at}.provenance.`))
    if (!isText(provenance.file)) errors.push(`${at}.provenance.file: expected text`)
    if (!Number.isInteger(provenance.line) || (provenance.line as number) < 1) {
      errors.push(`${at}.provenance.line: expected a line number`)
    }
    if (!isText(provenance.raw)) errors.push(`${at}.provenance.raw: expected the original record`)
  }
}

export function parseCaseFile(text: string): CaseFileResult {
  if (text.length > MAX_CASE_BYTES) {
    return { ok: false, errors: [`the file is larger than ${MAX_CASE_BYTES / 1024 / 1024} MB`] }
  }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, errors: ['the file is not valid JSON'] }
  }
  if (!isObject(data)) return { ok: false, errors: ['the file is not a JSON object'] }

  const errors = unexpected(data, ['spec', 'source', 'modelNotes', 'events'], '')
  const { spec, source, modelNotes, events } = data

  if (!isObject(spec)) {
    errors.push('spec: expected an object')
  } else {
    errors.push(...unexpected(spec, SPEC_KEYS, 'spec.'))
    if (!isText(spec.id)) errors.push('spec.id: expected the case name')
  }

  if (!isObject(source)) {
    errors.push('source: expected an object')
  } else {
    errors.push(...unexpected(source, SOURCE_KEYS, 'source.'))
    for (const key of ['dataset', 'citation', 'file']) {
      if (!isText(source[key])) errors.push(`source.${key}: expected text`)
    }
    if (source.sha256 !== undefined && !isText(source.sha256)) errors.push('source.sha256: expected text')
  }

  if (!Array.isArray(modelNotes) || !modelNotes.every(isText)) {
    errors.push('modelNotes: expected a list of text')
  } else {
    if (modelNotes.length > MAX_MODEL_NOTES) {
      errors.push(`modelNotes: expected at most ${MAX_MODEL_NOTES}, got ${modelNotes.length}`)
    }
    modelNotes.forEach((note, i) => {
      if (note.length > MAX_NOTE_CHARS) {
        errors.push(`modelNotes[${i}]: longer than ${MAX_NOTE_CHARS} characters`)
      }
    })
  }

  if (!Array.isArray(events)) {
    errors.push('events: expected a list')
  } else if (events.length === 0) {
    errors.push('events: the case has no events')
  } else if (events.length > MAX_CASE_EVENTS) {
    errors.push(`events: expected at most ${MAX_CASE_EVENTS}, got ${events.length}`)
  } else {
    events.forEach((entry, i) => checkEvent(entry, `events[${i}]`, errors))
    const ids = events.map((e) => (isObject(e) && isObject(e.evidence) ? e.evidence.id : undefined))
    for (const id of new Set(ids.filter((id, i) => id !== undefined && ids.indexOf(id) !== i))) {
      errors.push(`events: ID ${String(id)} is used more than once`)
    }
  }

  if (errors.length > 0) return { ok: false, errors }

  const checked = data as {
    spec: { id: string }
    source: CaseSource
    modelNotes: string[]
    events: { evidence: LogEvent; provenance: Provenance }[]
  }
  return {
    ok: true,
    case: {
      id: checked.spec.id,
      source: checked.source,
      modelNotes: checked.modelNotes,
      events: checked.events.map((e) => e.evidence),
      provenance: Object.fromEntries(checked.events.map((e) => [e.evidence.id, e.provenance])),
    },
  }
}
