import { describe, expect, it } from 'vitest'
import { GS03_EVENTS } from '../data/gs03'
import type { IncidentProposal } from './schema'
import {
  checkProposal,
  extractEventIds,
  extractTimes,
  parseProposal,
  verifyProposal,
} from './verify'

const proposal = (overrides: Partial<IncidentProposal> = {}): IncidentProposal => ({
  classification: 'Credential Compromise',
  confidence: 'High',
  explanation:
    'A privileged account signed in from outside the organisation at 02:20 and the owner denies it.',
  findings: [
    { claim: 'adm-ops-01 signed in from an unrecognised device at 02:20', event_ids: ['E05'] },
    { claim: 'A second administrator account was created at 02:24', event_ids: ['E06'] },
    { claim: 'The owner says they did not sign in after 17:41', event_ids: ['E11'] },
  ],
  recommended_actions: ['Restrict adm-ops-01 and adm-ops-02 pending review'],
  ...overrides,
})

describe('parseProposal', () => {
  it('accepts a well-formed proposal', () => {
    expect(parseProposal(JSON.stringify(proposal()))).toEqual({ ok: true, proposal: proposal() })
  })

  it('rejects text that is not JSON', () => {
    expect(parseProposal('Here is my analysis: {...}')).toEqual({
      ok: false,
      errors: ['output is not valid JSON'],
    })
  })

  it('rejects JSON that is not an object', () => {
    expect(parseProposal('[]').ok).toBe(false)
    expect(parseProposal('null').ok).toBe(false)
  })

  it('reports every missing or mistyped field', () => {
    const result = parseProposal(JSON.stringify({ classification: 'Malware', findings: 'none' }))
    expect(result).toEqual({
      ok: false,
      errors: [
        'classification: expected one of Ransomware, Phishing, Credential Compromise, Data Exfiltration, Insider Threat, Undetermined',
        'confidence: expected one of Low, Medium, High',
        'explanation: expected a string',
        'recommended_actions: expected an array of strings',
        'findings: expected an array',
      ],
    })
  })

  it('rejects a finding whose event_ids is not an array of strings', () => {
    const bad = { ...proposal(), findings: [{ claim: 'Sign-in', event_ids: 'E05' }] }
    expect(parseProposal(JSON.stringify(bad))).toEqual({
      ok: false,
      errors: ['findings[0].event_ids: expected an array of strings'],
    })
  })

  it('rejects fields the schema does not define', () => {
    const bad = { ...proposal(), verified: true }
    expect(parseProposal(JSON.stringify(bad))).toEqual({
      ok: false,
      errors: ['verified: unexpected field'],
    })
  })
})

describe('extractTimes', () => {
  it('reads clock times and zero-pads the hour', () => {
    expect(extractTimes('Signed in at 02:20, out at 2:36')).toEqual(['02:20', '02:36'])
  })

  it('ignores other numbers', () => {
    expect(extractTimes('203.0.113.57 on 9 March, 2 accounts')).toEqual([])
  })
})

describe('extractEventIds', () => {
  it('reads event IDs and nothing else', () => {
    expect(extractEventIds('See E05 and E11; adm-ops-01 on HR-PC1')).toEqual(['E05', 'E11'])
  })
})

describe('checkProposal', () => {
  it('finds no problem when every citation and time is in the evidence', () => {
    expect(checkProposal(proposal(), GS03_EVENTS)).toEqual([])
  })

  it('flags a finding that cites no event', () => {
    const uncited = proposal({ findings: [{ claim: 'Customer data was stolen', event_ids: [] }] })
    expect(checkProposal(uncited, GS03_EVENTS)).toEqual([
      { path: 'findings[0]', problem: 'cites no event' },
    ])
  })

  it('flags a cited event that does not exist', () => {
    const invented = proposal({
      findings: [{ claim: 'Malware was installed', event_ids: ['E05', 'E42'] }],
    })
    expect(checkProposal(invented, GS03_EVENTS)).toEqual([
      { path: 'findings[0]', problem: 'cites event E42, which is not in the evidence' },
    ])
  })

  it('flags a time that does not belong to the cited events', () => {
    const shifted = proposal({
      findings: [{ claim: 'The account was created at 02:20', event_ids: ['E06'] }],
    })
    expect(checkProposal(shifted, GS03_EVENTS)).toEqual([
      { path: 'findings[0]', problem: 'mentions 02:20, which is not a time in the events it cites' },
    ])
  })

  it('accepts a time quoted inside a cited statement', () => {
    const quoted = proposal({
      findings: [{ claim: 'No sign-in by the owner after 17:41', event_ids: ['E11'] }],
    })
    expect(checkProposal(quoted, GS03_EVENTS)).toEqual([])
  })

  it('flags times and events in free text that are not in the evidence', () => {
    const invented = proposal({
      explanation: 'Activity began at 03:05, see E99.',
      recommended_actions: ['Review everything since 01:00'],
    })
    expect(checkProposal(invented, GS03_EVENTS)).toEqual([
      { path: 'explanation', problem: 'mentions event E99, which is not in the evidence' },
      { path: 'explanation', problem: 'mentions 03:05, which is not a time in the evidence' },
      { path: 'recommended_actions[0]', problem: 'mentions 01:00, which is not a time in the evidence' },
    ])
  })

  it('flags an event mentioned in a claim but not in the evidence', () => {
    const invented = proposal({
      findings: [{ claim: 'Confirmed by E77', event_ids: ['E05'] }],
    })
    expect(checkProposal(invented, GS03_EVENTS)).toEqual([
      { path: 'findings[0]', problem: 'mentions event E77, which is not in the evidence' },
    ])
  })

  it('flags an empty explanation, no findings and an empty claim', () => {
    expect(checkProposal(proposal({ explanation: ' ', findings: [] }), GS03_EVENTS)).toEqual([
      { path: 'explanation', problem: 'empty' },
      { path: 'findings', problem: 'no findings' },
    ])
    const blank = proposal({ findings: [{ claim: '', event_ids: ['E05'] }] })
    expect(checkProposal(blank, GS03_EVENTS)).toEqual([
      { path: 'findings[0]', problem: 'empty claim' },
    ])
  })

  it('flags every citation when there is no evidence', () => {
    expect(checkProposal(proposal(), [])).toHaveLength(7)
  })
})

describe('verifyProposal', () => {
  it('skips content checks when the output does not parse', () => {
    expect(verifyProposal('not json', GS03_EVENTS)).toEqual({
      parse: { ok: false, errors: ['output is not valid JSON'] },
      problems: [],
    })
  })

  it('runs the content checks on a parsed proposal', () => {
    const raw = JSON.stringify(
      proposal({ findings: [{ claim: 'Data left the network at 02:31', event_ids: [] }] }),
    )
    const result = verifyProposal(raw, GS03_EVENTS)
    expect(result.parse.ok).toBe(true)
    expect(result.problems).toEqual([
      { path: 'findings[0]', problem: 'cites no event' },
      { path: 'findings[0]', problem: 'mentions 02:31, which is not a time in the events it cites' },
    ])
  })
})

describe('GS-03 evidence', () => {
  it('has unique event IDs in chronological order', () => {
    const ids = GS03_EVENTS.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    const stamps = GS03_EVENTS.map((e) => `${e.date} ${e.time}`)
    expect([...stamps].sort()).toEqual(stamps)
  })
})
