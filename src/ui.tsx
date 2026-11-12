import type { ReactNode } from 'react'
import type { ReportEvent } from './lib/report'

// Events as the analyst reads them: the row the model was given and, for a
// case file, the original record it came from.
export function EventList({ events }: { events: ReportEvent[] }) {
  return (
    <ol className="events">
      {events.map(({ event: e, provenance: p }) => (
        <li key={e.id}>
          <div>
            <strong>{e.id}</strong>{' '}
            <span className="hint">
              {e.date} {e.time} · {e.source}
            </span>
          </div>
          <div>
            {e.actor} · {e.action}: {e.target} · {e.outcome}
          </div>
          <div className="hint">{e.detail}</div>
          {p && (
            <div className="hint">
              Original record, {p.file} line {p.line}: <code>{p.raw}</code>
            </div>
          )}
        </li>
      ))}
    </ol>
  )
}

// A section that folds away, so a long result reads on a phone. The summary
// line keeps the essentials visible while it is closed.
export function Panel({
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
    <details className="panel" open={open}>
      <summary>
        <h2>{title}</h2>
        {status && <span className="status">{status}</span>}
      </summary>
      <div className="panel-body">{children}</div>
    </details>
  )
}

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
