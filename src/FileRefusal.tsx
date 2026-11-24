import SAMPLE_CASE_URL from './data/sample-case.json?url'
import { CASE_FILE_DOC_URL, SAMPLE_CASE_DOWNLOAD } from './site'

// What the page says when it refuses a file (owner's decision, 2026-11-24).
// The reader's rules are unchanged: the file is still refused whole and every
// reason is still listed. This only makes the refusal readable: one plain
// summary, guidance when the events are flat records, the first reasons with
// the rest folded away, and a known-good file to start from.

export const SHOWN_ERRORS = 10

const count = (n: number) => (n === 1 ? '1 error' : `${n} errors`)

// The sample case file, the same file the page opens as sample evidence, and
// the format. A plain link: the browser saves the file; nothing is uploaded.
export function CaseFileHelp() {
  return (
    <>
      <a href={SAMPLE_CASE_URL} download={SAMPLE_CASE_DOWNLOAD}>
        Download the sample case file
      </a>{' '}
      (a file AEMAS opens) or read the{' '}
      <a href={CASE_FILE_DOC_URL} target="_blank" rel="noreferrer">
        case-file format
      </a>
      .
    </>
  )
}

export function FileRefusal({ errors, flatRecords }: { errors: string[]; flatRecords: boolean }) {
  const shown = errors.slice(0, SHOWN_ERRORS)
  const rest = errors.slice(SHOWN_ERRORS)
  return (
    <div className="notice fail refusal">
      <div role="alert">
        <p>
          <strong>This file is not in the AEMAS case-file format.</strong> Nothing in it was used.
        </p>
        {flatRecords && (
          <p>
            Its events are flat records. In a case file, every event has two parts:{' '}
            <code>evidence</code>, the row AEMAS analyses, and <code>provenance</code>, the original
            record with the file and line it came from.
          </p>
        )}
      </div>
      <p>
        <CaseFileHelp />
      </p>
      <p className="refusal-count">
        {count(errors.length)}
        {rest.length > 0 ? `; the first ${SHOWN_ERRORS}:` : ':'}
      </p>
      <ol className="refusal-errors">
        {shown.map((error, i) => (
          <li key={i}>{error}</li>
        ))}
      </ol>
      {rest.length > 0 && (
        <details className="refusal-more">
          <summary>
            <span className="when-closed">Show all {count(errors.length)}</span>
            <span className="when-open">Show the first {SHOWN_ERRORS} only</span>
          </summary>
          <ol className="refusal-errors" start={SHOWN_ERRORS + 1}>
            {rest.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ol>
        </details>
      )}
    </div>
  )
}
