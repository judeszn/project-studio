import { ATTACK_NOTICE, ATTACK_REFERENCES, attackUrl } from './attack'
import type { AttackReference } from './attack'
import type { Provenance } from './casefile'
import { recordFileName } from './record'
import type { RunRecord } from './record'
import type { FindingType, LogEvent } from './schema'
import type { FindingSupport, Problem, Verification } from './verify'

// The investigation report: one structure, built from a completed run's
// record and the case's evidence, that both the page and the exported HTML
// file render. Neither adds, drops or rewords anything: every finding, every
// reason it failed, every uncited event and the original records are carried
// through, and the model's text is always labelled as the model's.

// One verdict per finding, decided by code from the checks in verify.ts:
//   verified      passes every check
//   contradicted  a cited event records the opposite of what its type states
//   rejected      any other check failed: a missing event, a time or account
//                 not in the cited events, the wrong kind of event, a repeat
//   unchecked     type "other", which has no rule; nothing else failed
// A contradicted finding may fail other checks too; they are listed with it.
export type Verdict = 'verified' | 'rejected' | 'contradicted' | 'unchecked'

export const VERDICTS: readonly Verdict[] = ['verified', 'rejected', 'contradicted', 'unchecked']

export const VERDICT_LABEL: Record<Verdict, string> = {
  verified: 'Verified',
  rejected: 'Rejected',
  contradicted: 'Contradicted',
  unchecked: 'Unchecked',
}

export const VERDICT_MEANING: Record<Verdict, string> = {
  verified:
    'The cited events exist, are of the kind and outcome its type states, and the times and accounts it quotes belong to them. This checks the evidence for the finding, not the conclusion drawn from it.',
  rejected: 'At least one check failed. The reasons are listed.',
  contradicted: 'A cited event records the opposite of what the finding states.',
  unchecked:
    'Type "other" has no rule in code, so whether its cited events show its claim is not checked. Never counted as verified.',
}

// What a type does and does not say, beside every finding of it.
export const TYPE_NOTE: Partial<Record<FindingType, string>> = {
  logon: 'A logon is an account authenticating to a computer. It is not by itself an attack.',
  denied_logon:
    'A denied logon is an attempt the evidence records as refused. It does not show that access was obtained, that an account is compromised, or an attack.',
}

export const PROPOSAL_NOTE =
  'The explanation, classification, confidence and recommended actions are written by the AI model. They are proposals. Code checks only that the events, times and accounts they name are in the evidence; it does not check what they claim.'

export const VERIFICATION_NOTE =
  'Verification checks each finding against the events it cites. It does not show that an attack occurred, that an account is compromised, or that the classification is right. The analyst decides.'

export const SYNTHETIC_NOTE =
  'Synthetic demonstration data: fictional events, people and systems. This run shows how the checks treat a model\'s claims; it is not a measure of detection accuracy.'

export const LIMITS = [
  VERIFICATION_NOTE,
  PROPOSAL_NOTE,
  "A check that passes says the cited records show what the finding's type states; it does not say the claim's wording is accurate.",
]

export interface ReportEvent {
  event: LogEvent
  provenance: Provenance | null // the original record, for a case file
}

export interface ReportFinding {
  number: number // 1-based, as the model listed it
  type: FindingType
  claim: string // the model's words
  verdict: Verdict
  reasons: string[] // why it is not verified; empty only when verified
  cited: ReportEvent[] // cited events that exist, in the order cited
  missing: string[] // cited IDs that are not in the evidence
  note: string | null
  attack: AttackReference | null // only on a verified finding
}

export interface Report {
  case: RunRecord['case']
  synthetic: boolean // the built-in and demo cases, never a case file
  run: {
    location: RunRecord['execution']['location']
    model: string | null
    inferenceSource: string | null
    sdkMode: string | null
    requested: RunRecord['execution']['requested']
    cloudAllowed: boolean
    consent: boolean
    latencyMs: number | null
    startedAt: string
    finishedAt: string
    onlineAtStart: boolean
    onlineAtEnd: boolean
    systemSha256: string
    userSha256: string
  }
  where: string
  parsed: boolean
  parseErrors: string[]
  proposal: {
    classification: string
    confidence: string
    explanation: string
    explanationProblems: string[]
    actions: { text: string; problems: string[] }[]
  } | null
  findings: ReportFinding[]
  findingsProblems: string[] // about the list as a whole ("no findings")
  counts: Record<Verdict, number>
  covered: string[] // event IDs cited by verified findings
  uncited: ReportEvent[] // events no finding cites; all of them if the output did not parse
  evidence: ReportEvent[] // every event, in evidence order
  raw: string
}

// Where the answer came from, in the words the page uses.
export function whereItRan(record: RunRecord): string {
  const { location, consentToSendToCloud, model } = record.execution
  if (location === 'on-device') {
    return consentToSendToCloud
      ? 'Ran on this device: Gemini Nano, after you agreed to the cloud.'
      : 'Ran on this device: Gemini Nano. Nothing was sent to the cloud.'
  }
  if (location === 'cloud') {
    return `Ran in the cloud: ${model}. The evidence was sent after your consent.`
  }
  return 'The SDK did not report where this ran.'
}

function verdictOf(support: FindingSupport, passes: boolean, problems: string[]): Verdict {
  if (passes) return 'verified'
  if (support.status === 'contradicted') return 'contradicted'
  if (support.status === 'unchecked' && problems.length === 0) return 'unchecked'
  return 'rejected'
}

const at = (problems: Problem[], path: string) =>
  problems.filter((p) => p.path === path).map((p) => p.problem)

export function buildReport(
  record: RunRecord,
  events: LogEvent[],
  provenance: Record<string, Provenance> | null,
): Report {
  const verification: Verification | null = record.verification
  const raw = record.output.raw
  if (record.execution.outcome !== 'completed' || verification === null || raw === null) {
    throw new Error('a report needs a completed run')
  }
  const withProvenance = (event: LogEvent): ReportEvent => ({
    event,
    provenance: provenance?.[event.id] ?? null,
  })
  const byId = new Map(events.map((e) => [e.id, e]))
  const { execution, prompt } = record
  const base = {
    case: record.case,
    synthetic: record.case.origin !== 'case file',
    run: {
      location: execution.location,
      model: execution.model,
      inferenceSource: execution.inferenceSource,
      sdkMode: execution.sdkMode,
      requested: execution.requested,
      cloudAllowed: execution.cloudAllowed,
      consent: execution.consentToSendToCloud,
      latencyMs: execution.latencyMs,
      startedAt: execution.startedAt,
      finishedAt: execution.finishedAt,
      onlineAtStart: execution.onlineAtStart,
      onlineAtEnd: execution.onlineAtEnd,
      systemSha256: prompt.systemSha256,
      userSha256: prompt.userSha256,
    },
    where: whereItRan(record),
    evidence: events.map(withProvenance),
    raw,
  }
  const counts = Object.fromEntries(VERDICTS.map((v) => [v, 0])) as Record<Verdict, number>

  const { parse, problems, support, passes, covered, uncited } = verification
  if (!parse.ok) {
    return {
      ...base,
      parsed: false,
      parseErrors: parse.errors,
      proposal: null,
      findings: [],
      findingsProblems: [],
      counts,
      covered: [],
      uncited: events.map(withProvenance),
    }
  }

  const { proposal } = parse
  const findings = proposal.findings.map((finding, i): ReportFinding => {
    const own = at(problems, `findings[${i}]`)
    const verdict = verdictOf(support[i], passes[i], own)
    counts[verdict] += 1
    const reasons =
      verdict === 'verified'
        ? []
        : [
            ...own,
            ...support[i].notes,
            ...(support[i].status === 'unchecked' ? ['Type "other": no rule in code checks it.'] : []),
          ]
    return {
      number: i + 1,
      type: finding.type,
      claim: finding.claim,
      verdict,
      // A finding that is not verified always says why.
      reasons: reasons.length > 0 || verdict === 'verified' ? reasons : ['Not supported by its cited events.'],
      cited: finding.event_ids.flatMap((id) => {
        const event = byId.get(id)
        return event ? [withProvenance(event)] : []
      }),
      missing: finding.event_ids.filter((id) => !byId.has(id)),
      note: TYPE_NOTE[finding.type] ?? null,
      attack: verdict === 'verified' ? ATTACK_REFERENCES[finding.type] : null,
    }
  })

  return {
    ...base,
    parsed: true,
    parseErrors: [],
    proposal: {
      classification: proposal.classification,
      confidence: proposal.confidence,
      explanation: proposal.explanation,
      explanationProblems: at(problems, 'explanation'),
      actions: proposal.recommended_actions.map((text, i) => ({
        text,
        problems: at(problems, `recommended_actions[${i}]`),
      })),
    },
    findings,
    findingsProblems: at(problems, 'findings'),
    counts,
    covered,
    uncited: uncited.flatMap((id) => {
      const event = byId.get(id)
      return event ? [withProvenance(event)] : []
    }),
  }
}

export const reportFileName = (record: RunRecord) =>
  recordFileName(record).replace(/\.run\.json$/, '.report.html')

// ---- The exported file ------------------------------------------------------
//
// A single HTML file with no script, no external resource and a policy that
// forbids both, so it opens offline and evidence or model text that looks like
// markup is shown as text. Every value from the evidence, the case file or the
// model goes through `esc`.

export function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const list = (items: string[], cls = '') =>
  items.length === 0 ? '' : `<ul${cls ? ` class="${cls}"` : ''}>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`

const row = (label: string, value: unknown, cls = '') =>
  `<tr><th>${esc(label)}</th><td${cls ? ` class="${cls}"` : ''}>${esc(value)}</td></tr>`

function eventHtml({ event: e, provenance: p }: ReportEvent): string {
  return (
    `<div class="event"><div><strong>${esc(e.id)}</strong> <span class="muted">${esc(e.date)} ${esc(e.time)} · ${esc(e.source)}</span></div>` +
    `<div>${esc(e.actor)} · ${esc(e.action)}: ${esc(e.target)} · ${esc(e.outcome)}</div>` +
    `<div class="muted">${esc(e.detail)}</div>` +
    (p
      ? `<div class="muted">Original record, ${esc(p.file)} line ${esc(p.line)}: <code>${esc(p.raw)}</code></div>`
      : '') +
    `</div>`
  )
}

function findingHtml(f: ReportFinding): string {
  return (
    `<article class="finding ${f.verdict}">` +
    `<h3><span class="verdict ${f.verdict}">${VERDICT_LABEL[f.verdict]}</span> Finding ${f.number} · ${esc(f.type)}</h3>` +
    `<p class="muted">${esc(VERDICT_MEANING[f.verdict])}</p>` +
    `<p><span class="muted">Claim, written by the model:</span> ${esc(f.claim)}</p>` +
    (f.note ? `<p class="muted">${esc(f.note)}</p>` : '') +
    (f.reasons.length > 0 ? `<p class="label">Why it is not verified</p>${list(f.reasons, 'fail')}` : '') +
    (f.attack
      ? `<p class="muted">ATT&amp;CK reference, if this was adversary activity: <a href="${esc(attackUrl(f.attack.id))}">${esc(f.attack.id)} ${esc(f.attack.name)}</a>. A reference, not a conclusion.</p>`
      : '') +
    `<p class="label">Cited evidence</p>` +
    (f.cited.length > 0 ? f.cited.map(eventHtml).join('') : '<p class="muted">No cited event is in the evidence.</p>') +
    (f.missing.length > 0
      ? `<p class="fail">Cited but not in the evidence: ${esc(f.missing.join(', '))}</p>`
      : '') +
    `</article>`
  )
}

const STYLE = `
body{margin:0;background:#fff;color:#16191f;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:52rem;margin:0 auto;padding:1.5rem 1rem 3rem}
h1{font-size:1.5rem;margin:0 0 .25rem}h2{font-size:1.15rem;margin:2rem 0 .5rem;padding-top:.5rem;border-top:2px solid #16191f}
h3{font-size:1rem;margin:0 0 .25rem}
.muted{color:#5b6472}.fail{color:#b42318}.warn{color:#96580a}.ok{color:#14713a}.label{font-weight:600;margin:.75rem 0 .25rem}
.banner{padding:.75rem 1rem;border:1px solid #d9dde3;border-left:4px solid #1a56db;border-radius:6px;margin:1rem 0}
table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:.3rem .5rem;border-bottom:1px solid #d9dde3}
th{width:40%;font-weight:600;color:#5b6472}td{overflow-wrap:anywhere}
.finding{border:1px solid #d9dde3;border-left-width:4px;border-radius:6px;padding:.75rem 1rem;margin:.75rem 0;break-inside:avoid}
.finding.verified{border-left-color:#14713a}.finding.rejected,.finding.contradicted{border-left-color:#b42318}.finding.unchecked{border-left-color:#96580a}
.verdict{display:inline-block;padding:0 .5rem;margin-right:.35rem;border-radius:4px;color:#fff;font-size:.85rem}
.verdict.verified{background:#14713a}.verdict.rejected,.verdict.contradicted{background:#b42318}.verdict.unchecked{background:#96580a}
.event{padding:.4rem 0;border-bottom:1px solid #eceef1;overflow-wrap:anywhere}
code,pre{font:12px/1.45 ui-monospace,Menlo,Consolas,monospace}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f6f7f9;padding:.75rem;border-radius:6px}
@media print{main{padding:0}h2{break-after:avoid}a{color:inherit}}
`

export function reportHtml(report: Report, generatedAt: string): string {
  const { run } = report
  const c = report.case
  const p = report.proposal
  const title = `Investigation report: ${c.id}`
  const sections = [
    `<h1>${esc(title)}</h1>`,
    `<p class="muted">Project Studio. Report generated ${esc(generatedAt)}. Run started ${esc(run.startedAt)}.</p>`,
    `<div class="banner"><strong>AI proposes. Code checks. The analyst decides.</strong><br>${esc(VERIFICATION_NOTE)}</div>`,
    report.synthetic ? `<p class="warn"><strong>${esc(SYNTHETIC_NOTE)}</strong></p>` : '',
    `<p><strong>${esc(report.where)}</strong></p>`,
    `<p class="warn">This report contains the case's evidence. Handle it as you handle the case.</p>`,

    `<h2>Summary</h2>`,
    `<table>` +
      row('Case', c.id) +
      row('Events in the case', c.events) +
      (report.parsed
        ? VERDICTS.map((v) => row(`Findings ${VERDICT_LABEL[v].toLowerCase()} (by code)`, report.counts[v])).join('') +
          row('Events covered by verified findings (by code)', `${report.covered.length} of ${c.events}`) +
          row('Events no finding cites', `${report.uncited.length} of ${c.events}`) +
          row('Classification (proposed by the model, not verified)', p!.classification) +
          row("Confidence (the model's own, not verified)", p!.confidence)
        : row('Model output', 'could not be read; no finding was checked', 'fail')) +
      `</table>`,

    ...(report.parsed
      ? [
          `<h2>The model's proposal</h2>`,
          `<p class="muted">${esc(PROPOSAL_NOTE)}</p>`,
          `<p class="label">Explanation, written by the model</p><p>${esc(p!.explanation)}</p>`,
          list(p!.explanationProblems, 'fail'),
          `<table>` +
            row('Classification (proposed, not verified)', p!.classification) +
            row("Confidence (the model's own, not verified)", p!.confidence) +
            `</table>`,

          `<h2>Findings</h2>`,
          `<p class="muted">${VERDICTS.map((v) => `${VERDICT_LABEL[v]}: ${esc(VERDICT_MEANING[v])}`).join(' ')} No check reads the wording of a claim.</p>`,
          list(report.findingsProblems, 'fail'),
          report.findings.map(findingHtml).join(''),
        ]
      : [
          `<h2>Model output could not be read</h2>`,
          `<p class="muted">The output did not match the required format, so no finding was checked and every event is uncited.</p>`,
          list(report.parseErrors, 'fail'),
        ]),

    `<h2>Events no finding cites</h2>`,
    `<p class="muted">Code does not judge whether these matter. They are listed so that nothing is left out silently.</p>`,
    report.uncited.length > 0 ? report.uncited.map(eventHtml).join('') : '<p>None.</p>',

    ...(report.parsed
      ? [
          `<h2>Recommended actions</h2>`,
          `<p class="muted">Proposed by the model. Not taken, and not verified.</p>`,
          `<ol>${p!.actions.map((a) => `<li>${esc(a.text)}${list(a.problems, 'fail')}</li>`).join('')}</ol>`,
        ]
      : []),

    `<h2>How it ran</h2>`,
    `<table>` +
      row('Case file', c.fileName ?? 'built-in case') +
      row('SHA-256 of the case', c.sha256) +
      (c.source
        ? row('Source', `${c.source.dataset} (${c.source.file})`) + row('Citation', c.source.citation)
        : '') +
      row('Inference requested', run.requested === 'on_device' ? 'on this device' : 'in the cloud') +
      row('Where it ran (reported by the SDK)', `${run.location} (${run.inferenceSource ?? 'none'})`) +
      row('Model', run.model ?? 'none') +
      row('SDK mode', run.sdkMode ?? 'none') +
      row('Cloud allowed for this case', run.cloudAllowed ? 'yes' : 'no') +
      row('Consent to send evidence to the cloud', run.consent ? 'given' : 'not given; nothing was sent') +
      row('Latency', run.latencyMs === null ? 'not recorded' : `${(run.latencyMs / 1000).toFixed(1)} s`) +
      row('Started', run.startedAt) +
      row('Finished', run.finishedAt) +
      row('Network', `${run.onlineAtStart ? 'online' : 'offline'} at start, ${run.onlineAtEnd ? 'online' : 'offline'} at end`) +
      row('SHA-256 of the system prompt', run.systemSha256) +
      row('SHA-256 of the evidence prompt', run.userSha256) +
      `</table>`,

    `<h2>All evidence</h2>`,
    `<p class="muted">Every event the model was given, with the original record where the case file holds it.</p>`,
    report.evidence.map(eventHtml).join(''),

    `<h2>Raw model output</h2>`,
    `<pre>${esc(report.raw)}</pre>`,

    `<h2>Limits of verification</h2>`,
    list(LIMITS),
    `<p class="muted">MITRE ATT&amp;CK® references: ${esc(ATTACK_NOTICE)}</p>`,
  ]
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${esc(title)}</title><style>${STYLE}</style></head>` +
    `<body><main>${sections.join('\n')}</main></body></html>`
  )
}
