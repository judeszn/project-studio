import { useEffect, useRef } from 'react'
import { InferenceMode } from 'firebase/ai'
import { attackUrl } from './lib/attack'
import { LOCAL_MODE } from './lib/hybrid'
import {
  NO_MODEL_NOTE,
  SYNTHETIC_NOTE,
  VERDICTS,
  VERDICT_LABEL,
  VERDICT_MEANING,
  VERIFICATION_NOTE,
  WORDS,
  limitsFor,
} from './lib/report'
import type { Report, ReportFinding, Verdict } from './lib/report'
import { EventList, Problems, Sub } from './ui'

// The investigation report on the page. It renders the same Report the
// exported file does (lib/report.ts), section for section, with the same
// labels for who wrote the proposal: a model, or, in the worked example, the
// Project Studio team.

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
  onRecord?: () => void // a real run only; the worked example has no run record
}) {
  const { run, proposal } = report
  const w = WORDS[report.author]
  const total = report.findings.length
  // On a phone the result lands below the buttons, out of sight.
  const top = useRef<HTMLElement>(null)
  useEffect(() => {
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])
  return (
    <section ref={top}>
      <h2>3. {run ? 'Investigation report' : w.title}</h2>
      {!run && (
        <p className="banner noModel">
          <strong>{NO_MODEL_NOTE}</strong>
        </p>
      )}
      {report.synthetic && <p className="warn synthetic">{SYNTHETIC_NOTE}</p>}
      {run && (
        <p className={`where ${run.location === 'cloud' ? 'cloud' : 'device'}`}>{report.where}</p>
      )}
      <p className="banner">
        <strong>{w.motto}</strong> {VERIFICATION_NOTE}
      </p>
      <div className="actions">
        <button onClick={onExport}>Export report (HTML)</button>
        {onRecord && (
          <button className="secondary" onClick={onRecord}>
            Download run record (JSON)
          </button>
        )}
      </div>
      <p className="hint">
        {onRecord
          ? 'Both are saved to your disk and contain the evidence. The report opens in any browser, without a network, and prints to PDF. The run record holds the prompts, their hashes and the raw output, for reproducing the run.'
          : 'The report is saved to your disk and contains the evidence. It opens in any browser, without a network, and prints to PDF. No run record exists: no model ran.'}
      </p>

      <dl>
        {run && (
          <>
            <dt>Inference source (reported by SDK)</dt>
            <dd className={sourceClass(run)}>
              {run.inferenceSource}
              {sourceNote(run)}
            </dd>
          </>
        )}
        <dt>{run ? 'Model output format (checked by code)' : 'Proposal format (checked by code)'}</dt>
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
            <dt>{w.classification}</dt>
            <dd>{proposal.classification}</dd>
            <dt>{w.confidence}</dt>
            <dd>{proposal.confidence}</dd>
          </>
        )}
      </dl>

      {!report.parsed && (
        <>
          <p className="fail">
            {w.unreadable}: it did not match the required format, so no finding was checked and
            every event is uncited.
          </p>
          <Problems items={report.parseErrors} />
        </>
      )}

      {proposal && (
        <>
          <Sub title={w.proposal} status="not verified" open>
            <p className="hint">{w.proposalNote}</p>
            <p className="label">{w.explanation}</p>
            <p>{proposal.explanation}</p>
            <Problems items={proposal.explanationProblems} />
            <dl>
              <dt>{w.classification}</dt>
              <dd>{proposal.classification}</dd>
              <dt>{w.confidence}</dt>
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
                <FindingItem key={f.number} finding={f} claimBy={w.claim} />
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
        <Sub
          title="Recommended actions"
          status={`${proposal.actions.length}, ${run ? 'proposed' : 'written for the example'}, not taken`}
        >
          <p className="hint">{w.actions}</p>
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
        title={run ? 'How it ran' : 'How it was made'}
        status={
          run
            ? `${run.sdkMode} · ${run.latencyMs === null ? '?' : (run.latencyMs / 1000).toFixed(1)} s · consent ${run.consent ? 'given' : 'not given'}`
            : 'no model ran'
        }
      >
        <dl>
          {run ? (
            <>
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
            </>
          ) : (
            <>
              <dt>Proposal written by</dt>
              <dd>the Project Studio team, not a model</dd>
              <dt>Model</dt>
              <dd>none: no model ran</dd>
              <dt>Cloud</dt>
              <dd>not used: nothing was sent</dd>
            </>
          )}
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
          {run && (
            <>
              <dt>SHA-256 of the system prompt</dt>
              <dd className="hash">{run.systemSha256}</dd>
              <dt>SHA-256 of the evidence prompt</dt>
              <dd className="hash">{run.userSha256}</dd>
            </>
          )}
        </dl>
      </Sub>

      <Sub title="All evidence" status={`${report.evidence.length} events`}>
        <p className="hint">{w.evidence}</p>
        <EventList events={report.evidence} />
      </Sub>

      <Sub title={w.raw}>
        <pre>{report.raw}</pre>
      </Sub>

      <Sub title="Limits of verification">
        <ul>
          {limitsFor(report.author).map((limit) => (
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

function FindingItem({ finding: f, claimBy }: { finding: ReportFinding; claimBy: string }) {
  return (
    <li className={`finding ${f.verdict}`}>
      <div>
        <span className={`verdict ${f.verdict}`}>{VERDICT_LABEL[f.verdict]}</span>{' '}
        <strong>Finding {f.number}</strong> <span className="hint">· {f.type}</span>
      </div>
      <p>
        <span className="hint">{claimBy}</span> {f.claim}
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
function sourceClass(run: NonNullable<Report['run']>): string {
  if (run.sdkMode === LOCAL_MODE) return run.inferenceSource === 'on_device' ? 'ok' : 'fail'
  return 'ok'
}

function sourceNote(run: NonNullable<Report['run']>): string {
  if (run.sdkMode === LOCAL_MODE) return run.inferenceSource === 'on_device' ? '' : ' (unexpected)'
  if (run.inferenceSource !== 'on_device') return ''
  return run.sdkMode === InferenceMode.PREFER_IN_CLOUD
    ? ' (the cloud call failed, so the SDK used Gemini Nano)'
    : ' (Gemini Nano had become available, so nothing was sent)'
}
