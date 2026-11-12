import { describe, expect, it } from 'vitest'
import { MAX_CASE_EVENTS, MAX_MODEL_NOTES, MAX_NOTE_CHARS, parseCaseFile } from './casefile'

// A small valid case, changed one way per test.
const entry = (n: number) => ({
  evidence: {
    id: `E${String(n).padStart(2, '0')}`,
    date: 'Day 2',
    time: 'elapsed 00:00:01',
    source: 'identity',
    actor: 'U1@DOM1',
    action: 'network logon',
    target: 'C2',
    outcome: 'success',
    logonType: 'Network',
    detail: 'from C1',
  },
  provenance: { file: 'auth.txt.gz', line: n, raw: `1,U1@DOM1,U1@DOM1,C1,C2,NTLM,Network,LogOn,Success #${n}` },
})

const valid = () => ({
  spec: { id: 'case-1', start: 1, end: 2, computers: [], users: [], maxEvents: 50 },
  source: { dataset: 'A dataset', citation: 'A citation', file: 'auth.txt.gz', sha256: 'abc' },
  modelNotes: ['Times are relative.'],
  events: [entry(1), entry(2)],
})

type Case = ReturnType<typeof valid>

const errorsOf = (change: (c: Case) => unknown) => {
  const c = valid()
  change(c)
  const parsed = parseCaseFile(JSON.stringify(c))
  return parsed.ok ? [] : parsed.errors
}

// For changes the test data's own type does not allow.
const loose = (v: unknown) => v as Record<string, unknown>

describe('parseCaseFile: a valid case', () => {
  it('returns the evidence rows in order, with IDs, notes, source and provenance kept', () => {
    const file = valid()
    const parsed = parseCaseFile(JSON.stringify(file))
    if (!parsed.ok) throw new Error(parsed.errors.join('; '))
    expect(parsed.case.id).toBe('case-1')
    expect(parsed.case.source).toEqual(file.source)
    expect(parsed.case.modelNotes).toEqual(['Times are relative.'])
    expect(parsed.case.events).toEqual(file.events.map((e) => e.evidence))
    expect(parsed.case.provenance).toEqual({ E01: file.events[0].provenance, E02: file.events[1].provenance })
  })

  it('keeps provenance out of the evidence rows', () => {
    const parsed = parseCaseFile(JSON.stringify(valid()))
    if (!parsed.ok) throw new Error(parsed.errors.join('; '))
    for (const e of parsed.case.events) {
      expect(Object.keys(e).sort()).toEqual(
        ['action', 'actor', 'date', 'detail', 'id', 'logonType', 'outcome', 'source', 'target', 'time'],
      )
    }
  })

  it('accepts a case with no notes, no logon type and no source hash', () => {
    expect(
      errorsOf((c) => {
        c.modelNotes = []
        delete loose(c.events[0].evidence).logonType
        delete loose(c.source).sha256
      }),
    ).toEqual([])
  })

  it(`accepts ${MAX_CASE_EVENTS} events`, () => {
    expect(
      errorsOf((c) => {
        c.events = Array.from({ length: MAX_CASE_EVENTS }, (_, i) => entry(i + 1))
      }),
    ).toEqual([])
  })
})

describe('parseCaseFile: refusals', () => {
  it('refuses text that is not JSON, and JSON that is not an object', () => {
    expect(parseCaseFile('not json')).toEqual({ ok: false, errors: ['the file is not valid JSON'] })
    expect(parseCaseFile('[]')).toEqual({ ok: false, errors: ['the file is not a JSON object'] })
    expect(parseCaseFile('null')).toEqual({ ok: false, errors: ['the file is not a JSON object'] })
  })

  it('refuses a file over the size limit before parsing it', () => {
    const parsed = parseCaseFile(' '.repeat(2 * 1024 * 1024 + 1))
    expect(parsed).toEqual({ ok: false, errors: ['the file is larger than 2 MB'] })
  })

  it('refuses a missing part', () => {
    expect(errorsOf((c) => delete loose(c).spec)).toEqual(['spec: expected an object'])
    expect(errorsOf((c) => delete loose(c).source)).toEqual(['source: expected an object'])
    expect(errorsOf((c) => delete loose(c).modelNotes)).toEqual(['modelNotes: expected a list of text'])
    expect(errorsOf((c) => delete loose(c).events)).toEqual(['events: expected a list'])
  })

  it('refuses no events, and more events than fit the on-device model', () => {
    expect(errorsOf((c) => void (c.events = []))).toEqual(['events: the case has no events'])
    expect(
      errorsOf((c) => void (c.events = Array.from({ length: MAX_CASE_EVENTS + 1 }, (_, i) => entry(i + 1)))),
    ).toEqual([`events: expected at most ${MAX_CASE_EVENTS}, got ${MAX_CASE_EVENTS + 1}`])
  })

  it('refuses fields the format does not name, at every level', () => {
    expect(errorsOf((c) => void (loose(c).truth = { redteam: ['E01'] }))).toEqual(['truth: unexpected field'])
    expect(errorsOf((c) => void (loose(c.spec).note = 'x'))).toEqual(['spec.note: unexpected field'])
    expect(errorsOf((c) => void (loose(c.source).url = 'x'))).toEqual(['source.url: unexpected field'])
    expect(errorsOf((c) => void (loose(c.events[1]).label = 'redteam'))).toEqual([
      'events[1].label: unexpected field',
    ])
    expect(errorsOf((c) => void (loose(c.events[0].evidence).redteam = true))).toEqual([
      'events[0].evidence.redteam: unexpected field',
    ])
    expect(errorsOf((c) => void (loose(c.events[0].provenance).label = 1))).toEqual([
      'events[0].provenance.label: unexpected field',
    ])
  })

  it('refuses an event without an ID, with a malformed ID, or with a repeated ID', () => {
    expect(errorsOf((c) => delete loose(c.events[0].evidence).id)).toEqual(['events[0].evidence.id: expected text'])
    expect(errorsOf((c) => void (c.events[0].evidence.id = 'one'))).toEqual([
      'events[0].evidence.id: expected an ID such as E01, got "one"',
    ])
    expect(errorsOf((c) => void (c.events[1].evidence.id = 'E01'))).toEqual([
      'events: ID E01 is used more than once',
    ])
  })

  it('refuses an event type, source or outcome it does not know, rather than guessing', () => {
    expect(errorsOf((c) => void (c.events[0].evidence.action = 'file read'))).toEqual([
      'events[0].evidence.action: "file read" is not a supported event type',
    ])
    expect(errorsOf((c) => void (c.events[0].evidence.source = 'file'))).toEqual([
      'events[0].evidence.source: expected "identity"',
    ])
    expect(errorsOf((c) => void (c.events[0].evidence.outcome = 'unknown'))).toEqual([
      'events[0].evidence.outcome: expected one of success, denied',
    ])
    expect(errorsOf((c) => delete loose(c.events[0].evidence).outcome)).toEqual([
      'events[0].evidence.outcome: expected one of success, denied',
    ])
  })

  it('refuses empty or non-text evidence fields', () => {
    expect(errorsOf((c) => void (c.events[0].evidence.actor = ' '))).toEqual([
      'events[0].evidence.actor: expected text',
    ])
    expect(errorsOf((c) => void (loose(c.events[0].evidence).time = 5))).toEqual([
      'events[0].evidence.time: expected text',
    ])
    expect(errorsOf((c) => void (loose(c.events[0].evidence).logonType = 3))).toEqual([
      'events[0].evidence.logonType: expected text',
    ])
  })

  it('refuses an event without its original record', () => {
    expect(errorsOf((c) => delete loose(c.events[0]).provenance)).toEqual([
      'events[0].provenance: expected an object',
    ])
    expect(errorsOf((c) => void (c.events[0].provenance.raw = ''))).toEqual([
      'events[0].provenance.raw: expected the original record',
    ])
    expect(errorsOf((c) => void (c.events[0].provenance.line = 0))).toEqual([
      'events[0].provenance.line: expected a line number',
    ])
    expect(errorsOf((c) => void (loose(c.events[0].provenance).line = '7'))).toEqual([
      'events[0].provenance.line: expected a line number',
    ])
    expect(errorsOf((c) => delete loose(c.events[0].provenance).file)).toEqual([
      'events[0].provenance.file: expected text',
    ])
  })

  it('refuses a case without a name or a source', () => {
    expect(errorsOf((c) => void (c.spec.id = ''))).toEqual(['spec.id: expected the case name'])
    expect(errorsOf((c) => delete loose(c.source).citation)).toEqual(['source.citation: expected text'])
  })

  it('refuses notes that are not text, too many, or too long', () => {
    expect(errorsOf((c) => void (loose(c).modelNotes = [1]))).toEqual(['modelNotes: expected a list of text'])
    expect(errorsOf((c) => void (loose(c).modelNotes = 'a note'))).toEqual(['modelNotes: expected a list of text'])
    expect(
      errorsOf((c) => void (c.modelNotes = Array.from({ length: MAX_MODEL_NOTES + 1 }, () => 'note'))),
    ).toEqual([`modelNotes: expected at most ${MAX_MODEL_NOTES}, got ${MAX_MODEL_NOTES + 1}`])
    expect(errorsOf((c) => void (c.modelNotes = ['x'.repeat(MAX_NOTE_CHARS + 1)]))).toEqual([
      `modelNotes[0]: longer than ${MAX_NOTE_CHARS} characters`,
    ])
  })

  it('lists every reason, and returns no case', () => {
    const parsed = parseCaseFile(
      JSON.stringify({ ...valid(), spec: { id: '' }, events: [{ evidence: { id: 'x' }, provenance: {} }] }),
    )
    expect(parsed.ok).toBe(false)
    expect(!parsed.ok && parsed.errors.length).toBeGreaterThan(5)
    expect('case' in parsed).toBe(false)
  })
})
