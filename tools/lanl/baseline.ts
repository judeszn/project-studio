import type { AuthRecord } from './auth'
import type { CaseFile } from './case'

// The deterministic baseline frozen with the selector (docs/SELECTOR_SPEC.md):
// it flags the case events that formed a first-seen pair, an (account,
// destination computer) pair no earlier record in the file had formed. The
// accounts of a record are its source and destination users, as the selector
// counts them. Code only; it reads no labels (isolation.test.ts).

export interface BaselineFlag {
  id: string
  line: number
  // The pairs this event formed first, as "account -> destination computer".
  firstSeen: string[]
}

export interface Baseline {
  caseId: string
  events: number
  flagged: BaselineFlag[]
  scannedLines: number
}

const pairsOf = (r: Pick<AuthRecord, 'sourceUser' | 'destinationUser' | 'destinationComputer'>) =>
  [...new Set([r.sourceUser, r.destinationUser])].map((account) => `${account} -> ${r.destinationComputer}`)

// `records` must be the authentication file from line 1, with each case
// event's record at its provenance line. Reading stops after the case's last
// event.
export async function runBaseline(
  caseFile: CaseFile,
  records: AsyncIterable<AuthRecord> | Iterable<AuthRecord>,
  parse: (raw: string, file: string, line: number) => AuthRecord,
): Promise<Baseline> {
  const caseRecords = caseFile.events.map((e) => ({
    id: e.evidence.id,
    record: parse(e.provenance.raw, e.provenance.file, e.provenance.line),
  }))
  const lastLine = Math.max(...caseRecords.map((c) => c.record.line))
  // Pair -> first line that formed it, for the case's pairs only.
  const firstLine = new Map(caseRecords.flatMap((c) => pairsOf(c.record)).map((p) => [p, 0]))
  const raws = new Map(caseRecords.map((c) => [c.record.line, c.record.raw]))
  let scannedLines = 0
  for await (const r of records) {
    scannedLines = r.line
    if (raws.has(r.line) && raws.get(r.line) !== r.raw) {
      throw new Error(`line ${r.line} is not the record the case preserved`)
    }
    for (const p of pairsOf(r)) if (firstLine.get(p) === 0) firstLine.set(p, r.line)
    if (r.line >= lastLine) break
  }
  if (scannedLines < lastLine) throw new Error(`the file ended at line ${scannedLines}, before line ${lastLine}`)
  return {
    caseId: caseFile.spec.id,
    events: caseRecords.length,
    flagged: caseRecords
      .map(({ id, record }) => ({
        id,
        line: record.line,
        firstSeen: pairsOf(record).filter((p) => firstLine.get(p) === record.line),
      }))
      .filter((f) => f.firstSeen.length > 0),
    scannedLines,
  }
}
