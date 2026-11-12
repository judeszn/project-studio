import { describe, expect, it } from 'vitest'
import { FINDING_TYPES } from '../../src/lib/schema'
import { checkProposal, checkSupport } from '../../src/lib/verify'
import { AUTH_VOCABULARY, LANL_TIME_NOTE, toEvidence, type CaseFile } from './case'
import { evaluate, labelCase, recordedRun } from './evaluate'
import { authSystemPrompt, buildPrompt } from '../../src/lib/prompts'
import { buildRunRecord, type RunFacts } from '../../src/lib/record'
import { parseAuthLine } from './auth'
import { agreement, matchedUser, matches, parseRedteamLine } from './redteam'
import { authFixture, redteamFixture } from './testing'

// Case: synthetic auth lines 1-5 (window 100-300), events E01-E05.
function fixtureCase(): CaseFile {
  const c = toEvidence(authFixture().slice(0, 5), AUTH_VOCABULARY)
  if (!c.ok) throw new Error(c.errors.join('; '))
  return {
    spec: { id: 'syn-1', start: 100, end: 300, computers: [], users: [], maxEvents: 10 },
    source: { dataset: 'synthetic', citation: 'none', file: 'SYNTHETIC-auth.txt' },
    modelNotes: [],
    events: c.events,
  }
}

const proposal = (findings: { type: string; claim: string; event_ids: string[] }[]) =>
  JSON.stringify({
    findings,
    explanation: 'Sign-ins by two accounts.',
    classification: 'Undetermined',
    confidence: 'Low',
    recommended_actions: ['Review the sign-ins.'],
  })

describe('parseRedteamLine', () => {
  it('reads the four documented fields', () => {
    expect(parseRedteamLine('150,U900002@SYN,C900002,C900003', 'redteam.txt.gz', 3)).toEqual({
      ok: true,
      record: {
        file: 'redteam.txt.gz',
        line: 3,
        raw: '150,U900002@SYN,C900002,C900003',
        time: 150,
        user: 'U900002@SYN',
        sourceComputer: 'C900002',
        destinationComputer: 'C900003',
      },
    })
  })

  it('rejects other shapes', () => {
    expect(parseRedteamLine('150,U1@D,C1', 'f', 1).ok).toBe(false)
    expect(parseRedteamLine('150,U1@D,C1,C2,x', 'f', 1).ok).toBe(false)
    expect(parseRedteamLine('150,?,C1,C2', 'f', 1).ok).toBe(false)
  })
})

describe('match rules', () => {
  const [l1, , , , l5, l6] = authFixture()
  const [r1, r2, r3] = redteamFixture()

  it('reports field agreement without deciding a match', () => {
    expect(agreement(r2, l5)).toEqual({
      time: true,
      sourceComputer: true,
      destinationComputer: true,
      sourceUser: false,
      destinationUser: true,
    })
  })

  it('records which user field matched', () => {
    expect(matchedUser(r1, authFixture()[1])).toBe('both')
    expect(matchedUser(r2, l5)).toBe('destination')
    expect(matchedUser(r1, l1)).toBeNull() // different time and computers
  })

  it('applies each candidate rule as written', () => {
    expect(matches('source_user', r2, l5)).toBe(false)
    expect(matches('destination_user', r2, l5)).toBe(true)
    expect(matches('either_user', r2, l5)).toBe(true)
    expect(matches('source_user', r3, l6)).toBe(true)
    expect(matches('either_user', r1, l1)).toBe(false) // different time and computers
  })
})

describe('labelCase', () => {
  it('labels case events from their preserved raw records', () => {
    const truth = labelCase(fixtureCase(), redteamFixture(), 'source_user', 'SYNTHETIC-redteam.txt')
    expect(truth).toEqual({
      caseId: 'syn-1',
      rule: 'source_user',
      redteamFile: 'SYNTHETIC-redteam.txt',
      labelled: [
        { id: 'E02', matches: [{ redteamLine: 1, user: 'both' }] },
        { id: 'E03', matches: [{ redteamLine: 1, user: 'both' }] },
      ],
    })
    const either = labelCase(fixtureCase(), redteamFixture(), 'either_user', 'SYNTHETIC-redteam.txt')
    expect(either.labelled.map((l) => l.id)).toEqual(['E02', 'E03', 'E05'])
    // E05's source user is a machine account; the red-team user is its destination user.
    expect(either.labelled[2].matches).toEqual([{ redteamLine: 2, user: 'destination' }])
  })
})

describe('evaluate', () => {
  const truth = labelCase(fixtureCase(), redteamFixture(), 'source_user', 'SYNTHETIC-redteam.txt')

  it('compares passing findings with the labels', () => {
    const raw = proposal([
      { type: 'logon', claim: 'U900002@SYN logged on to C900003.', event_ids: ['E02'] },
      { type: 'logon', claim: 'C900001$@SYN logged on to C900001.', event_ids: ['E01'] },
      // `other` has no rule, so it never passes.
      { type: 'other', claim: 'U900002@SYN logged on again.', event_ids: ['E03'] },
    ])
    expect(evaluate(fixtureCase(), truth, raw)).toEqual({
      caseId: 'syn-1',
      rule: 'source_user',
      parsed: true,
      parseErrors: [],
      classification: 'Undetermined',
      confidence: 'Low',
      findings: 3,
      passing: 2,
      events: 5,
      labelled: ['E02', 'E03'],
      covered: ['E01', 'E02'],
      coveredLabelled: ['E02'],
      coveredUnlabelled: ['E01'],
      labelledNotCovered: ['E03'],
      citedLabelled: ['E02', 'E03'],
    })
  })

  it('scores an unparseable answer as covering nothing', () => {
    const e = evaluate(fixtureCase(), truth, 'not json')
    expect(e.parsed).toBe(false)
    expect(e.labelledNotCovered).toEqual(['E02', 'E03'])
  })

  it('refuses truth for another case or for events the case lacks', () => {
    expect(() => evaluate(fixtureCase(), { ...truth, caseId: 'other' }, '{}')).toThrow(/not syn-1/)
    const extra = {
      ...truth,
      labelled: [...truth.labelled, { id: 'E99', matches: [{ redteamLine: 9, user: 'both' as const }] }],
    }
    expect(() => evaluate(fixtureCase(), extra, '{}')).toThrow(/E99/)
  })
})

// Was a known gap until 2026-11-11: the account check saw only names shaped
// like "adm-ops-01", so an invented LANL user passed. Now caught, on evidence
// built by the real converter.
describe('identity check on converted LANL evidence', () => {
  const events = () => fixtureCase().events.map((e) => e.evidence)
  const check = (claim: string, id = 'E02') =>
    checkProposal(JSON.parse(proposal([{ type: 'sign_in', claim, event_ids: [id] }])), events())

  it('flags a user who is not in the evidence', () => {
    expect(check('U123456@SYN signed in to C900003.')).toEqual([
      { path: 'findings[0]', problem: 'mentions account u123456@syn, which is not in the events it cites' },
    ])
  })

  it('accepts the users and computers of the cited event', () => {
    expect(check('U900002@SYN signed in from C900002 to C900003.')).toEqual([])
    // E05: machine account as source user, a different destination user.
    expect(check('C900009$@SYN authenticated U900005@SYN on C900010.', 'E05')).toEqual([])
  })
})

describe('vocabulary and relative time on converted LANL evidence', () => {
  // Synthetic auth line 7 is a Kerberos service ticket (TGS).
  const ticketCase = () => {
    const c = toEvidence(authFixture().slice(6, 7), AUTH_VOCABULARY)
    if (!c.ok) throw new Error(c.errors.join('; '))
    return c.events.map((e) => e.evidence)
  }
  const one = (type: string, claim: string, id: string) =>
    JSON.parse(proposal([{ type, claim, event_ids: [id] }]))

  it('ticket activity does not support a sign-in finding', () => {
    expect(checkSupport(one('sign_in', 'U900001@SYN signed in to C900007.', 'E01'), ticketCase())).toEqual([
      { status: 'unsupported', notes: ['E01 is a "service ticket" event, not "sign-in"'] },
    ])
  })

  it('checks quoted times against the elapsed time, to the minute', () => {
    // E05 is at dataset time 300 s: Day 1 · elapsed 00:04:59.
    const events = fixtureCase().events.map((e) => e.evidence)
    const at = (claim: string) => checkProposal(one('sign_in', claim, 'E05'), events)
    expect(at('U900005@SYN signed in at elapsed 00:04:59 on Day 1.')).toEqual([])
    expect(at('U900005@SYN signed in at 00:04.')).toEqual([])
    expect(at('U900005@SYN signed in at 00:05.')).toEqual([
      { path: 'findings[0]', problem: 'mentions 00:05, which is not a time in the events it cites' },
    ])
  })

  it('tells the model the times are relative, not clock times', () => {
    expect(LANL_TIME_NOTE).toMatch(/relative dataset timestamps/)
    expect(LANL_TIME_NOTE).toMatch(/not local clock times/)
    expect(LANL_TIME_NOTE).toMatch(/night/)
    expect(LANL_TIME_NOTE).toMatch(/numeric dataset time/)
  })
})

describe('context-only LANL event types', () => {
  it('ticket, AuthMap and screen lock events support no finding type', () => {
    const lines = ['TGT', 'TGS', 'AuthMap', 'ScreenLock', 'ScreenUnlock'].map(
      (o, i) => `${100 + i},U1@SYN,U1@SYN,C1,C2,Kerberos,Network,${o},Success`,
    )
    const records = lines.map((raw, i) => {
      const p = parseAuthLine(raw, 't', i + 1)
      if (!p.ok) throw new Error(p.error)
      return p.record
    })
    const c = toEvidence(records, AUTH_VOCABULARY)
    if (!c.ok) throw new Error(c.errors.join('; '))
    const events = c.events.map((e) => e.evidence)
    for (const type of FINDING_TYPES) {
      for (const e of events) {
        const findings = [{ type, claim: 'x', event_ids: [e.id] }]
        const [support] = checkSupport(JSON.parse(proposal(findings)), events)
        expect(support.status, `${type} on ${e.action}`).not.toBe('supported')
      }
    }
  })
})

describe('recordedRun: a saved run record, checked against its case', () => {
  const CASE_SHA = 'c'.repeat(64)
  const record = (over: Partial<RunFacts> = {}) => {
    const c = fixtureCase()
    return buildRunRecord({
      case: { id: c.spec.id, origin: 'case file', fileName: 'syn-1.json', sha256: CASE_SHA, events: 5, source: c.source },
      systemPrompt: authSystemPrompt(c.modelNotes),
      prompt: buildPrompt(c.events.map((e) => e.evidence)),
      findingTypes: ['logon', 'denied_logon', 'other'],
      requested: 'on_device',
      cloudAllowed: false,
      startedAt: '2026-11-12T22:15:30.000Z',
      finishedAt: '2026-11-12T22:16:00.000Z',
      onlineAtStart: true,
      onlineAtEnd: true,
      nanoAvailability: 'available',
      userAgent: 'test',
      onDeviceParams: null,
      cloudModel: 'cloud-model',
      result: { text: 'the raw output', inferenceSource: 'on_device', sdkMode: 'only_on_device', consented: false, latencyMs: 30000 },
      verification: null,
      ...over,
    })
  }

  it('gives the raw output and where it ran', async () => {
    expect(await recordedRun(await record(), fixtureCase(), CASE_SHA)).toMatchObject({
      raw: 'the raw output',
      location: 'on-device',
      model: 'Gemini Nano (Chrome built-in)',
      consentToSendToCloud: false,
      latencyMs: 30000,
    })
  })

  it('says so when the run was in the cloud', async () => {
    const cloud = await record({
      result: { text: 'x', inferenceSource: 'in_cloud', sdkMode: 'prefer_in_cloud', consented: true, latencyMs: 1 },
    })
    expect(await recordedRun(cloud, fixtureCase(), CASE_SHA)).toMatchObject({ location: 'cloud', model: 'cloud-model' })
  })

  it('refuses a record of another case file', async () => {
    await expect(recordedRun(await record(), fixtureCase(), 'd'.repeat(64))).rejects.toThrow(/not d{64}/)
  })

  it('refuses a record made with another system prompt or other evidence', async () => {
    await expect(recordedRun(await record({ systemPrompt: 'tuned' }), fixtureCase(), CASE_SHA)).rejects.toThrow(
      /system prompt/,
    )
    await expect(recordedRun(await record({ prompt: 'other events' }), fixtureCase(), CASE_SHA)).rejects.toThrow(
      /evidence/,
    )
  })

  it('refuses a record whose text and hash disagree', async () => {
    const r = await record()
    r.output.raw = 'edited'
    r.prompt.systemSha256 = '0'.repeat(64)
    await expect(recordedRun(r, fixtureCase(), CASE_SHA)).rejects.toThrow(/system prompt/)
  })

  it('refuses a failed run: there is nothing to evaluate', async () => {
    const failedRun = await record({ result: { error: 'On-device inference failed.' }, verification: null })
    await expect(recordedRun(failedRun, fixtureCase(), CASE_SHA)).rejects.toThrow(/failed.*On-device inference failed/)
  })

  it('refuses a file that is not a run record', async () => {
    await expect(recordedRun({ ...(await record()), format: 'x' as never }, fixtureCase(), CASE_SHA)).rejects.toThrow(
      /not a run record/,
    )
  })
})
