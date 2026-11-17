import { describe, expect, it } from 'vitest'
import { parseCaseFile } from '../lib/casefile'
import type { LoadedCase } from '../lib/casefile'
import { buildRunRecord } from '../lib/record'
import { SYNTHETIC_NOTE, buildReport, reportHtml } from '../lib/report'
import type { Verdict } from '../lib/report'
import { LANL_FINDING_TYPES } from '../lib/schema'
import { verifyProposal } from '../lib/verify'
import DEMO_CASE from './sample-case.json?raw'

// The demo case: synthetic authentication events at a fictional organisation.
// It is checked by the same loader as any case file. What verdicts a live run
// gets depends on the model; these tests show only that the evidence lets the
// checks reach each verdict, using proposals written here, not by a model.

const loaded = (): LoadedCase => {
  const parsed = parseCaseFile(DEMO_CASE)
  if (!parsed.ok) throw new Error(parsed.errors.join('; '))
  return parsed.case
}

const proposal = (findings: { type: string; claim: string; event_ids: string[] }[]) =>
  JSON.stringify({
    findings,
    explanation: 'Written for a test.',
    classification: 'Undetermined',
    confidence: 'Low',
    recommended_actions: [],
  })

async function reportOf(raw: string, origin: 'demo' | 'case file' = 'demo') {
  const c = loaded()
  const record = await buildRunRecord({
    case: { id: c.id, origin, fileName: 'sample-case.json', sha256: 'd'.repeat(64), events: c.events.length, source: c.source },
    systemPrompt: 'system',
    prompt: 'user',
    findingTypes: LANL_FINDING_TYPES,
    requested: 'on_device',
    cloudAllowed: true,
    startedAt: '2026-11-13T10:00:00.000Z',
    finishedAt: '2026-11-13T10:00:30.000Z',
    onlineAtStart: true,
    onlineAtEnd: true,
    nanoAvailability: 'available',
    userAgent: 'test',
    onDeviceParams: null,
    cloudModel: 'cloud-model',
    result: { text: raw, inferenceSource: 'on_device', sdkMode: 'only_on_device', consented: false, latencyMs: 30000 },
    verification: verifyProposal(raw, c.events, LANL_FINDING_TYPES),
  })
  return buildReport(record, c.events, c.provenance)
}

describe('the demo case file', () => {
  it('passes the case-file loader and says it is synthetic', () => {
    const c = loaded()
    expect(c.id).toBe('sample-infopro-auth')
    expect(c.events).toHaveLength(18)
    expect(c.source.dataset).toMatch(/^SIMULATED/)
    expect(c.source.citation).toMatch(/invented; InfoPro has had no such incident/)
    expect(c.modelNotes).toEqual([])
  })

  it('every evidence row agrees with its original record', () => {
    const c = loaded()
    for (const e of c.events) {
      const [stamp, windowsEvent, actor, target] = c.provenance[e.id].raw.split(',')
      expect(stamp.startsWith(`${e.date}T${e.time}`)).toBe(true)
      expect(actor).toBe(e.actor)
      expect(target).toBe(e.target)
      expect(windowsEvent === '4625').toBe(e.outcome === 'denied')
      expect(e.detail).toContain(`Windows event ${windowsEvent}`)
    }
  })
})

describe('the demo evidence can reach every verdict', () => {
  const cases: [string, Verdict, { type: string; claim: string; event_ids: string[] }][] = [
    ['denied logons, cited as such', 'verified', { type: 'denied_logon', claim: 'fin-clerk-04 was refused a network logon to FINSRV1 at 09:12.', event_ids: ['E06', 'E07'] }],
    ['the success after the failures, called a logon', 'verified', { type: 'logon', claim: 'fin-clerk-04 logged on to FINSRV1 from WKS318 at 09:14.', event_ids: ['E10'] }],
    ['that success called denied', 'contradicted', { type: 'denied_logon', claim: 'fin-clerk-04 was refused again at 09:14.', event_ids: ['E10'] }],
    ['a denied attempt called a logon', 'contradicted', { type: 'logon', claim: 'svc-backup-01 logged on to FILESRV1 at 11:00.', event_ids: ['E16'] }],
    ['a Kerberos ticket called a logon', 'rejected', { type: 'logon', claim: 'fin-clerk-04 logged on to FINSRV1 at 09:15.', event_ids: ['E11'] }],
    ['a logoff called a logon', 'rejected', { type: 'logon', claim: 'fin-clerk-04 logged on to FINSRV1 at 09:31.', event_ids: ['E12'] }],
    ['the near-identical account', 'rejected', { type: 'denied_logon', claim: 'fin-clerk-04 was refused a logon at 09:14.', event_ids: ['E09'] }],
    ['a time a minute off', 'rejected', { type: 'logon', claim: 'fin-clerk-04 logged on to FINSRV1 at 09:15.', event_ids: ['E10'] }],
    ['an event that does not exist', 'rejected', { type: 'denied_logon', claim: 'fin-clerk-04 was refused a fourth time.', event_ids: ['E06', 'E19'] }],
    ['the pattern, which no type checks', 'unchecked', { type: 'other', claim: 'fin-clerk-04 failed three times from WKS318, then succeeded.', event_ids: ['E06', 'E07', 'E08', 'E10'] }],
  ]
  for (const [what, verdict, finding] of cases) {
    it(`${what}: ${verdict}`, async () => {
      const [f] = (await reportOf(proposal([finding]))).findings
      expect(f.verdict).toBe(verdict)
      if (verdict !== 'verified') expect(f.reasons.length).toBeGreaterThan(0)
    })
  }

  it('routine activity stays uncited when no finding cites it', async () => {
    const report = await reportOf(proposal([cases[0][2]]))
    expect(report.uncited.map((e) => e.event.id)).toEqual(
      ['E01', 'E02', 'E03', 'E04', 'E05', 'E08', 'E09', 'E10', 'E11', 'E12', 'E13', 'E14', 'E15', 'E16', 'E17', 'E18'],
    )
  })
})

describe('results on the demo case are labelled synthetic', () => {
  it('in the report and the exported file, and never for a case file', async () => {
    const raw = proposal([
      { type: 'denied_logon', claim: 'fin-clerk-04 was refused a network logon to FINSRV1.', event_ids: ['E06'] },
    ])
    const demo = await reportOf(raw, 'demo')
    expect(demo.synthetic).toBe(true)
    expect(reportHtml(demo, 'now')).toContain(SYNTHETIC_NOTE.replace(/'/g, '&#39;'))
    const file = await reportOf(raw, 'case file')
    expect(file.synthetic).toBe(false)
    expect(reportHtml(file, 'now')).not.toContain('Simulated data')
  })
})
