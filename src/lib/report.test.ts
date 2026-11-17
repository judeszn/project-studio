import { describe, expect, it } from 'vitest'
import { buildReport, esc, reportFileName, reportHtml, runLabel, VERDICT_LABEL, whereItRan } from './report'
import type { Report } from './report'
import { EVENTS, MIXED, PROVENANCE, finding, output, recordFor, reportOf } from './report.fixtures'
import { recordFileName } from './record'
import type { RunFacts } from './record'
import type { LogEvent } from './schema'

// The proposals here repeat, on synthetic events (report.fixtures.ts), each
// kind of failure the first on-device LANL run produced.

const html = (report: Report) => reportHtml(report, '2026-11-13T09:01:00.000Z')

describe('buildReport: one verdict per finding', () => {
  it('Verified, Rejected, Contradicted and Unchecked, as the checks decide', async () => {
    const report = await reportOf(MIXED)
    expect(report.findings.map((f) => f.verdict)).toEqual([
      'verified',
      'rejected', // type "other", but it cites an event that does not exist
      'rejected', // supported events, but a time they do not contain
      'contradicted',
      'unchecked',
    ])
    expect(report.counts).toEqual({ verified: 1, rejected: 2, contradicted: 1, unchecked: 1 })
  })

  it('says why every finding that is not verified failed', async () => {
    const [verified, invented, wrongTime, contradicted, unchecked] = (await reportOf(MIXED)).findings
    expect(verified.reasons).toEqual([])
    expect(invented.reasons).toContain('cites event E48, which is not in the evidence')
    expect(invented.reasons).toContain('Type "other": no rule in code checks it.')
    expect(wrongTime.reasons).toEqual(['mentions 23:59, which is not a time in the events it cites'])
    expect(contradicted.reasons).toEqual(['E03 has outcome "success", not "denied"'])
    expect(unchecked.reasons).toEqual(['Type "other": no rule in code checks it.'])
  })

  it('keeps each finding’s cited evidence, with the original records, and the IDs that do not exist', async () => {
    const invented = (await reportOf(MIXED)).findings[1]
    expect(invented.cited).toEqual([{ event: EVENTS[3], provenance: PROVENANCE.E04 }])
    expect(invented.missing).toEqual(['E48'])
    expect(invented.claim).toBe('U900003@SYN was refused again later (E48).')
  })

  it('lists the events no finding cites, and keeps all the evidence', async () => {
    const report = await reportOf(MIXED)
    expect(report.uncited).toEqual([{ event: EVENTS[4], provenance: PROVENANCE.E05 }])
    expect(report.evidence.map((e) => e.event)).toEqual(EVENTS)
    expect(report.covered).toEqual(['E01'])
  })

  it('a contradicted finding that also fails other checks lists every reason', async () => {
    const raw = output([finding('denied_logon', 'U900002@SYN was refused at 23:59.', ['E03'])])
    const [f] = (await reportOf(raw)).findings
    expect(f.verdict).toBe('contradicted')
    expect(f.reasons).toEqual([
      'mentions 23:59, which is not a time in the events it cites',
      'E03 has outcome "success", not "denied"',
    ])
  })

  it('gives an ATT&CK reference only to a verified finding', async () => {
    const raw = output([finding('sign_in_from_unrecognised_device', 'U900002@SYN logged on.', ['E02'])])
    const [f] = (await reportOf(raw)).findings
    expect(f.verdict).toBe('rejected')
    expect(f.attack).toBeNull()
  })

  it('carries the type notes for logons and denied logons', async () => {
    const [denied, , logon] = (await reportOf(MIXED)).findings
    expect(denied.note).toMatch(/does not show that access was obtained/)
    expect(logon.note).toMatch(/not by itself an attack/)
  })

  it('output that does not parse: no findings checked, every event uncited, raw output kept', async () => {
    const report = await reportOf('not json')
    expect(report.parsed).toBe(false)
    expect(report.parseErrors).toEqual(['output is not valid JSON'])
    expect(report.proposal).toBeNull()
    expect(report.findings).toEqual([])
    expect(report.uncited.map((e) => e.event.id)).toEqual(['E01', 'E02', 'E03', 'E04', 'E05'])
    expect(report.raw).toBe('not json')
  })

  it('refuses a failed run: there is nothing to report on', async () => {
    const failed = await recordFor('', { result: { error: 'Nano failed' }, verification: null })
    expect(() => buildReport(failed, EVENTS, PROVENANCE)).toThrow(/completed run/)
  })
})

describe('whereItRan', () => {
  it('names the device or the cloud, and consent', async () => {
    const run = (result: RunFacts['result']) => recordFor('{}', { result })
    expect(whereItRan(await run({ text: '', inferenceSource: 'on_device', sdkMode: 'only_on_device', consented: false, latencyMs: 1 }))).toBe(
      'Ran on this device: Gemini Nano. Nothing was sent to the cloud.',
    )
    expect(whereItRan(await run({ text: '', inferenceSource: 'on_device', sdkMode: 'prefer_on_device', consented: true, latencyMs: 1 }))).toBe(
      'Ran on this device: Gemini Nano, after you agreed to the cloud.',
    )
    expect(whereItRan(await run({ text: '', inferenceSource: 'in_cloud', sdkMode: 'prefer_in_cloud', consented: true, latencyMs: 1 }))).toBe(
      'Ran in the cloud: cloud-model. The evidence was sent after your consent.',
    )
    expect(whereItRan(await run({ text: '', inferenceSource: 'other', sdkMode: 'x', consented: true, latencyMs: 1 }))).toBe(
      'The SDK did not report where this ran.',
    )
  })
})

describe('reportHtml: the exported file', () => {
  it('shows every finding with its verdict, and never a verified badge on one that is not', async () => {
    const page = html(await reportOf(MIXED))
    for (const n of [1, 2, 3, 4, 5]) expect(page).toContain(`Finding ${n} · `)
    expect(page.match(/<span class="verdict verified">/g)).toHaveLength(1)
    expect(page.match(/<span class="verdict rejected">/g)).toHaveLength(2)
    expect(page.match(/<span class="verdict contradicted">/g)).toHaveLength(1)
    expect(page.match(/<span class="verdict unchecked">/g)).toHaveLength(1)

    const none = html(await reportOf(output([finding('other', 'U900003@SYN was refused.', ['E04'])])))
    expect(none).not.toContain('<span class="verdict verified">')
  })

  it('includes every reason, every uncited event and every original record', async () => {
    const report = await reportOf(MIXED)
    const page = html(report)
    for (const f of report.findings) for (const r of f.reasons) expect(page).toContain(esc(r))
    for (const e of EVENTS) expect(page).toContain(esc(PROVENANCE[e.id].raw))
    expect(page).toContain('Cited but not in the evidence: E48')
    const uncited = page.slice(page.indexOf('Events no finding cites</h2>'), page.indexOf('Recommended actions</h2>'))
    expect(uncited).toContain('<strong>E05</strong>')
    expect(uncited).not.toContain('<strong>E01</strong>')
  })

  it('labels the explanation, classification, confidence and actions as the model’s, not verified', async () => {
    const page = html(await reportOf(MIXED))
    expect(page).toContain('Explanation, written by the model')
    expect(page).toContain('Classification (proposed by the model, not verified)')
    expect(page).toContain('Confidence (the model&#39;s own, not verified)')
    expect(page).toContain('Proposed by the model. Not taken, and not verified.')
    expect(page).toContain('it does not check what they claim')
  })

  it('a report on output that did not parse says so and still holds the evidence and the raw output', async () => {
    const page = html(await reportOf('not json'))
    expect(page).toContain('could not be read')
    expect(page).toContain('output is not valid JSON')
    expect(page).toContain('<pre>not json</pre>')
    for (const e of EVENTS) expect(page).toContain(`<strong>${e.id}</strong>`)
  })

  it('escapes evidence, provenance, case details and model text, and allows no script or remote resource', async () => {
    const hostile: LogEvent[] = [
      { ...EVENTS[0], detail: 'Day 1 · elapsed 10:00:01. <img src=x onerror=alert(1)>' },
      ...EVENTS.slice(1),
    ]
    const raw = output(
      [finding('denied_logon', 'U900001@SYN was refused <script>alert(1)</script>', ['E01'])],
      { explanation: '"><b>bold</b> & more', recommended_actions: ['<a href="javascript:alert(1)">fix</a>'] },
    )
    const record = await recordFor(raw, {}, hostile)
    record.case.id = '<i>case</i>'
    const page = html(
      buildReport(record, hostile, { ...PROVENANCE, E01: { file: 'f', line: 1, raw: '</code><script>x()</script>' } }),
    )
    expect(page).not.toMatch(/<script|<img|<b>|<i>|javascript:alert\(1\)">/)
    expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(page).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(page).toContain('&lt;/code&gt;&lt;script&gt;x()&lt;/script&gt;')
    expect(page).toContain('&quot;&gt;&lt;b&gt;bold&lt;/b&gt; &amp; more')
    expect(page).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`)
  })

  it('its own words never say an attack occurred or an account is compromised', async () => {
    // Model text here says neither; every such sentence left is the report's.
    const text = html(await reportOf(MIXED))
      .replace(/<[^>]+>/g, ' ')
      .replace(/ATT&amp;CK/g, '')
    const sentences = text.split(/(?<=[.:])\s+/).filter((s) => /attack|compromis/i.test(s))
    expect(sentences.length).toBeGreaterThan(0)
    for (const s of sentences) expect(s).toMatch(/\bnot\b/)
  })

  it('names where it ran and says the file holds the evidence', async () => {
    const page = html(await reportOf(MIXED))
    expect(page).toContain('Ran on this device: Gemini Nano. Nothing was sent to the cloud.')
    expect(page).toContain("This report contains the case's evidence.")
    expect(page).toContain(
      `<title>Investigation report: synthetic-sample, Gemini Nano (Chrome built-in), on-device, started 2026-11-13 09:00:00 UTC</title>`,
    )
  })

  it('names its own run and that run’s record, so no two runs share a report', async () => {
    const record = await recordFor(MIXED)
    const report = buildReport(record, EVENTS, PROVENANCE)
    const page = html(report)
    expect(page).toContain(recordFileName(record))
    const later = buildReport(
      { ...record, execution: { ...record.execution, startedAt: '2026-11-13T10:30:00.000Z' } },
      EVENTS,
      PROVENANCE,
    )
    expect(runLabel(later)).not.toBe(runLabel(report))
    expect(html(later)).not.toContain('<title>' + page.match(/<title>(.*?)<\/title>/)![1] + '</title>')
  })
})

describe('reportFileName', () => {
  it('matches the run record’s name', async () => {
    const record = await recordFor(MIXED)
    expect(reportFileName(buildReport(record, EVENTS, PROVENANCE))).toBe(
      recordFileName(record).replace(/\.run\.json$/, '.report.html'),
    )
    expect(reportFileName(await reportOf(MIXED))).toBe('synthetic-sample.on-device.20261113T090000Z.report.html')
  })
})

it('verdict labels are the four agreed words', () => {
  expect(Object.values(VERDICT_LABEL)).toEqual(['Verified', 'Rejected', 'Contradicted', 'Unchecked'])
})

describe('a finding is Verified only if every check passes', () => {
  // Each proposal is one finding that would pass but for one failed check.
  const cases: [string, unknown, string][] = [
    ['an event that does not exist', finding('logon', 'U900002@SYN logged on.', ['E02', 'E99']), 'cites event E99, which is not in the evidence'],
    ['a time not in the cited events', finding('logon', 'U900002@SYN logged on at 23:59.', ['E02']), 'mentions 23:59, which is not a time in the events it cites'],
    ['an account not in the cited events', finding('logon', 'U900004@SYN logged on.', ['E02']), 'mentions account u900004@syn, which is not in the events it cites'],
    ['a computer not in the cited events', finding('logon', 'U900002@SYN logged on to C900005.', ['E02']), 'mentions computer c900005, which is not in the events it cites'],
    ['the wrong kind of event', finding('sign_in_from_unrecognised_device', 'U900002@SYN logged on.', ['E02']), 'E02 is a "network logon" event, not "sign-in"'],
    ['no cited event', finding('logon', 'U900002@SYN logged on.', []), 'cites no event'],
  ]
  for (const [what, f, reason] of cases) {
    it(`Rejected for ${what}, with the reason`, async () => {
      const [only] = (await reportOf(output([f]))).findings
      expect(only.verdict).toBe('rejected')
      expect(only.reasons).toContain(reason)
    })
  }

  it('Rejected for repeating another finding, though the first stays Verified', async () => {
    const same = finding('logon', 'U900002@SYN logged on to C900002.', ['E02'])
    const [first, second] = (await reportOf(output([same, same]))).findings
    expect(first.verdict).toBe('verified')
    expect(second.verdict).toBe('rejected')
    expect(second.reasons).toEqual(['repeats finding 1'])
  })

  it('Contradicted for the opposite outcome, whichever way round', async () => {
    const [deniedAsSuccess, successAsDenied] = (
      await reportOf(
        output([
          finding('logon', 'U900001@SYN logged on to C900001.', ['E01']),
          finding('denied_logon', 'U900002@SYN was refused a logon to C900002.', ['E02']),
        ]),
      )
    ).findings
    expect(deniedAsSuccess.verdict).toBe('contradicted')
    expect(deniedAsSuccess.reasons).toEqual(['E01 has outcome "denied", not "success"'])
    expect(successAsDenied.verdict).toBe('contradicted')
  })

  it('a problem in the explanation does not change a finding’s verdict, and is reported on its own', async () => {
    const report = await reportOf(
      output([finding('logon', 'U900002@SYN logged on to C900002.', ['E02'])], {
        explanation: 'See E77 at 23:59.',
      }),
    )
    expect(report.findings[0].verdict).toBe('verified')
    expect(report.proposal!.explanationProblems).toEqual([
      'mentions event E77, which is not in the evidence',
      'mentions 23:59, which is not a time in the evidence',
    ])
  })
})

it('a report on unreadable output lists every event under "Events no finding cites"', async () => {
  const page = html(await reportOf('not json'))
  const uncited = page.slice(page.indexOf('Events no finding cites</h2>'), page.indexOf('How it ran</h2>'))
  for (const e of EVENTS) expect(uncited).toContain(`<strong>${e.id}</strong>`)
})
