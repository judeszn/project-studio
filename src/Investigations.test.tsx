import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Investigations } from './Investigations'
import type { Investigation } from './Investigations'
import { buildReport } from './lib/report'
import { EVENTS, MIXED, PROVENANCE, recordFor } from './lib/report.fixtures'

// Investigations lists only runs made in this session, invents no activity,
// keeps the sample labelled as simulated and shows only what the product does.

const page = (investigations: Investigation[]) =>
  renderToStaticMarkup(
    <Investigations
      investigations={investigations}
      busy={false}
      notice={null}
      current={null}
      onOpenFile={() => {}}
      onSample={() => {}}
      onHowVerdicts={() => {}}
      onOpen={() => {}}
    />,
  )

const twoRuns = async (): Promise<Investigation[]> => {
  const report = buildReport(await recordFor(MIXED), EVENTS, PROVENANCE)
  const later = buildReport(
    await recordFor(MIXED, { startedAt: '2026-11-13T10:00:00.000Z' }),
    EVENTS,
    PROVENANCE,
  )
  return [
    { id: 'b', caseTitle: 'synthetic-sample', report: later },
    { id: 'a', caseTitle: 'synthetic-sample', report },
  ]
}

describe('Investigations', () => {
  it('offers both ways to start, with the sample labelled as simulated', () => {
    const html = page([])
    expect(html).toContain('Open evidence file')
    expect(html).toContain('Use sample evidence (simulated)')
    expect(html).toContain('InfoPro has had no such incident')
    expect(html).toContain('How verdicts work')
  })

  it('with no runs, lists nothing and says so', () => {
    const html = page([])
    expect(html).toContain('No investigations in this session yet.')
    expect(html).not.toContain('<table')
  })

  it('lists each run of the session with its verdicts, and says nothing is stored', async () => {
    const runs = await twoRuns()
    const html = page(runs)
    const { verified } = runs[1].report.counts
    const findings = runs[1].report.findings.length
    expect(html.match(/<tr>/g)).toHaveLength(3) // header and two runs
    expect(html).toContain(`${verified}/${findings}`)
    expect(html).toContain('nothing is stored')
  })

  it('shows no dashboard counters, alerts or planned capabilities', async () => {
    for (const html of [page([]), page(await twoRuns())]) {
      expect(html).not.toContain('kpi')
      expect(html).not.toMatch(/Planned|Available|alert|monitoring/i)
      for (const name of ['API ingestion', 'Webhooks', 'Local collector', 'Phishing', 'Endpoint']) {
        expect(html).not.toContain(name)
      }
    }
  })
})
