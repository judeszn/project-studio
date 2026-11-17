import { useEffect, useRef } from 'react'
import { InferenceMode } from 'firebase/ai'
import { attackUrl } from './lib/attack'
import { LOCAL_MODE } from './lib/hybrid'
import {
  NO_MODEL_NOTE,
  VERDICTS,
  VERDICT_LABEL,
  VERDICT_MEANING,
  VERIFICATION_NOTE,
  WORDS,
  limitsFor,
  runLabel,
} from './lib/report'
import type { Report, ReportFinding } from './lib/report'
import { EventList, Problems, Sub } from './ui'

// The investigation report on the page. It renders the same Report the
// exported file does (lib/report.ts), with the same labels for who wrote the
// proposal: a model, or, in the worked example, the Project Studio team.
//
// The order is the analyst's: the overall result, the verdict counts and
// evidence coverage, then each finding, then the proposal's own explanation
// and classification. How it ran, the evidence and the limits follow, folded
// away but never dropped. The page shows the simulated-data notice above the
// tabs, so it is not repeated here.

export function ReportView({
  report,
  onExport,
  onRecord,
  showActions = true,
}: {
  report: Report
  onExport: () => void
  onRecord?: () => void // a real run only; the worked example has no run record
  showActions?: boolean // false where the page offers exports elsewhere (the Report tab)
}) {
  const { run, proposal, counts } = report
  const w = WORDS[report.author]
  const total = report.findings.length
  const notVerified = total - counts.verified
  const tone = !report.parsed || (total > 0 && counts.verified === 0)
    ? 'fail'
    : total > 0 && counts.verified === total
      ? 'ok'
      : 'warn'
  // On a phone the result lands below the buttons, out of sight.
  const top = useRef<HTMLElement>(null)
  useEffect(() => {
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])
  return (
    <section ref={top} className="card" role="tabpanel" aria-label="Findings">
      <h2>{run ? 'Findings' : w.title}</h2>
      {run && <p className="meta run-label">This run: {runLabel(report)}</p>}

      <div className={`result is-${tone}`}>
        {report.parsed ? (
          <p className="result-head">
            {total > 0 ? (
              <>
                <strong>
                  {counts.verified} of {total} findings verified against the evidence they cite.
                </strong>{' '}
                {notVerified > 0 &&
                  `${notVerified} ${notVerified === 1 ? 'was' : 'were'} not verified; each lists why.`}
              </>
            ) : (
              <strong>The proposal contains no findings.</strong>
            )}
          </p>
        ) : (
          <>
            <p className="result-head">
              <strong>{w.unreadable}.</strong>
            </p>
            <p>
              It did not match the required format, so no finding was checked and every event is
              uncited.
            </p>
            <Problems items={report.parseErrors} />
          </>
        )}
        {run ? (
          <p
            className={`result-where ${run.location === 'cloud' ? 'cloud' : 'device'}${sourceClass(run) === 'fail' ? ' fail' : ''}`}
          >
            {report.where}
            {sourceNote(run)}
          </p>
        ) : (
          <p className="result-where analyst">{NO_MODEL_NOTE}</p>
        )}
        <details className="caveat">
          <summary>{w.motto}</summary>
          <p className="hint">{VERIFICATION_NOTE}</p>
        </details>
      </div>

      {showActions && (
        <>
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
        </>
      )}

      {proposal && (
        <>
          <div className="tiles" aria-label="Verdicts, decided by code">
            {VERDICTS.map((v) => (
              <div key={v} className={`tile ${v}`}>
                <span>{VERDICT_LABEL[v]}</span>
                <strong>{counts[v]}</strong>
              </div>
            ))}
          </div>
          <p className="hint coverage-label">
            Evidence coverage: {report.covered.length} of {report.case.events} events cited by
            verified findings; {report.uncited.length} cited by no finding.
          </p>
          <div className="coverage" aria-hidden="true">
            <span style={{ width: `${(100 * report.covered.length) / Math.max(1, report.case.events)}%` }} />
          </div>

          <div className="section-head">
            <h3>Findings</h3>
            <span className="status">
              {counts.verified} of {total} verified
            </span>
          </div>
          <details className="legend">
            <summary>What the verdicts mean</summary>
            <ul className="meanings">
              {VERDICTS.map((v) => (
                <li key={v}>
                  <span className={`verdict ${v}`}>{VERDICT_LABEL[v]}</span> {VERDICT_MEANING[v]}
                </li>
              ))}
            </ul>
            <p className="hint">No check reads the wording of a claim.</p>
          </details>
          <Problems items={report.findingsProblems} />
          <ol className="findings">
            {report.findings.map((f) => (
              <FindingItem key={f.number} finding={f} claimBy={w.claim} />
            ))}
          </ol>

          <Sub
            title={run ? 'AI explanation and classification' : 'Explanation and classification'}
            status="not verified"
            open
          >
            <dl>
              <dt>{w.classification}</dt>
              <dd>{proposal.classification}</dd>
              <dt>{w.confidence}</dt>
              <dd>{proposal.confidence}</dd>
            </dl>
            <p className="label">{w.explanation}</p>
            <p>{proposal.explanation}</p>
            <Problems items={proposal.explanationProblems} />
            <p className="hint">{w.proposalNote}</p>
          </Sub>

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
        </>
      )}

      <p className="group-label">Evidence and technical detail</p>

      <Sub
        title="Events no finding cites"
        status={`${report.uncited.length} of ${report.case.events}`}
        open={!report.parsed}
      >
        <p className="hint">
          Code does not judge whether these matter. They are listed so that nothing is left
          out silently.
        </p>
        {report.uncited.length > 0 ? <EventList events={report.uncited} /> : <p>None.</p>}
      </Sub>

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
              <dt>Inference source (reported by SDK)</dt>
              <dd className={sourceClass(run)}>
                {run.inferenceSource}
                {sourceNote(run)}
              </dd>
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
          <dt>{run ? 'Model output format (checked by code)' : 'Proposal format (checked by code)'}</dt>
          <dd className={report.parsed ? 'ok' : 'fail'}>{report.parsed ? 'valid' : 'invalid'}</dd>
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

// The claim leads; the type's note and the evidence follow. A verified
// finding's evidence starts folded; a finding that failed a check shows its
// evidence open, beside the reasons.
function FindingItem({ finding: f, claimBy }: { finding: ReportFinding; claimBy: string }) {
  return (
    <li className={`finding ${f.verdict}`}>
      <div className="finding-head">
        <span className={`verdict ${f.verdict}`}>{VERDICT_LABEL[f.verdict]}</span>{' '}
        <strong>Finding {f.number}</strong> <span className="hint">· {f.type}</span>
      </div>
      <p className="claim-by">{claimBy}</p>
      <p className="claim">{f.claim}</p>
      {f.reasons.length > 0 && (
        <div className="reasons">
          <p className="label">Why it is not verified</p>
          <Problems items={f.reasons} />
        </div>
      )}
      {f.missing.length > 0 && (
        <p className="fail">Cited but not in the evidence: {f.missing.join(', ')}</p>
      )}
      {f.note && <p className="hint type-note">{f.note}</p>}
      {f.attack && (
        <p className="hint type-note">
          ATT&amp;CK reference, if this was adversary activity:{' '}
          <a href={attackUrl(f.attack.id)} target="_blank" rel="noreferrer">
            {f.attack.id} {f.attack.name}
          </a>
          . A reference, not a conclusion.
        </p>
      )}
      <details className="cited" open={f.verdict !== 'verified'}>
        <summary>
          Cited evidence: {f.cited.map((c) => c.event.id).concat(f.missing).join(', ') || 'none'}
        </summary>
        {f.cited.length > 0 ? (
          <EventList events={f.cited} />
        ) : (
          <p className="hint">No cited event is in the evidence.</p>
        )}
      </details>
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
