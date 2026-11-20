import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Dashboard } from './Dashboard'
import type { Investigation } from './Dashboard'
import { buildReport } from './lib/report'
import { EVENTS, MIXED, PROVENANCE, recordFor } from './lib/report.fixtures'

// The overview counts only runs made in this session, shows no counts before
// there is anything to count, and shows only what the product does.

const status = { label: 'ready', tone: 'ok' }
const page = (investigations: Investigation[]) =>
  renderToStaticMarkup(
    <Dashboard
      investigations={investigations}
      busy={false}
      nano={status}
      cloud={status}
      intro={<p>ways to start</p>}
      current={null}
      preview={<p>worked example</p>}
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

describe('Dashboard', () => {
  it('with no runs, shows no counts and says there are no investigations yet', () => {
    const html = page([])
    expect(html).toContain('No investigations yet.')
    expect(html).not.toContain('aria-label="This session"')
    expect(html).not.toContain('kpi')
    expect(html).not.toContain('Findings needing review')
    expect(html).toContain('AI engines')
  })

  it('with no runs, shows the worked example below the ways to start and the engines', () => {
    const html = page([])
    const start = html.indexOf('ways to start')
    const engines = html.indexOf('AI engines')
    const example = html.indexOf('worked example')
    expect(start).toBeGreaterThan(-1)
    expect(engines).toBeGreaterThan(start)
    expect(example).toBeGreaterThan(engines)
  })

  it('counts verdicts across the session’s runs, and lists what needs review', async () => {
    const runs = await twoRuns()
    const html = page(runs)
    const verified = runs[1].report.counts.verified * 2
    const findings = runs[1].report.findings.length * 2
    expect(html).toContain('aria-label="This session"')
    expect(html).toContain('<strong class="">2</strong>') // investigations
    expect(html).toContain(`<strong class="ok">${verified} of ${findings}</strong>`)
    expect(html).toContain(`<strong class="fail">${findings - verified}</strong>`)
    expect(html.match(/<tr>/g)).toHaveLength(3) // header and two runs
    expect(html).toContain('Findings needing review')
    expect(html).not.toContain('worked example')
  })

  it('never advertises planned capabilities, with or without runs', async () => {
    for (const html of [page([]), page(await twoRuns())]) {
      expect(html).not.toMatch(/Planned|Available/)
      for (const name of ['API ingestion', 'Webhooks', 'Local collector', 'Phishing', 'Endpoint', 'Network']) {
        expect(html).not.toContain(name)
      }
    }
  })
})
