import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReportView } from './ReportView'
import { LIMITS, VERDICT_LABEL } from './lib/report'
import type { Report } from './lib/report'
import { EVENTS, MIXED, PROVENANCE, finding, output, reportOf } from './lib/report.fixtures'

// The page renders the same Report as the exported file. These check that the
// page, too, drops nothing and labels the model's words as the model's.

const page = (report: Report) =>
  renderToStaticMarkup(<ReportView report={report} onExport={() => {}} onRecord={() => {}} />)

// Text as React writes it into markup.
const esc = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')

const section = (html: string, title: string, next?: string) =>
  html.slice(html.indexOf(`<h3>${title}</h3>`), next ? html.indexOf(`<h3>${next}</h3>`) : undefined)

describe('ReportView', () => {
  it('shows every finding with its verdict and every reason', async () => {
    const report = await reportOf(MIXED)
    const html = page(report)
    for (const f of report.findings) {
      expect(html).toContain(`<span class="verdict ${f.verdict}">${VERDICT_LABEL[f.verdict]}</span>`)
      expect(html).toContain(esc(f.claim))
      for (const r of f.reasons) expect(html).toContain(esc(r))
    }
    expect(html.match(/<li class="finding verified">/g)).toHaveLength(1)
    expect(html).toMatch(/Cited but not in the evidence: (<!-- -->)?E48/)
  })

  it('leads with the result, then verdicts, coverage, findings and the proposal', async () => {
    const html = page(await reportOf(MIXED))
    const order = [
      'class="result ',
      'class="tiles"',
      'Evidence coverage:',
      '<h3>Findings</h3>',
      'Explanation, written by the model',
      '<h3>How it ran</h3>',
    ].map((marker) => html.indexOf(marker))
    expect(order.every((at) => at >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    // The classification is shown once, in the proposal, not repeated above it.
    expect(html.split('Classification (proposed by the model, not verified)')).toHaveLength(2)
  })

  it('folds the evidence of verified findings and opens it for the rest', async () => {
    const html = page(await reportOf(MIXED))
    const cards = html.split('<li class="finding ').slice(1)
    for (const card of cards) {
      const open = /<details class="cited" open="">/.test(card)
      expect(open).toBe(!card.startsWith('verified"'))
    }
  })

  it('shows uncited events and all evidence, with the original records', async () => {
    const html = page(await reportOf(MIXED))
    const uncited = section(html, 'Events no finding cites', 'How it ran')
    expect(uncited).toContain('<strong>E05</strong>')
    expect(uncited).not.toContain('<strong>E01</strong>')
    const all = section(html, 'All evidence', 'Raw model output')
    for (const e of EVENTS) {
      expect(all).toContain(`<strong>${e.id}</strong>`)
      expect(all).toContain(esc(PROVENANCE[e.id].raw))
    }
  })

  it("labels the proposal as the model's, not verified, and states the limits", async () => {
    const html = page(await reportOf(MIXED))
    expect(html).toContain('Explanation, written by the model')
    expect(html).toContain('Classification (proposed by the model, not verified)')
    expect(html).toContain('Proposed by the model. Not taken, and not verified.')
    for (const limit of LIMITS) expect(html).toContain(esc(limit))
  })

  it('unreadable output: says so, and lists every event as uncited', async () => {
    const html = page(await reportOf('not json'))
    expect(html).toContain('no finding was checked and every event is uncited')
    const uncited = section(html, 'Events no finding cites', 'How it ran')
    for (const e of EVENTS) expect(uncited).toContain(`<strong>${e.id}</strong>`)
  })

  it('shows model text as text', async () => {
    const html = page(await reportOf(output([finding('logon', '<img src=x onerror=alert(1)>', ['E02'])])))
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })
})
