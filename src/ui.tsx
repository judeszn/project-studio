import type { ReactNode } from 'react'
import type { ReportEvent } from './lib/report'

// Events as the analyst reads them: one row per event, the fields the model
// was given, as a table on a wide screen and stacked on a phone. Each row
// opens to the event's detail and, for a case file, the original record it
// came from. Closed rows stay in the page, so the browser's find still
// reaches every record.
export function EventList({ events }: { events: ReportEvent[] }) {
  return (
    <div className="evtable">
      <div className="ev-head" aria-hidden="true">
        <span>ID</span>
        <span>Time</span>
        <span>Source</span>
        <span>Account</span>
        <span>Action</span>
        <span>Target</span>
        <span>Outcome</span>
      </div>
      <ol className="events">
        {events.map(({ event: e, provenance: p }) => (
          <li key={e.id}>
            <details>
              <summary>
                <strong>{e.id}</strong>
                <span className="ev-when">
                  {e.date} {e.time}
                </span>
                <span className="ev-source">{e.source}</span>
                <span className="ev-break" aria-hidden="true" />
                <span className="ev-actor">{e.actor}</span>
                <span className="ev-action">{e.action}</span>
                <span className="ev-target">{e.target}</span>
                <span className={`ev-outcome ${e.outcome}`}>{e.outcome}</span>
              </summary>
              <div className="ev-body">
                <p>{e.detail}</p>
                {p ? (
                  <p className="hint">
                    Original record, {p.file} line {p.line}: <code>{p.raw}</code>
                  </p>
                ) : (
                  <p className="hint">The case holds no original record for this event.</p>
                )}
              </div>
            </details>
          </li>
        ))}
      </ol>
    </div>
  )
}

// A section that folds away, so a long result reads on a phone. The summary
// line keeps the essentials visible while it is closed.
export function Sub({
  title,
  status,
  open = false,
  children,
}: {
  title: string
  status?: string
  open?: boolean
  children: ReactNode
}) {
  return (
    <details className="sub" open={open}>
      <summary>
        <h3>{title}</h3>
        {status && <span className="status">{status}</span>}
      </summary>
      {children}
    </details>
  )
}

// What this screen is for, in one sentence. The same form on every screen.
export function ScreenNote({ text }: { text: string }) {
  return <p className="screen-note">{text}</p>
}

export function Problems({ items }: { items: string[] }) {
  if (items.length === 0) return null
  return (
    <ul className="fail">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  )
}
