import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { ReportView } from '../ReportView'
import { parseCaseFile } from '../lib/casefile'
import type { LoadedCase } from '../lib/casefile'
import { buildRunRecord } from '../lib/record'
import {
  NO_MODEL_NOTE,
  buildReport,
  buildWorkedExample,
  reportFileName,
  reportHtml,
} from '../lib/report'
import type { Report } from '../lib/report'
import { LANL_FINDING_TYPES } from '../lib/schema'
import { verifyProposal } from '../lib/verify'
import DEMO_CASE from './sample-case.json?raw'
import { WORKED_EXAMPLE, WORKED_EXAMPLE_TEXT } from './worked-example'

// The worked example: a proposal the Project Studio team wrote about the demo
// case. These tests check that it reaches all four verdicts through the same
// code as a model's proposal, and that it is never presented as one.

const demo = (): LoadedCase => {
  const parsed = parseCaseFile(DEMO_CASE)
  if (!parsed.ok) throw new Error(parsed.errors.join('; '))
  return parsed.case
}

const CASE_INFO = (c: LoadedCase) => ({
  id: c.id,
  origin: 'demo' as const,
  fileName: 'sample-case.json',
  sha256: 'e'.repeat(64),
  events: c.events.length,
  source: c.source,
})

const example = (): Report => {
  const c = demo()
  return buildWorkedExample(CASE_INFO(c), WORKED_EXAMPLE_TEXT, c.events, c.provenance, LANL_FINDING_TYPES)
}

// The same proposal, as if a model had written it and a run record held it.
async function asModelRun(): Promise<Report> {
  const c = demo()
  const record = await buildRunRecord({
    case: CASE_INFO(c),
    systemPrompt: 'system',
    prompt: 'user',
    findingTypes: LANL_FINDING_TYPES,
    requested: 'on_device',
    cloudAllowed: true,
    startedAt: '2026-11-14T10:00:00.000Z',
    finishedAt: '2026-11-14T10:00:30.000Z',
    onlineAtStart: true,
    onlineAtEnd: true,
    nanoAvailability: 'available',
    userAgent: 'test',
    onDeviceParams: null,
    cloudModel: 'cloud-model',
    result: { text: WORKED_EXAMPLE_TEXT, inferenceSource: 'on_device', sdkMode: 'only_on_device', consented: false, latencyMs: 30000 },
    verification: verifyProposal(WORKED_EXAMPLE_TEXT, c.events, LANL_FINDING_TYPES),
  })
  return buildReport(record, c.events, c.provenance)
}

const page = (report: Report) =>
  renderToStaticMarkup(createElement(ReportView, { report, onExport: () => {} }))

describe('the worked example reaches all four verdicts', () => {
  it('one finding per intended outcome', () => {
    const report = example()
    expect(report.findings.map((f) => f.verdict)).toEqual([
      'verified',
      'verified',
      'contradicted',
      'rejected',
      'rejected',
      'rejected',
      'unchecked',
    ])
    expect(report.counts).toEqual({ verified: 2, rejected: 3, contradicted: 1, unchecked: 1 })
  })

  it('each failure says why', () => {
    const [, , contradicted, ticket, account, missing, unchecked] = example().findings
    expect(contradicted.reasons).toEqual(['E10 has outcome "success", not "denied"'])
    expect(ticket.reasons).toEqual(['E11 is a "service ticket" event, not a logon'])
    expect(account.reasons).toEqual(['mentions account fin-clerk-04, which is not in the events it cites'])
    expect(missing.reasons).toContain('cites event E21, which is not in the evidence')
    expect(missing.missing).toEqual(['E21'])
    expect(unchecked.reasons).toEqual(['Type "other": no rule in code checks it.'])
  })

  it('leaves routine activity uncited, and its own explanation and action pass the checks', () => {
    const report = example()
    expect(report.uncited.map((e) => e.event.id)).toEqual(
      ['E01', 'E02', 'E03', 'E04', 'E05', 'E12', 'E13', 'E14', 'E15', 'E16', 'E17', 'E18'],
    )
    expect(report.proposal!.explanationProblems).toEqual([])
    expect(report.proposal!.actions.every((a) => a.problems.length === 0)).toBe(true)
    expect(WORKED_EXAMPLE.findings).toHaveLength(7)
  })
})

describe('the rejections have the right causes', () => {
  // Each failing finding, changed only in the one thing the check objects to,
  // passes: so the rejection is caused by that, and nothing else.
  const verdictOf = (claim: string, event_ids: string[], type = 'denied_logon') => {
    const c = demo()
    const raw = JSON.stringify({ ...WORKED_EXAMPLE, findings: [{ type, claim, event_ids }] })
    return buildWorkedExample(CASE_INFO(c), raw, c.events, c.provenance, LANL_FINDING_TYPES).findings[0]
  }

  it('E21 is rejected because it is not in the evidence', () => {
    const asWritten = WORKED_EXAMPLE.findings[5]
    const rejected = verdictOf(asWritten.claim, asWritten.event_ids)
    expect(rejected.verdict).toBe('rejected')
    expect(rejected.reasons[0]).toBe('cites event E21, which is not in the evidence')
    expect(rejected.cited).toEqual([])
    expect(demo().events.some((e) => e.id === 'E21')).toBe(false)
    // The same finding citing a denied logon of that account that exists passes.
    expect(verdictOf('fin-clerk-04 was refused once more, in event E08.', ['E08']).verdict).toBe('verified')
  })

  it('the misattributed denial is rejected only because E09 is fin-clerk-14, not fin-clerk-04', () => {
    const asWritten = WORKED_EXAMPLE.findings[4]
    const rejected = verdictOf(asWritten.claim, asWritten.event_ids)
    expect(rejected.verdict).toBe('rejected')
    expect(rejected.reasons).toEqual(['mentions account fin-clerk-04, which is not in the events it cites'])
    expect(demo().events.find((e) => e.id === 'E09')?.actor).toBe('fin-clerk-14')
    // Naming the account E09 records, and nothing else changed, passes.
    expect(verdictOf(asWritten.claim.replace('fin-clerk-04', 'fin-clerk-14'), ['E09']).verdict).toBe('verified')
  })

  it('the contradicted finding fails only on the outcome', () => {
    const asWritten = WORKED_EXAMPLE.findings[2]
    expect(verdictOf(asWritten.claim, asWritten.event_ids).reasons).toEqual(['E10 has outcome "success", not "denied"'])
    expect(verdictOf('fin-clerk-04 logged on to FINSRV1 at 09:14.', ['E10'], 'logon').verdict).toBe('verified')
  })
})

describe('it goes through the same checks and report code as a model run', () => {
  it('same verification, findings, verdicts, reasons and uncited events', async () => {
    const mine = example()
    const model = await asModelRun()
    expect(mine.findings).toEqual(model.findings)
    expect(mine.counts).toEqual(model.counts)
    expect(mine.uncited).toEqual(model.uncited)
    expect(mine.proposal).toEqual(model.proposal)
    expect(mine.evidence).toEqual(model.evidence)
  })
})

describe('it is never presented as a model result', () => {
  it('has no run, says no model ran, and names its author', () => {
    const report = example()
    expect(report.author).toBe('analyst')
    expect(report.run).toBeNull()
    expect(report.where).toBe(NO_MODEL_NOTE)
    expect(report.synthetic).toBe(true)
  })

  it('the exported file says no model ran, in its title, body and file name', () => {
    const report = example()
    const html = reportHtml(report, 'now')
    expect(html).toContain('<title>Worked example (analyst-authored, no model ran): sample-infopro-auth</title>')
    expect(html).toContain('No model ran.')
    expect(html).toContain('Claim, written by the Project Studio team:')
    expect(html).toContain('none: no model ran')
    for (const modelWords of ['written by the model', "The model's proposal", 'Raw model output', 'Ran on this device', 'Ran in the cloud', 'AI proposes']) {
      expect(html).not.toContain(modelWords.replace(/'/g, '&#39;'))
    }
    expect(reportFileName(report)).toBe('sample-infopro-auth.analyst-authored-example.report.html')
  })

  it('the page says no model ran and offers no run record', () => {
    const html = page(example())
    expect(html).toContain('No model ran.')
    expect(html).toContain('Claim, written by the Project Studio team:')
    expect(html).not.toContain('Download run record')
    expect(html).not.toContain('written by the model')
    expect(html).not.toContain('Inference source')
  })

  it('a model run never carries the worked example’s labels, even right after one', async () => {
    const before = example()
    expect(before.author).toBe('analyst')
    const model = await asModelRun()
    expect(model.author).toBe('model')
    const html = reportHtml(model, 'now')
    expect(html).not.toContain('No model ran')
    expect(html).not.toContain('Project Studio team')
    expect(reportFileName(model)).not.toContain('analyst-authored')
    expect(page(model)).not.toContain('No model ran')
    expect(page(model)).not.toContain('Project Studio team')
  })

  it('makes no run record: the worked example yields a report only', () => {
    const report = example()
    expect(report.run).toBeNull()
    expect(Object.keys(report)).not.toContain('record')
    // The LANL evaluation reads run records (format project-studio.run-record/1)
    // or a model's raw output for a LANL case; the example is neither.
    expect(report.case.id).not.toMatch(/^lanl-/)
  })
})
