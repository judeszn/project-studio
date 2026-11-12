import { describe, expect, it } from 'vitest'
import { AUTH_VOCABULARY, datasetDayAndTime, selectEvents, toEvidence, type CaseSpec } from './case'
import { parseAuthLine, type AuthRecord } from './auth'
import { authFixture } from './testing'

const spec = (over: Partial<CaseSpec> = {}): CaseSpec => ({
  id: 'test',
  start: 100,
  end: 300,
  computers: [],
  users: [],
  maxEvents: 10,
  ...over,
})

describe('selectEvents', () => {
  it('orders by numeric dataset time, then file line', async () => {
    const [a, b, c] = authFixture()
    const s = await selectEvents([c, a, b], spec(), { sorted: false }) // times 150, 100, 150
    expect(s.ok && s.records.map((r) => r.line)).toEqual([1, 2, 3])
  })

  it('keeps the window, inclusive at both ends, in file order', async () => {
    const s = await selectEvents(authFixture(), spec(), { sorted: false })
    expect(s.ok && s.records.map((r) => r.line)).toEqual([1, 2, 3, 4, 5])
  })

  it('keeps a record that names any listed computer or user, as source or destination', async () => {
    const byComputer = await selectEvents(authFixture(), spec({ computers: ['C900003'] }), { sorted: false })
    expect(byComputer.ok && byComputer.records.map((r) => r.line)).toEqual([2, 3])
    const byUser = await selectEvents(authFixture(), spec({ users: ['U900005@SYN'] }), { sorted: false })
    expect(byUser.ok && byUser.records.map((r) => r.line)).toEqual([5])
    const either = await selectEvents(
      authFixture(),
      spec({ computers: ['C900004'], users: ['U900001@SYN'] }),
      { sorted: false },
    )
    expect(either.ok && either.records.map((r) => r.line)).toEqual([1, 4])
  })

  it('stops at the end of the window only when the file is known to be sorted', async () => {
    const sorted = await selectEvents(authFixture(), spec(), { sorted: true })
    const unsorted = await selectEvents(authFixture(), spec(), { sorted: false })
    expect(sorted.ok && sorted.scanned).toBe(6)
    expect(unsorted.ok && unsorted.scanned).toBe(8)
  })

  it('refuses more than maxEvents rather than cutting the case short', async () => {
    expect(await selectEvents(authFixture(), spec({ maxEvents: 4 }), { sorted: false })).toEqual({
      ok: false,
      error: 'more than 4 events match; narrow the case',
    })
    const atLimit = await selectEvents(authFixture(), spec({ maxEvents: 5 }), { sorted: false })
    expect(atLimit.ok).toBe(true)
  })

  it('refuses an empty or impossible case', async () => {
    const empty = await selectEvents(authFixture(), spec({ start: 400, end: 500 }), { sorted: false })
    expect(empty).toEqual({ ok: false, error: 'no events match' })
    const backwards = await selectEvents(authFixture(), spec({ start: 300, end: 100 }), { sorted: false })
    expect(backwards.ok).toBe(false)
  })
})

describe('datasetDayAndTime', () => {
  it('counts days and elapsed time from the dataset epoch of 1', () => {
    expect(datasetDayAndTime(1)).toEqual({ date: 'Day 1', time: 'elapsed 00:00:00' })
    expect(datasetDayAndTime(86400)).toEqual({ date: 'Day 1', time: 'elapsed 23:59:59' })
    expect(datasetDayAndTime(86401)).toEqual({ date: 'Day 2', time: 'elapsed 00:00:00' })
    expect(datasetDayAndTime(150885)).toEqual({ date: 'Day 2', time: 'elapsed 17:54:44' })
    expect(datasetDayAndTime(8 * 86400 + 2 * 3600 + 24 * 60 + 1)).toEqual({
      date: 'Day 9',
      time: 'elapsed 02:24:00',
    })
  })
})

describe('toEvidence', () => {
  const records = authFixture().slice(0, 5)

  it('numbers events in order and keeps each source record beside its row', () => {
    const c = toEvidence(records, AUTH_VOCABULARY)
    if (!c.ok) throw new Error(c.errors.join('; '))
    expect(c.events.map((e) => e.evidence.id)).toEqual(['E01', 'E02', 'E03', 'E04', 'E05'])
    expect(c.events.map((e) => e.provenance)).toEqual(
      records.map((r) => ({ file: r.file, line: r.line, raw: r.raw })),
    )
  })

  it('writes the existing evidence shape and nothing more', () => {
    const c = toEvidence(records, AUTH_VOCABULARY)
    if (!c.ok) throw new Error(c.errors.join('; '))
    expect(c.events[4].evidence).toEqual({
      id: 'E05',
      date: 'Day 1',
      time: 'elapsed 00:04:59',
      source: 'identity',
      actor: 'C900009$@SYN',
      action: 'network logon',
      target: 'C900010',
      outcome: 'success',
      logonType: 'Network',
      detail:
        "Day 1 · elapsed 00:04:59 (dataset time 300 s from the dataset's start; not a clock time). " +
        'Source user C900009$@SYN; destination user U900005@SYN; ' +
        'source computer C900009; destination computer C900010; ' +
        'authentication type Negotiate; logon type Network; orientation LogOn; result Success.',
    })
    // LANL records no device, so a device rule can never be met.
    expect(c.events.every((e) => !('device' in e.evidence))).toBe(true)
  })

  it("shows '?' as not recorded", () => {
    const c = toEvidence(records, AUTH_VOCABULARY)
    expect(c.ok && c.events[3].evidence.detail).toContain('authentication type not recorded; logon type not recorded')
  })

  it('maps the approved vocabulary; no LANL event becomes a sign-in or sign-out', () => {
    const c = toEvidence(
      [
        record('100,U1@SYN,U1@SYN,C1,C2,Kerberos,Network,LogOn,Success'),
        record('101,U1@SYN,U1@SYN,C1,C2,Kerberos,Network,LogOff,Success'),
        record('102,U1@SYN,U1@SYN,C1,C2,Kerberos,Network,TGT,Success'),
        record('103,U1@SYN,U1@SYN,C1,C2,Kerberos,Network,TGS,Success'),
        record('104,U1@SYN,U1@SYN,C1,C2,Kerberos,Network,LogOn,Fail'),
        record('105,U1@SYN,U1@SYN,C1,C2,Kerberos,Network,TGS,Fail'),
        record('106,U1@SYN,U1@SYN,C1,C2,?,?,AuthMap,Success'),
        record('107,U1@SYN,U1@SYN,C1,C1,Negotiate,Unlock,ScreenLock,Success'),
        record('108,U1@SYN,U1@SYN,C1,C1,Negotiate,Unlock,ScreenUnlock,Fail'),
      ],
      AUTH_VOCABULARY,
    )
    if (!c.ok) throw new Error(c.errors.join('; '))
    expect(c.events.map((e) => [e.evidence.action, e.evidence.outcome])).toEqual([
      ['network logon', 'success'],
      ['logoff', 'success'],
      ['ticket-granting ticket', 'success'],
      ['service ticket', 'success'],
      ['network logon', 'denied'],
      ['service ticket', 'denied'],
      ['AuthMap', 'success'],
      ['ScreenLock', 'success'],
      ['ScreenUnlock', 'denied'],
    ])
    expect(c.events[6].evidence.detail).toContain('orientation AuthMap; result Success.')
    // The original values are kept word for word.
    expect(c.events[3].evidence.detail).toContain('orientation TGS; result Success.')
  })

  it('names each logon by its logon type and keeps the type as structured evidence', () => {
    const types = [
      ['Network', 'network logon'],
      ['Interactive', 'interactive logon'],
      ['RemoteInteractive', 'remote interactive logon'],
      ['Service', 'service logon'],
      ['Batch', 'batch logon'],
      ['Unlock', 'unlock logon'],
      ['NewCredentials', 'new-credentials logon'],
      ['NetworkCleartext', 'network cleartext logon'],
      ['CachedInteractive', 'cached interactive logon'],
      ['?', 'logon, type not recorded'],
    ]
    const c = toEvidence(
      types.map(([t], i) => record(`${100 + i},U1@SYN,U1@SYN,C1,C2,Kerberos,${t},LogOn,Success`)),
      AUTH_VOCABULARY,
    )
    if (!c.ok) throw new Error(c.errors.join('; '))
    expect(c.events.map((e) => [e.evidence.logonType, e.evidence.action])).toEqual(
      types.map(([t, action]) => [t === '?' ? 'not recorded' : t, action]),
    )
    // Every event keeps its logon type, not just logons.
    const logoff = toEvidence([record('100,U1@SYN,U1@SYN,C1,C2,?,Network,LogOff,Success')], AUTH_VOCABULARY)
    expect(logoff.ok && logoff.events[0].evidence.logonType).toBe('Network')
  })

  it('refuses a logon type it has no decision for', () => {
    expect(toEvidence([record('100,U1@SYN,U1@SYN,C1,C2,Kerberos,Remote,LogOn,Success', 4)], AUTH_VOCABULARY)).toEqual({
      ok: false,
      errors: ['t line 4: logon type "Remote" is not supported'],
    })
  })

  it('refuses a value it has no decision for, naming the line, never guessing', () => {
    const unsupported = [
      record('100,U1@SYN,U1@SYN,C1,C2,Kerberos,Network,Unlisted,Success', 7),
      record('100,U1@SYN,U1@SYN,C1,C2,Kerberos,Network,toString,Success', 8),
      record('100,U1@SYN,U1@SYN,C1,C2,Kerberos,Network,?,Success', 9),
      record('100,U1@SYN,U1@SYN,C1,C2,Kerberos,Network,LogOn,Partial', 10),
      record('100,U1@SYN,U1@SYN,C1,C2,Kerberos,Network,logon,Success', 11), // case matters
    ]
    expect(toEvidence(unsupported, AUTH_VOCABULARY)).toEqual({
      ok: false,
      errors: [
        't line 7: orientation "Unlisted" is not supported',
        't line 8: orientation "toString" is not supported',
        't line 9: orientation "not recorded" is not supported',
        't line 10: result "Partial" is not supported',
        't line 11: orientation "logon" is not supported',
      ],
    })
  })
})

function record(raw: string, line = 1): AuthRecord {
  const parsed = parseAuthLine(raw, 't', line)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.record
}
