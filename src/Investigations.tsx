import type { ReactNode } from 'react'
import type { Report } from './lib/report'

// Where an investigation starts, and the list of this session's
// investigations. Every row is a run made in this page; nothing is stored,
// uploaded or invented, so the list says so, and it is empty until a run
// exists. The simulated sample is offered as evidence to start from, labelled
// as simulated; the worked example is reached from "How verdicts work".

export interface Investigation {
  id: string // the run's location and start time, as its files name it
  caseTitle: string
  report: Report // a model run; the worked example is never listed
}

const needsReview = (r: Report) => r.counts.rejected + r.counts.contradicted + r.counts.unchecked
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function Investigations({
  investigations,
  busy,
  notice,
  current,
  onOpenFile,
  onSample,
  onHowVerdicts,
  onOpen,
}: {
  investigations: Investigation[]
  busy: boolean
  notice: ReactNode // a file that could not be opened, if any
  current: ReactNode // the open case, if any
  onOpenFile: () => void
  onSample: () => void
  onHowVerdicts: () => void
  onOpen: (id: string) => void
}) {
  return (
    <div className="investigations">
      <div className="page-head">
        <p className="eyebrow">Investigations</p>
        <h1>Start an Investigation</h1>
        <p className="lede">
          Supply authentication event records. AI proposes findings, code checks each one against
          the records it cites, and you review the result.
        </p>
      </div>

      {notice}
      {current}

      <section className="start" aria-label="Start an investigation">
        <div className="start-option">
          <h2>Open evidence file</h2>
          <p className="hint">
            A JSON case file of authentication events. It is read and checked in this browser;
            opening it uploads nothing, and a file that fails a check is refused.
          </p>
          <button className="primary" onClick={onOpenFile} disabled={busy}>
            Open evidence file
          </button>
        </div>
        <div className="start-option">
          <h2>
            Use sample evidence <span className="badge warn">Simulated</span>
          </h2>
          <p className="hint">
            18 invented authentication events at InfoPro, PHANG Group’s own product. InfoPro has
            had no such incident. Use it to see an investigation from start to finish.
          </p>
          <button className="secondary" onClick={onSample} disabled={busy}>
            Use sample evidence (simulated)
          </button>
        </div>
      </section>
      <p className="hint start-note">
        Want to see the verdicts before running anything?{' '}
        <button className="link" onClick={onHowVerdicts} disabled={busy}>
          How verdicts work
        </button>{' '}
        shows all four on the sample evidence, with no AI involved.
      </p>

      <section className="panel-card" aria-label="This session’s investigations">
        <div className="panel-head">
          <h2>This session’s investigations</h2>
          <span className="status">kept in this browser tab only; nothing is stored</span>
        </div>
        {investigations.length === 0 ? (
          <p className="hint">
            No investigations in this session yet. Each analysis you run is listed here until you
            close this page.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="runs">
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Analysed by</th>
                  <th>Started</th>
                  <th>Verified</th>
                  <th>Need review</th>
                  <th>
                    <span className="visually-hidden">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {investigations.map((i) => (
                  <tr key={i.id}>
                    <td>{i.caseTitle}</td>
                    <td>
                      {i.report.run?.model}
                      <span className={`where-tag ${i.report.run?.location === 'cloud' ? 'cloud' : 'device'}`}>
                        {i.report.run?.location === 'cloud' ? 'cloud' : 'on device'}
                      </span>
                    </td>
                    <td>{i.report.run && time(i.report.run.startedAt)}</td>
                    <td className="num ok">
                      {i.report.counts.verified}/{i.report.findings.length}
                    </td>
                    <td className={`num ${needsReview(i.report) > 0 ? 'fail' : ''}`}>
                      {needsReview(i.report)}
                    </td>
                    <td>
                      <button className="secondary small" onClick={() => onOpen(i.id)} disabled={busy}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
