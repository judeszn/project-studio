import { useEffect, useRef } from 'react'
import { InferenceMode } from 'firebase/ai'
import { attackUrl } from './lib/attack'
import { LOCAL_MODE } from './lib/hybrid'
import {
  LIMITS,
  PROPOSAL_NOTE,
  SYNTHETIC_NOTE,
  VERDICTS,
  VERDICT_LABEL,
  VERDICT_MEANING,
  VERIFICATION_NOTE,
} from './lib/report'
import type { Report, ReportFinding, Verdict } from './lib/report'
import { EventList, Problems, Sub } from './ui'

// The investigation report on the page. It renders the same Report the
// exported file does (lib/report.ts), section for section.

const VERDICT_CLASS: Record<Verdict, string> = {
  verified: 'ok',
  rejected: 'fail',
  contradicted: 'fail',
  unchecked: 'warn',
}

export function ReportView({
  report,
  onExport,
  onRecord,
}: {
  report: Report
  onExport: () => void
  onRecord: () => void
}) {
  const { run, proposal } = report
  const total = report.findings.length
  // On a phone the result lands below the buttons, out of sight.
  const top = useRef<HTMLElement>(null)
  useEffect(() => {
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])
  return (
    <section ref={top}>
      <h2>3. Investigation report</h2>
      {report.synthetic && <p className="warn synthetic">{SYNTHETIC_NOTE}</p>}
      <p className={`where ${run.location === 'cloud' ? 'cloud' : 'device'}`}>{report.where}</p>
      <p className="banner">
        <strong>AI proposes. Code checks. The analyst decides.</strong> {VERIFICATION_NOTE}
      </p>
      <div className="actions">
        <button onClick={onExport}>Export report (HTML)</button>
        <button className="secondary" onClick={onRecord}>
          Download run record (JSON)
        </button>
      </div>
      <p className="hint">
        Both are saved to your disk and contain the evidence. The report opens in any browser,
        without a network, and prints to PDF. The run record holds the prompts, their hashes and
        the raw output, for reproducing the run.
      </p>

      <dl>
        <dt>Inference source (reported by SDK)</dt>
        <dd className={sourceClass(report)}>
          {run.inferenceSource}
          {sourceNote(report)}
        </dd>
        <dt>Model output format (checked by code)</dt>
        <dd className={report.parsed ? 'ok' : 'fail'}>{report.parsed ? 'valid' : 'invalid'}</dd>
        {proposal && (
          <>
            {VERDICTS.map((v) => (
              <VerdictCount key={v} verdict={v} count={report.counts[v]} />
            ))}
            <dt>Events covered by verified findings (by code)</dt>
            <dd>
              {report.covered.length} of {report.case.events}
            </dd>
            <dt>Events no finding cites</dt>
            <dd className={report.uncited.length > 0 ? 'warn' : ''}>
              {report.uncited.length} of {report.case.events}
            </dd>
            <dt>Classification (proposed by the model, not verified)</dt>
            <dd>{proposal.classification}</dd>
            <dt>Confidence (the model's own, not verified)</dt>
            <dd>{proposal.confidence}</dd>
          </>
        )}
      </dl>

      {!report.parsed && (
        <>
          <p className="fail">
            The output did not match the required format, so no finding was checked and every
            event is uncited.
          </p>
          <Problems items={report.parseErrors} />
        </>
      )}

      {proposal && (
        <>
          <Sub title="The model's proposal" status="not verified" open>
            <p className="hint">{PROPOSAL_NOTE}</p>
            <p className="label">Explanation, written by the model</p>
            <p>{proposal.explanation}</p>
            <Problems items={proposal.explanationProblems} />
            <dl>
              <dt>Classification (proposed, not verified)</dt>
              <dd>{proposal.classification}</dd>
              <dt>Confidence (the model's own, not verified)</dt>
              <dd>{proposal.confidence}</dd>
            </dl>
          </Sub>

          <Sub title="Findings" status={`${report.counts.verified} of ${total} verified`} open>
            <ul className="hint meanings">
              {VERDICTS.map((v) => (
                <li key={v}>
                  <span className={`verdict ${v}`}>{VERDICT_LABEL[v]}</span> {VERDICT_MEANING[v]}
                </li>
              ))}
            </ul>
            <p className="hint">No check reads the wording of a claim.</p>
            <Problems items={report.findingsProblems} />
            <ol className="findings">
              {report.findings.map((f) => (
                <FindingItem key={f.number} finding={f} />
              ))}
            </ol>
          </Sub>
        </>
      )}

      <Sub
        title="Events no finding cites"
        status={`${report.uncited.length} of ${report.case.events}`}
        open={report.uncited.length > 0}
      >
        <p className="hint">
          Code does not judge whether these matter. They are listed so that nothing is left
          out silently.
        </p>
        {report.uncited.length > 0 ? <EventList events={report.uncited} /> : <p>None.</p>}
      </Sub>

      {proposal && (
        <Sub title="Recommended actions" status={`${proposal.actions.length}, proposed, not taken`}>
          <p className="hint">Proposed by the model. Not taken, and not verified.</p>
          <ol>
            {proposal.actions.map((a, i) => (
              <li key={i}>
                {a.text}
                <Problems items={a.problems} />
              </li>
            ))}
          </ol>
        </Sub>
      )}

      <Sub
        title="How it ran"
        status={`${run.sdkMode} · ${run.latencyMs === null ? '?' : (run.latencyMs / 1000).toFixed(1)} s · consent ${run.consent ? 'given' : 'not given'}`}
      >
        <dl>
          <dt>Inference requested</dt>
          <dd>{run.requested === 'on_device' ? 'on this device' : 'in the cloud'}</dd>
          <dt>Model</dt>
          <dd>{run.model ?? 'none'}</dd>
          <dt>Cloud allowed for this case</dt>
          <dd>{run.cloudAllowed ? 'yes' : 'no'}</dd>
          <dt>Consent to send evidence to the cloud</dt>
          <dd>{run.consent ? 'given' : 'not given; nothing was sent'}</dd>
          <dt>Inference preference (SDK mode)</dt>
          <dd>{run.sdkMode}</dd>
          <dt>Latency</dt>
          <dd>{run.latencyMs === null ? 'not recorded' : `${run.latencyMs} ms`}</dd>
          <dt>Network during run</dt>
          <dd>
            {run.onlineAtStart ? 'online' : 'offline'} at start,{' '}
            {run.onlineAtEnd ? 'online' : 'offline'} at end
          </dd>
          <dt>Case file</dt>
          <dd>{report.case.fileName ?? 'built-in case'}</dd>
          {report.case.source && (
            <>
              <dt>Source</dt>
              <dd>
                {report.case.source.dataset} ({report.case.source.file})
              </dd>
              <dt>Citation</dt>
              <dd>{report.case.source.citation}</dd>
            </>
          )}
          <dt>SHA-256 of the case</dt>
          <dd className="hash">{report.case.sha256}</dd>
          <dt>SHA-256 of the system prompt</dt>
          <dd className="hash">{run.systemSha256}</dd>
          <dt>SHA-256 of the evidence prompt</dt>
          <dd className="hash">{run.userSha256}</dd>
        </dl>
      </Sub>

      <Sub title="All evidence" status={`${report.evidence.length} events`}>
        <p className="hint">
          Every event the model was given, with the original record where the case file holds it.
        </p>
        <EventList events={report.evidence} />
      </Sub>

      <Sub title="Raw model output">
        <pre>{report.raw}</pre>
      </Sub>

      <Sub title="Limits of verification">
        <ul>
          {LIMITS.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      </Sub>
    </section>
  )
}

function VerdictCount({ verdict, count }: { verdict: Verdict; count: number }) {
  return (
    <>
      <dt>Findings {VERDICT_LABEL[verdict].toLowerCase()} (by code)</dt>
      <dd className={count > 0 ? VERDICT_CLASS[verdict] : ''}>{count}</dd>
    </>
  )
}

function FindingItem({ finding: f }: { finding: ReportFinding }) {
  return (
    <li className={`finding ${f.verdict}`}>
      <div>
        <span className={`verdict ${f.verdict}`}>{VERDICT_LABEL[f.verdict]}</span>{' '}
        <strong>Finding {f.number}</strong> <span className="hint">· {f.type}</span>
      </div>
      <p>
        <span className="hint">Claim, written by the model:</span> {f.claim}
      </p>
      {f.note && <p className="hint">{f.note}</p>}
      {f.reasons.length > 0 && (
        <>
          <p className="label">Why it is not verified</p>
          <Problems items={f.reasons} />
        </>
      )}
      {f.attack && (
        <p className="hint">
          ATT&amp;CK reference, if this was adversary activity:{' '}
          <a href={attackUrl(f.attack.id)} target="_blank" rel="noreferrer">
            {f.attack.id} {f.attack.name}
          </a>
          . A reference, not a conclusion.
        </p>
      )}
      <details className="cited" open>
        <summary>
          Cited evidence: {f.cited.map((c) => c.event.id).concat(f.missing).join(', ') || 'none'}
        </summary>
        {f.cited.length > 0 ? (
          <EventList events={f.cited} />
        ) : (
          <p className="hint">No cited event is in the evidence.</p>
        )}
      </details>
      {f.missing.length > 0 && (
        <p className="fail">Cited but not in the evidence: {f.missing.join(', ')}</p>
      )}
    </li>
  )
}

// Without consent the only mode is LOCAL_MODE, so anything but on_device there
// is a fault. After consent either source is legitimate; the note says why.
function sourceClass({ run }: Report): string {
  if (run.sdkMode === LOCAL_MODE) return run.inferenceSource === 'on_device' ? 'ok' : 'fail'
  return 'ok'
}

function sourceNote({ run }: Report): string {
  if (run.sdkMode === LOCAL_MODE) return run.inferenceSource === 'on_device' ? '' : ' (unexpected)'
  if (run.inferenceSource !== 'on_device') return ''
  return run.sdkMode === InferenceMode.PREFER_IN_CLOUD
    ? ' (the cloud call failed, so the SDK used Gemini Nano)'
    : ' (Gemini Nano had become available, so nothing was sent)'
}
