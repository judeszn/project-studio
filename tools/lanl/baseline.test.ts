import { describe, expect, it } from 'vitest'
import { parseAuthLine, type AuthRecord } from './auth'
import { runBaseline } from './baseline'
import { AUTH_VOCABULARY, toEvidence, type CaseFile } from './case'

// Synthetic records only.
const LINES = [
  '10,U1@D,U1@D,C1,C2,NTLM,Network,LogOn,Success', // 1: (U1, C2) first
  '20,U2@D,U2@D,C3,C4,NTLM,Network,LogOn,Success', // 2: not in the case
  '30,U1@D,U1@D,C1,C2,NTLM,Network,LogOn,Fail', // 3: (U1, C2) again
  '40,U3@D,U3@D,C1,C5,NTLM,Network,LogOn,Success', // 4: (U3, C5) first
  '50,C1$@D,U4@D,C1,C2,Kerberos,Network,LogOn,Success', // 5: (C1$, C2) and (U4, C2) first
  '60,U2@D,U2@D,C1,C4,NTLM,Network,LogOn,Success', // 6: (U2, C4) seen on line 2
  '70,U3@D,U3@D,C1,C5,NTLM,Network,LogOn,Success', // 7: after the case
]

const parse = (raw: string, file: string, line: number): AuthRecord => {
  const p = parseAuthLine(raw, file, line)
  if (!p.ok) throw new Error(p.error)
  return p.record
}
const all = LINES.map((raw, i) => parse(raw, 'SYNTHETIC', i + 1))

const caseOf = (lines: number[]): CaseFile => {
  const c = toEvidence(lines.map((n) => all[n - 1]), AUTH_VOCABULARY)
  if (!c.ok) throw new Error(c.errors.join('; '))
  return {
    spec: { id: 'synthetic', start: 0, end: 100, computers: ['C1'], users: [], maxEvents: 50 },
    source: { dataset: 'synthetic', citation: 'none', file: 'SYNTHETIC' },
    modelNotes: [],
    events: c.events,
  }
}

describe('baseline', () => {
  it('flags the events that formed a pair first, counting from line 1', async () => {
    const b = await runBaseline(caseOf([3, 4, 5, 6]), all, parse)
    expect(b.flagged).toEqual([
      { id: 'E02', line: 4, firstSeen: ['U3@D -> C5'] },
      { id: 'E03', line: 5, firstSeen: ['C1$@D -> C2', 'U4@D -> C2'] },
    ])
    expect(b).toMatchObject({ caseId: 'synthetic', events: 4, scannedLines: 6 })
  })

  it('flags only the first of two case events forming the same pair', async () => {
    const b = await runBaseline(caseOf([1, 3]), all, parse)
    expect(b.flagged.map((f) => f.id)).toEqual(['E01'])
  })

  it('refuses a file whose line is not the record the case preserved', async () => {
    const changed = all.map((r) => (r.line === 4 ? { ...r, raw: r.raw.replace('Success', 'Fail') } : r))
    await expect(runBaseline(caseOf([4]), changed, parse)).rejects.toThrow('line 4 is not the record the case preserved')
  })

  it('refuses a file that ends before the case', async () => {
    await expect(runBaseline(caseOf([6]), all.slice(0, 3), parse)).rejects.toThrow('the file ended at line 3')
  })
})
