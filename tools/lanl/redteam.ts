import type { AuthRecord } from './auth'

// GROUND TRUTH. Only the labelling and evaluation steps may import this file.
// Nothing under src/, and nothing that builds model-visible evidence
// (case.ts), may import it; isolation.test.ts enforces that.
//
// LANL documents redteam.txt.gz as "specific events taken from the
// authentication data that present known redteam compromise events", one per
// line as "time,user@domain,source computer,destination computer".

export interface RedteamRecord {
  file: string
  line: number
  raw: string
  time: number
  user: string
  sourceComputer: string
  destinationComputer: string
}

export type ParsedRedteam = { ok: true; record: RedteamRecord } | { ok: false; error: string }

export function parseRedteamLine(raw: string, file: string, line: number): ParsedRedteam {
  const fields = raw.split(',')
  if (fields.length !== 4) return { ok: false, error: `expected 4 fields, got ${fields.length}` }
  if (fields.some((f) => f === '' || f === '?')) return { ok: false, error: 'missing field' }
  if (!/^\d+$/.test(fields[0]) || Number(fields[0]) < 1) {
    return { ok: false, error: `time "${fields[0]}" is not a whole number of seconds from 1` }
  }
  const [, user, sourceComputer, destinationComputer] = fields
  return {
    ok: true,
    record: { file, line, raw, time: Number(fields[0]), user, sourceComputer, destinationComputer },
  }
}

// The documentation names the same time and computer fields in both files but
// does not say which of the auth record's two users the red-team user is. So
// the match rule is a required choice, made after `cli.ts match` has measured
// each candidate on the real data. There is deliberately no default.
export const MATCH_RULES = ['source_user', 'destination_user', 'either_user'] as const
export type MatchRule = (typeof MATCH_RULES)[number]

// Which documented fields agree, without deciding what counts as a match.
export function agreement(red: RedteamRecord, auth: AuthRecord) {
  return {
    time: red.time === auth.time,
    sourceComputer: red.sourceComputer === auth.sourceComputer,
    destinationComputer: red.destinationComputer === auth.destinationComputer,
    sourceUser: red.user === auth.sourceUser,
    destinationUser: red.user === auth.destinationUser,
  }
}

export function matches(rule: MatchRule, red: RedteamRecord, auth: AuthRecord): boolean {
  const a = agreement(red, auth)
  if (!a.time || !a.sourceComputer || !a.destinationComputer) return false
  if (rule === 'source_user') return a.sourceUser
  if (rule === 'destination_user') return a.destinationUser
  return a.sourceUser || a.destinationUser
}

// Which auth user field names the red-team user, when time and both
// computers agree; null when they do not. Kept with every label, so a match
// made under `either_user` still says how it was made.
export type UserField = 'source' | 'destination' | 'both'

export function matchedUser(red: RedteamRecord, auth: AuthRecord): UserField | null {
  const a = agreement(red, auth)
  if (!a.time || !a.sourceComputer || !a.destinationComputer) return null
  if (a.sourceUser && a.destinationUser) return 'both'
  return a.sourceUser ? 'source' : a.destinationUser ? 'destination' : null
}

// Key on the fields every candidate rule requires to be equal.
export const placeKey = (time: number, src: string | null, dst: string | null) =>
  `${time},${src},${dst}`
