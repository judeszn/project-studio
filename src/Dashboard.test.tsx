import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Dashboard } from './Dashboard'
import type { Investigation } from './Dashboard'
import { buildReport } from './lib/report'
import { EVENTS, MIXED, PROVENANCE, recordFor } from './lib/report.fixtures'

// The overview counts only runs made in this session, and says what the
// platform cannot do yet rather than implying it.

const status = { label: 'ready', tone: 'ok' }
const page = (investigations: Investigation[]) =>
  renderToStaticMarkup(
    <Dashboard
      investigations={investigations}
      busy={false}
      nano={status}
      cloud={status}
      intro={null}
      current={null}
      preview={<p>worked example</p>}
      onOpen={() => {}}
    />,
  )

describe('Dashboard', () => {
  it('with no runs, counts nothing and says so', () => {
    const html = page([])
    expect(html).toContain('No investigations yet.')
    expect(html.match(/<strong class="">0<\/strong>/g)).toHaveLength(4)
    expect(html).toContain('worked example')
  })

  it('counts verdicts across the session’s runs', async () => {
    const report = buildReport(await recordFor(MIXED), EVENTS, PROVENANCE)
    const later = buildReport(
      await recordFor(MIXED, { startedAt: '2026-11-13T10:00:00.000Z' }),
      EVENTS,
      PROVENANCE,
    )
    const html = page([
      { id: 'b', caseTitle: 'synthetic-sample', report: later },
      { id: 'a', caseTitle: 'synthetic-sample', report },
    ])
    const verified = report.counts.verified * 2
    const findings = report.findings.length * 2
    expect(html).toContain(`<strong class="ok">${verified} of ${findings}</strong>`)
    expect(html).toContain(`<strong class="fail">${findings - verified}</strong>`)
    expect(html.match(/<tr>/g)).toHaveLength(3) // header and two runs
    expect(html).not.toContain('worked example')
  })

  it('marks every integration and investigation type that does not exist as planned', () => {
    const html = page([])
    for (const planned of ['API ingestion', 'Webhooks', 'Local collector', 'Phishing', 'Endpoint', 'Network', 'Cloud']) {
      const item = html.slice(html.indexOf(`<strong>${planned}</strong>`))
      expect(item.slice(0, item.indexOf('</li>'))).toContain('Planned')
    }
    expect(html.match(/>Available</g)).toHaveLength(3) // file import, sample case, authentication
  })
})
