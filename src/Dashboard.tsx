import type { ReactNode } from 'react'
import { CLOUD_MODEL } from './lib/hybrid'
import { VERDICT_LABEL } from './lib/report'
import type { Report } from './lib/report'

// The overview: what this browser session has investigated, what needs the
// analyst, and what the platform can and cannot take in yet. Every number is
// counted from runs made in this page; nothing is stored, uploaded or
// invented, and with no runs the page says so.

export interface Investigation {
  id: string // the run's location and start time, as its files name it
  caseTitle: string
  report: Report // a model run; the worked example is never listed
}

interface Status {
  label: string
  tone: string
}

// What the platform takes in and what it can investigate. Planned items are
// directions, not features: none of them exists in this build.
const SOURCES: { name: string; detail: string; available: boolean }[] = [
  { name: 'File import', detail: 'A JSON case file, read and checked in this browser', available: true },
  { name: 'Sample case', detail: 'Simulated InfoPro authentication events', available: true },
  { name: 'API ingestion', detail: 'Systems send events to a Project Studio endpoint', available: false },
  { name: 'Webhooks', detail: 'Security tools push events as they happen', available: false },
  { name: 'Local collector', detail: 'An agent forwards approved logs from company systems', available: false },
]

const TYPES: { name: string; detail: string; available: boolean }[] = [
  { name: 'Authentication', detail: 'Logons, denied logons and account use', available: true },
  { name: 'Phishing', detail: 'Email headers, links and attachments', available: false },
  { name: 'Endpoint', detail: 'Processes, files and persistence', available: false },
  { name: 'Network', detail: 'Connections and DNS', available: false },
  { name: 'Cloud', detail: 'Identity changes and API activity', available: false },
]

const needsReview = (r: Report) => r.counts.rejected + r.counts.contradicted + r.counts.unchecked
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function Dashboard({
  investigations,
  busy,
  nano,
  cloud,
  intro,
  current,
  preview,
  onOpen,
}: {
  investigations: Investigation[]
  busy: boolean
  nano: Status
  cloud: Status
  intro: ReactNode // headline and the ways to start
  current: ReactNode // the open case, if any
  preview: ReactNode // the worked example, shown until a run exists
  onOpen: (id: string) => void
}) {
  const reports = investigations.map((i) => i.report)
  const findings = reports.reduce((n, r) => n + r.findings.length, 0)
  const verified = reports.reduce((n, r) => n + r.counts.verified, 0)
  const review = reports.reduce((n, r) => n + needsReview(r), 0)
  const events = reports.reduce((n, r) => n + r.case.events, 0)
  const attention = investigations.flatMap((i) =>
    i.report.findings.filter((f) => f.verdict !== 'verified').map((f) => ({ run: i, finding: f })),
  )
  const empty = investigations.length === 0

  return (
    <div className="dashboard">
      <section className="dash-head">{intro}</section>
      {current}

      <section className="kpis" aria-label="This session">
        <Kpi label="Investigations" value={investigations.length} note="run in this browser session" />
        <Kpi
          label="Findings verified"
          value={empty ? '0' : `${verified} of ${findings}`}
          note="checked by code against the evidence"
          tone={empty ? '' : 'ok'}
        />
        <Kpi
          label="Need review"
          value={review}
          note="rejected, contradicted or unchecked"
          tone={review > 0 ? 'fail' : ''}
        />
        <Kpi label="Events examined" value={events} note="across all runs" />
      </section>

      <div className="dash-grid">
        <section className="panel-card wide" aria-label="Recent investigations">
          <div className="panel-head">
            <h2>Recent investigations</h2>
            <span className="status">this session only; nothing is stored</span>
          </div>
          {empty ? (
            <p className="hint">
              No investigations yet. Run the sample investigation or open a case file; each run
              is listed here until you close this page.
            </p>
          ) : (
            <table className="runs">
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Model</th>
                  <th>Started</th>
                  <th>Verified</th>
                  <th>Review</th>
                  <th>Classification (model&apos;s, not verified)</th>
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
                    <td>{i.report.proposal?.classification ?? 'output unreadable'}</td>
                    <td>
                      <button className="secondary small" onClick={() => onOpen(i.id)} disabled={busy}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <aside className="panel-card" aria-label="AI engines">
          <h2>AI engines</h2>
          <dl className="engines">
            <dt>Gemini Nano, on this device</dt>
            <dd className={nano.tone}>{nano.label}</dd>
            <dt>{CLOUD_MODEL}, in the cloud after consent</dt>
            <dd className={cloud.tone}>{cloud.label}</dd>
          </dl>
          <p className="hint">
            The two models do not perform the same. Code checks every finding from either.
          </p>
        </aside>

        <section className="panel-card wide" aria-label="Findings needing review">
          <div className="panel-head">
            <h2>Findings needing review</h2>
            <span className="status">{attention.length}</span>
          </div>
          {attention.length === 0 ? (
            <p className="hint">
              {empty
                ? 'Findings that fail a check, or that no check covers, will appear here.'
                : 'None: every finding in this session passed its checks.'}
            </p>
          ) : (
            <ul className="attention">
              {attention.slice(0, 6).map(({ run, finding: f }) => (
                <li key={`${run.id}-${f.number}`}>
                  <span className={`verdict ${f.verdict}`}>{VERDICT_LABEL[f.verdict]}</span>
                  <span className="attention-claim">{f.claim}</span>
                  <span className="hint">
                    Finding {f.number} · {run.report.run?.model} · {run.report.run && time(run.report.run.startedAt)}
                  </span>
                  <button className="ghost small" onClick={() => onOpen(run.id)} disabled={busy}>
                    Open
                  </button>
                </li>
              ))}
              {attention.length > 6 && (
                <li className="hint">and {attention.length - 6} more in the investigations above</li>
              )}
            </ul>
          )}
        </section>

        {empty ? preview : <Capabilities title="Investigation types" items={TYPES} />}

        <Capabilities title="Evidence sources" items={SOURCES} />
        {empty && <Capabilities title="Investigation types" items={TYPES} />}
      </div>
    </div>
  )
}

function Kpi({ label, value, note, tone = '' }: { label: string; value: ReactNode; note: string; tone?: string }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <strong className={tone}>{value}</strong>
      <span className="hint">{note}</span>
    </div>
  )
}

function Capabilities({
  title,
  items,
}: {
  title: string
  items: { name: string; detail: string; available: boolean }[]
}) {
  return (
    <aside className="panel-card" aria-label={title}>
      <h2>{title}</h2>
      <ul className="capabilities">
        {items.map((item) => (
          <li key={item.name}>
            <div>
              <strong>{item.name}</strong>
              <span className="hint">{item.detail}</span>
            </div>
            <span className={`cap ${item.available ? 'ok' : 'planned'}`}>
              {item.available ? 'Available' : 'Planned'}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  )
}
