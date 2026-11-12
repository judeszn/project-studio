import type { EventAction, LogEvent, LogonAction } from '../../src/lib/schema'
import type { AuthRecord } from './auth'

// Builds model-visible evidence from LANL authentication records. This file
// must never import the red-team labels (redteam.ts) or the evaluation: the
// selection below is label-free, so a case cannot reveal its answer through
// which events it contains or how they are ordered.

export interface CaseSpec {
  id: string
  start: number // dataset seconds, inclusive
  end: number // dataset seconds, inclusive
  // Keep a record that names any listed computer or user (source or
  // destination). Both empty: every record in the window.
  computers: string[]
  users: string[]
  maxEvents: number
}

export type Selection =
  | { ok: true; records: AuthRecord[]; scanned: number }
  | { ok: false; error: string }

const keeps = (spec: CaseSpec, r: AuthRecord) => {
  if (r.time < spec.start || r.time > spec.end) return false
  if (spec.computers.length === 0 && spec.users.length === 0) return true
  return (
    spec.computers.some((c) => c === r.sourceComputer || c === r.destinationComputer) ||
    spec.users.some((u) => u === r.sourceUser || u === r.destinationUser)
  )
}

// Records ordered by their numeric dataset time, then file line. Over
// `maxEvents` fails rather than truncating, since a cut would decide what the
// model sees by position. `sorted` lets the scan stop at the window's end;
// pass it only when the inventory has shown that times never decrease in the
// file.
export async function selectEvents(
  records: AsyncIterable<AuthRecord> | Iterable<AuthRecord>,
  spec: CaseSpec,
  { sorted }: { sorted: boolean },
): Promise<Selection> {
  if (!(spec.start <= spec.end)) return { ok: false, error: 'start is after end' }
  if (!(spec.maxEvents >= 1)) return { ok: false, error: 'maxEvents must be at least 1' }
  const kept: AuthRecord[] = []
  let scanned = 0
  for await (const r of records) {
    scanned++
    if (sorted && r.time > spec.end) break
    if (!keeps(spec, r)) continue
    if (kept.length === spec.maxEvents) {
      return { ok: false, error: `more than ${spec.maxEvents} events match; narrow the case` }
    }
    kept.push(r)
  }
  if (kept.length === 0) return { ok: false, error: 'no events match' }
  kept.sort((a, b) => a.time - b.time || a.line - b.line)
  return { ok: true, records: kept, scanned }
}

// How LANL field values become the evidence vocabulary (owner's decisions,
// 2026-11-11). A LogOn is named by its logon type and is never a "sign-in"; a
// LogOff is a "logoff", not a "sign-out"; Kerberos ticket activity keeps its
// own meaning. The tables cover every orientation and logon type the
// full-file inventory found. A value with no entry is refused with its line,
// never guessed; each new value needs its own decision. The original values
// stay in the detail and the raw record, and the logon type also in
// `logonType`.
export interface Vocabulary {
  action: Record<string, EventAction> // orientation (other than LogOn) -> action
  logon: Record<string, LogonAction> // LogOn, by logon type -> action
  logonTypeMissing: LogonAction // LogOn whose logon type is '?'
  outcome: Record<string, LogEvent['outcome']> // success/failure -> outcome
}

export const AUTH_VOCABULARY: Vocabulary = {
  action: {
    LogOff: 'logoff',
    TGT: 'ticket-granting ticket',
    TGS: 'service ticket',
    // Found by the inventory; kept literally, never made a sign-in or
    // sign-out, and accepted by no finding type.
    AuthMap: 'AuthMap',
    ScreenLock: 'ScreenLock',
    ScreenUnlock: 'ScreenUnlock',
  },
  logon: {
    Network: 'network logon',
    Interactive: 'interactive logon',
    RemoteInteractive: 'remote interactive logon',
    Service: 'service logon',
    Batch: 'batch logon',
    Unlock: 'unlock logon',
    NewCredentials: 'new-credentials logon',
    NetworkCleartext: 'network cleartext logon',
    CachedInteractive: 'cached interactive logon',
  },
  logonTypeMissing: 'logon, type not recorded',
  outcome: { Success: 'success', Fail: 'denied' },
}

// Own keys only, so a value such as "toString" cannot match a built-in.
const lookup = <T>(table: Record<string, T>, key: string | null): T | undefined =>
  key !== null && Object.hasOwn(table, key) ? table[key] : undefined

export interface Provenance {
  file: string
  line: number
  raw: string
}

// One evidence row: what the model sees, and where it came from. Provenance
// stays beside the row, not in it.
export interface CaseEvent {
  evidence: LogEvent
  provenance: Provenance
}

export interface CaseFile {
  spec: CaseSpec
  source: { dataset: string; citation: string; file: string; sha256?: string } // the file's hash, checked when built
  // Instructions that must go to the model with these events.
  modelNotes: string[]
  events: CaseEvent[]
}

// Owner's decision, 2026-11-11: what the model must be told about LANL time.
export const LANL_TIME_NOTE =
  'Times are relative dataset timestamps: "Day N · elapsed HH:MM:SS" counts ' +
  "from the dataset's undisclosed start. They are not local clock times and " +
  'cannot show whether an event happened at night or outside working hours. ' +
  'Order events by the numeric dataset time given in each event (seconds).'

export const LANL_CITATION =
  'A. D. Kent, "Comprehensive, Multi-Source Cybersecurity Events," Los Alamos National Laboratory, http://dx.doi.org/10.17021/1179829, 2015.'

const SECONDS_PER_DAY = 86400
const pad = (n: number) => String(n).padStart(2, '0')
const shown = (v: string | null) => v ?? 'not recorded'

// LANL times are seconds from an undisclosed start (the first second is 1),
// so there is no date or clock time to give: "Day 9 · elapsed 02:24:00" is
// the dataset day and the time elapsed within it. The detail repeats it and
// keeps the exact seconds.
export function datasetDayAndTime(seconds: number) {
  const elapsed = seconds - 1
  const inDay = elapsed % SECONDS_PER_DAY
  const clock = [Math.floor(inDay / 3600), Math.floor((inDay % 3600) / 60), inDay % 60]
  return {
    date: `Day ${Math.floor(elapsed / SECONDS_PER_DAY) + 1}`,
    time: `elapsed ${clock.map(pad).join(':')}`,
  }
}

export type Conversion = { ok: true; events: CaseEvent[] } | { ok: false; errors: string[] }

export function toEvidence(records: AuthRecord[], vocabulary: Vocabulary): Conversion {
  const errors: string[] = []
  const events: CaseEvent[] = []
  records.forEach((r, i) => {
    const where = `${r.file} line ${r.line}`
    const action =
      r.orientation !== 'LogOn'
        ? lookup(vocabulary.action, r.orientation)
        : r.logonType === null
          ? vocabulary.logonTypeMissing
          : lookup(vocabulary.logon, r.logonType)
    const outcome = lookup(vocabulary.outcome, r.result)
    if (!action) {
      errors.push(
        r.orientation === 'LogOn'
          ? `${where}: logon type "${shown(r.logonType)}" is not supported`
          : `${where}: orientation "${shown(r.orientation)}" is not supported`,
      )
    }
    if (!outcome) errors.push(`${where}: result "${shown(r.result)}" is not supported`)
    if (!action || !outcome) return
    const { date, time } = datasetDayAndTime(r.time)
    events.push({
      evidence: {
        id: `E${pad(i + 1)}`,
        date,
        time,
        source: 'identity',
        actor: shown(r.sourceUser),
        action,
        target: shown(r.destinationComputer),
        outcome,
        logonType: shown(r.logonType),
        detail:
          `${date} · ${time} (dataset time ${r.time} s from the dataset's start; ` +
          'not a clock time). ' +
          `Source user ${shown(r.sourceUser)}; destination user ${shown(r.destinationUser)}; ` +
          `source computer ${shown(r.sourceComputer)}; destination computer ${shown(r.destinationComputer)}; ` +
          `authentication type ${shown(r.authType)}; logon type ${shown(r.logonType)}; ` +
          `orientation ${shown(r.orientation)}; result ${shown(r.result)}.`,
      },
      provenance: { file: r.file, line: r.line, raw: r.raw },
    })
  })
  return errors.length > 0 ? { ok: false, errors } : { ok: true, events }
}
