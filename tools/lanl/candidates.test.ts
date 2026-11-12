import { describe, expect, it } from 'vitest'
import { parseAuthLine, type AuthRecord } from './auth'
import { accountType, createScan, hourOf, rankOrder, SELECTOR, type Candidate, type SelectorRule } from './candidates'
import { selectEvents } from './case'

// Synthetic records only. The rule is scaled down so a test stays readable:
// hours 0 and 1 are excluded, and a window needs 2 to 4 records.
const RULE: SelectorRule = { firstHour: 2, minEvents: 2, maxEvents: 4, top: 3 }

type Row = [time: number, sourceUser: string, destinationUser: string, source: string, destination: string, rest?: string]

const at = (hour: number, second = 0) => hour * 3600 + 1 + second

const records = (rows: Row[]): AuthRecord[] =>
  rows.map(([time, su, du, sc, dc, rest = 'Kerberos,Network,LogOn,Success'], i) => {
    const parsed = parseAuthLine(`${time},${su},${du},${sc},${dc},${rest}`, 'SYNTHETIC', i + 1)
    if (!parsed.ok) throw new Error(parsed.error)
    return parsed.record
  })

const scan = (rows: Row[], rule = RULE) => {
  const s = createScan(rule)
  for (const r of records(rows)) s.add(r)
  return s.finish()
}

// `n` records by one account from a computer to itself: one window, no others.
const local = (hour: number, computer: string, users: string[]): Row[] =>
  users.map((u, i) => [at(hour, i), u, u, computer, computer])

describe('the frozen rule', () => {
  it('is the one in docs/SELECTOR_SPEC.md', () => {
    expect(SELECTOR).toEqual({ firstHour: 168, minEvents: 5, maxEvents: 50, top: 10 })
  })

  it('puts second 1 in hour 0 and second 3601 in hour 1', () => {
    expect([1, 3600, 3601, 604800, 604801].map(hourOf)).toEqual([0, 0, 1, 167, 168])
  })

  it('tells user, machine and other accounts apart', () => {
    expect(['U22@DOM1', 'C480$@DOM1', 'SYSTEM@C1', 'ANONYMOUS LOGON@C586'].map(accountType)).toEqual([
      'user', 'machine', 'other', 'other',
    ])
  })
})

describe('score and evidence', () => {
  it('counts first-seen pairs for the source computer, and evidence in both directions', () => {
    const r = scan([
      [at(2, 0), 'U1@D', 'U1@D', 'C1', 'C2'], // first-seen (U1, C2), from C1
      [at(2, 1), 'U2@D', 'U2@D', 'C3', 'C1'], // first-seen (U2, C1), but from C3
      [at(2, 2), 'U3@D', 'U3@D', 'C1', 'C1'], // first-seen (U3, C1); one record, not two
    ])
    expect(r.top).toHaveLength(1)
    expect(r.top[0]).toMatchObject({
      computer: 'C1', hour: 2, start: 7201, end: 10800, when: 'Day 1 · elapsed 02:00:00',
      evidence: 3, outgoing: 2, score: 2, destinations: 2, accounts: 3,
    })
    // C3 scored but has one record; C2 only received.
    expect(r.windows).toEqual({ total: 3, scoreZero: 1, scored: 2, tooSmall: 1, tooLarge: 0, eligible: 1 })
  })

  it('counts pairs from line 1, so a pair formed in an excluded hour is not first-seen later', () => {
    const r = scan([
      [at(0), 'U1@D', 'U1@D', 'C1', 'C2'],
      [at(2, 0), 'U1@D', 'U1@D', 'C1', 'C2'],
      [at(2, 1), 'U1@D', 'U1@D', 'C1', 'C2'],
      [at(2, 2), 'U1@D', 'U1@D', 'C1', 'C3'],
    ])
    expect(r.top[0]).toMatchObject({ computer: 'C1', evidence: 3, score: 1 })
    expect(r).toMatchObject({ pairs: 2, pairsBeforeFirstHour: 1, records: 4, hours: 3 })
  })

  it('makes no window in the excluded hours', () => {
    const r = scan([...local(0, 'C1', ['U1@D', 'U2@D', 'U3@D']), ...local(1, 'C1', ['U4@D', 'U5@D'])])
    expect(r).toMatchObject({ top: [], evaluation: null, control: null, pairs: 5, pairsBeforeFirstHour: 5 })
    expect(r.windows.total).toBe(0)
  })

  it('counts both accounts of a record, by type, and one account once', () => {
    const r = scan([
      [at(2, 0), 'C1$@D', 'U1@D', 'C1', 'C1'], // two pairs
      [at(2, 1), 'SYSTEM@C1', 'SYSTEM@C1', 'C1', 'C1'], // one pair
      [at(2, 2), 'U1@D', 'C1$@D', 'C1', 'C1'], // both seen
    ])
    expect(r.top[0]).toMatchObject({ score: 3, scoreByAccountType: { user: 1, machine: 1, other: 1 }, accounts: 3 })
  })

  it('reports the mix of orientations, outcomes and logon types, with ? for a missing value', () => {
    const r = scan([
      [at(2, 0), 'U1@D', 'U1@D', 'C1', 'C1', 'Kerberos,Network,LogOn,Success'],
      [at(2, 1), 'U1@D', 'U1@D', 'C1', 'C1', '?,?,LogOff,Success'],
      [at(2, 2), 'U1@D', 'U1@D', 'C1', 'C1', 'NTLM,Network,LogOn,Fail'],
    ])
    expect(r.top[0]).toMatchObject({
      orientations: { LogOn: 2, LogOff: 1 },
      outcomes: { Success: 2, Fail: 1 },
      logonTypes: { Network: 2, '?': 1 },
    })
  })

  it('counts exactly the records the case builder selects for that computer and hour', async () => {
    const all = records([
      [at(2, 0), 'U1@D', 'U1@D', 'C1', 'C2'],
      [at(2, 1), 'U2@D', 'U2@D', 'C3', 'C4'],
      [at(2, 2), 'U3@D', 'U3@D', 'C3', 'C1'],
      [at(2, 3), 'U4@D', 'U4@D', 'C1', 'C1'],
      [at(2, 3599), 'U5@D', 'U5@D', 'C1', 'C5'],
      [at(3, 0), 'U6@D', 'U6@D', 'C1', 'C6'],
    ])
    const s = createScan({ ...RULE, top: 1 })
    for (const r of all) s.add(r)
    const { evaluation } = s.finish()
    expect(evaluation).toMatchObject({ computer: 'C1', hour: 2, evidence: 4 })
    const selected = await selectEvents(
      all,
      { id: 't', start: evaluation!.start, end: evaluation!.end, computers: ['C1'], users: [], maxEvents: 50 },
      { sorted: true },
    )
    expect(selected.ok && selected.records.map((r) => r.line)).toEqual([1, 3, 4, 5])
  })
})

describe('eligibility and rank', () => {
  it('keeps windows of minEvents to maxEvents records with a score of at least 1', () => {
    const r = scan([
      ...local(0, 'CE', ['U9@D']),
      ...local(2, 'CA', ['U1@D']), // 1 record: too small
      ...local(2, 'CB', ['U1@D', 'U1@D']), // 2 records, score 1
      ...local(2, 'CC', ['U1@D', 'U2@D', 'U3@D', 'U4@D']), // 4 records, score 4
      ...local(2, 'CD', ['U1@D', 'U1@D', 'U1@D', 'U1@D', 'U1@D']), // 5 records: too large
      ...local(2, 'CE', ['U9@D', 'U9@D', 'U9@D']), // score 0
    ].sort((a, b) => a[0] - b[0]) as Row[])
    expect(r.windows).toEqual({ total: 5, scoreZero: 1, scored: 4, tooSmall: 1, tooLarge: 1, eligible: 2 })
    expect(r.scoreDistribution).toEqual({ 1: 1, 4: 1 })
    expect(r.top.map((c) => c.computer)).toEqual(['CC', 'CB'])
    expect(r.warnings).toContain('only 2 eligible windows; 3 were asked for')
  })

  it('ranks by score, then destinations, then earlier hour, then computer name', () => {
    const c = (computer: string, score: number, destinations: number, hour: number) =>
      ({ computer, score, destinations, hour }) as Candidate
    const sorted = [
      c('C9', 2, 5, 200), c('C10', 3, 1, 300), c('C2', 2, 5, 200), c('C1', 2, 5, 201), c('C3', 2, 6, 400),
    ].sort(rankOrder)
    // 'C2' < 'C9' in string order; 'C10' wins on score alone.
    expect(sorted.map((x) => x.computer)).toEqual(['C10', 'C3', 'C2', 'C9', 'C1'])
  })

  it('keeps the best `top` windows and names rank 1 as the evaluation case', () => {
    const r = scan([
      ...local(2, 'CA', ['U1@D', 'U1@D']), // score 1
      ...local(3, 'CB', ['U1@D', 'U2@D', 'U3@D']), // score 3
      ...local(4, 'CC', ['U1@D', 'U2@D']), // score 2
      ...local(5, 'CD', ['U1@D', 'U1@D']), // score 1, later than CA
      ...local(6, 'CF', ['U1@D', 'U2@D', 'U3@D']), // score 3, later than CB
    ])
    expect(r.top.map((c) => c.computer)).toEqual(['CB', 'CF', 'CC'])
    expect(r.evaluation).toBe(r.top[0])
    expect(r.windows.eligible).toBe(5)
    expect(r.warnings).toContain('2 eligible windows share the top score 3; rank 1 was decided by the tie-breaks')
  })
})

describe('control', () => {
  const quietHour = (hour: number, n: number): Row[] =>
    Array.from({ length: n }, (_, i) => [at(hour, i), 'U1@D', 'U1@D', 'C1', 'C2'] as Row)

  it('is the same computer in the score-0 hour closest in size, the earlier on a tie', () => {
    const r = scan([
      [at(0), 'U1@D', 'U1@D', 'C1', 'C2'],
      ...quietHour(2, 1),
      [at(3, 0), 'U1@D', 'U1@D', 'C1', 'C3'], // the evaluation case: 3 records, score 1
      [at(3, 1), 'U1@D', 'U1@D', 'C1', 'C2'],
      [at(3, 2), 'U1@D', 'U1@D', 'C1', 'C2'],
      ...quietHour(4, 5),
      ...quietHour(5, 4),
      ...quietHour(6, 2),
    ])
    expect(r.evaluation).toMatchObject({ computer: 'C1', hour: 3, evidence: 3 })
    expect(r.control).toEqual({
      computer: 'C1', hour: 5, start: 18001, end: 21600, when: 'Day 1 · elapsed 05:00:00',
      evidence: 4, score: 0, sizeDifference: 1, sameComputer: true, scoreZeroHoursOfEvaluationComputer: 4,
    })
    expect(r.warnings).toEqual(['only 1 eligible windows; 3 were asked for'])
  })

  it('falls back to another computer, by size, then earlier hour, then name, and says so', () => {
    const r = scan([
      [at(2, 0), 'U1@D', 'U1@D', 'C1', 'C3'],
      [at(2, 1), 'U1@D', 'U1@D', 'C1', 'C2'],
      [at(3, 0), 'U8@D', 'U8@D', 'C7', 'C7'], // first-seen, so C7 scores in hour 3
      [at(4, 0), 'U8@D', 'U8@D', 'C7', 'C7'], // score 0, same size as C2 and C3 but later
    ])
    expect(r.evaluation).toMatchObject({ computer: 'C1', evidence: 2, score: 2 })
    expect(r.control).toMatchObject({ computer: 'C2', hour: 2, evidence: 1, sizeDifference: -1, sameComputer: false })
    expect(r.warnings).toEqual([
      'only 1 eligible windows; 3 were asked for',
      'C1 has no score-0 hour; the control is another computer',
      'the control has 1 records, outside 2 to 4',
    ])
  })
})

describe('input it cannot use', () => {
  it('stops when a time goes backwards', () => {
    const s = createScan(RULE)
    const [a, b] = records([[at(3), 'U1@D', 'U1@D', 'C1', 'C1'], [at(2), 'U1@D', 'U1@D', 'C1', 'C1']])
    s.add(a)
    expect(() => s.add(b)).toThrow('line 2: time 7201 is earlier than 10801')
  })

  it('stops on a record with no computer or user', () => {
    const [r] = records([[at(2), 'U1@D', 'U1@D', '?', 'C1']])
    expect(() => createScan(RULE).add(r)).toThrow('line 1: a user or computer is missing')
  })
})
