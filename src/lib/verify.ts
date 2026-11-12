import {
  CLASSIFICATIONS,
  CONFIDENCE_LEVELS,
  FINDING_TYPES,
  LOGON_ACTIONS,
  MAX_ACTIONS,
  MAX_EVENTS_PER_FINDING,
  MAX_FINDINGS,
} from './schema'
import type { EventAction, FindingType, IncidentProposal, LogEvent } from './schema'

// Deterministic checks on model output. Nothing here calls a model, and every
// check fails closed: anything it cannot confirm is reported, never assumed OK.
//
// Three separate questions are asked of each finding:
//   1. Citations (checkProposal): do the cited events exist, and do the times
//      and account names the claim quotes belong to them?
//   2. Support (checkSupport): are the cited events of the kind, and with the
//      outcome, that the finding's type says they are?
//   3. Repeats (checkRepeats): does the finding only repeat another one?
// A finding passes only if it clears all three. None of them reads the prose
// of a claim, and none establishes that the classification is right. That
// judgement belongs to the analyst.

export type ParseResult =
  | { ok: true; proposal: IncidentProposal }
  | { ok: false; errors: string[] }

export interface Problem {
  path: string
  problem: string
}

// supported: every cited event meets the rule for the finding's type.
// unsupported: a cited event is missing or is a different kind of event.
// contradicted: a cited event is the right kind but says the opposite.
// unchecked: the finding's type is `other`, which has no rule.
export type Support = 'supported' | 'unsupported' | 'contradicted' | 'unchecked'

export interface FindingSupport {
  status: Support
  notes: string[]
}

export interface Verification {
  parse: ParseResult
  problems: Problem[]
  support: FindingSupport[] // one per finding, in order
  passes: boolean[] // one per finding: supported, and no problem at its path
  covered: string[] // event IDs cited by findings that pass, in evidence order
  uncited: string[] // event IDs no finding cites, in evidence order
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === 'string')

const oneOf = (allowed: readonly string[], v: unknown) =>
  typeof v === 'string' && allowed.includes(v)

const tooMany = (at: string, list: unknown[], max: number) =>
  list.length > max ? [`${at}: expected at most ${max} items, got ${list.length}`] : []

const PROPOSAL_KEYS = [
  'classification',
  'confidence',
  'explanation',
  'findings',
  'recommended_actions',
]
const FINDING_KEYS = ['type', 'claim', 'event_ids']

function unknownKeys(obj: Record<string, unknown>, allowed: string[], at: string): string[] {
  return Object.keys(obj)
    .filter((k) => !allowed.includes(k))
    .map((k) => `${at}${k}: unexpected field`)
}

// `findingTypes`: the types the evidence source allows; GS-03's by default.
export function parseProposal(
  raw: string,
  findingTypes: readonly FindingType[] = FINDING_TYPES,
): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { ok: false, errors: ['output is not valid JSON'] }
  }
  if (!isObject(data)) return { ok: false, errors: ['output is not a JSON object'] }

  const errors = unknownKeys(data, PROPOSAL_KEYS, '')
  if (!oneOf(CLASSIFICATIONS, data.classification)) {
    errors.push(`classification: expected one of ${CLASSIFICATIONS.join(', ')}`)
  }
  if (!oneOf(CONFIDENCE_LEVELS, data.confidence)) {
    errors.push(`confidence: expected one of ${CONFIDENCE_LEVELS.join(', ')}`)
  }
  if (typeof data.explanation !== 'string') errors.push('explanation: expected a string')
  if (!isStringArray(data.recommended_actions)) {
    errors.push('recommended_actions: expected an array of strings')
  } else {
    errors.push(...tooMany('recommended_actions', data.recommended_actions, MAX_ACTIONS))
  }
  if (!Array.isArray(data.findings)) {
    errors.push('findings: expected an array')
  } else {
    errors.push(...tooMany('findings', data.findings, MAX_FINDINGS))
    data.findings.forEach((f: unknown, i: number) => {
      const at = `findings[${i}]`
      if (!isObject(f)) {
        errors.push(`${at}: expected an object`)
        return
      }
      errors.push(...unknownKeys(f, FINDING_KEYS, `${at}.`))
      if (!oneOf(findingTypes, f.type)) {
        errors.push(`${at}.type: expected one of ${findingTypes.join(', ')}`)
      }
      if (typeof f.claim !== 'string') errors.push(`${at}.claim: expected a string`)
      if (!isStringArray(f.event_ids)) {
        errors.push(`${at}.event_ids: expected an array of strings`)
      } else {
        errors.push(...tooMany(`${at}.event_ids`, f.event_ids, MAX_EVENTS_PER_FINDING))
      }
    })
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, proposal: data as unknown as IncidentProposal }
}

const TIME = /\b(\d{1,2}):(\d{2})\b/g
const EVENT_ID = /\bE\d+\b/g
const ACCOUNT = /\b[a-z]+(?:-[a-z]+)*-\d+\b/g

// Clock times as zero-padded HH:MM ("2:20" -> "02:20"). Known limit: am/pm is
// not read, so "2:20 pm" is treated as 02:20.
export function extractTimes(text: string): string[] {
  return [...text.matchAll(TIME)].map(([, h, m]) => `${h.padStart(2, '0')}:${m}`)
}

export function extractEventIds(text: string): string[] {
  return text.match(EVENT_ID) ?? []
}

// Account names in the shape the evidence uses ("adm-ops-01"), each once.
// Known limit: a name with no number ("svc-backup") is not recognised.
export function extractAccounts(text: string): string[] {
  return [...new Set(text.toLowerCase().match(ACCOUNT) ?? [])]
}

// LANL identities, in the shapes LANL's data and documentation show:
// de-identified users and machine accounts with a domain ("U748@DOM1",
// "C625$@DOM1"), local accounts whose domain is a computer ("U8777@C583"),
// the well-known SYSTEM account ("SYSTEM@C653"), and bare users, machine
// accounts or computers ("U748", "C625$", "C17693"). A domain of "?" is one
// LANL did not record ("U10582@?", found in the data 2026-11-12): it is kept
// as written and matches only "?", never another domain. Known limit: other
// well-known accounts LANL left readable (its documentation names "Local
// Service") are not recognised until the data shows how they are written.
const LANL_PRINCIPAL = /\b(?:[uc]\d+\$?|system)@(?:[a-z][a-z0-9]*\b|\?)/g
const LANL_BARE = /\b[uc]\d+\$?(?![\w$@])/g

export function extractLanlIdentities(text: string): string[] {
  const lower = text.toLowerCase()
  return [...new Set([...(lower.match(LANL_PRINCIPAL) ?? []), ...(lower.match(LANL_BARE) ?? [])])]
}

// Every identity a text names, in the form it was written.
const identitiesIn = (text: string) => [...extractAccounts(text), ...extractLanlIdentities(text)]

// What evidence text vouches for: each identity it names and, for a LANL
// principal, its bare name too, so "U748" is known when the evidence has
// "U748@DOM1". A principal written in full must match in full: "U748@DOM2"
// is not vouched for by "U748@DOM1".
const knownIdentitiesIn = (text: string) =>
  identitiesIn(text).flatMap((id) => (id.includes('@') ? [id, id.slice(0, id.indexOf('@'))] : [id]))

const identityKind = (id: string) => (/^c\d+$/.test(id) ? 'computer' : 'account')

// An event's own time, plus any time quoted in its detail (a statement may
// refer to an earlier moment).
const timesOf = (event: LogEvent) => [event.time, ...extractTimes(event.detail)]

// The identities an event vouches for: who acted, on what, and anyone in the
// detail.
const accountsOf = (event: LogEvent) =>
  knownIdentitiesIn(`${event.actor} ${event.target} ${event.detail}`)

// Every finding must cite at least one event, every cited event must exist,
// and every time or identity (GS-03 account, LANL user or computer) a finding
// names must belong to an event it cites. Free text outside findings may only
// mention events, times and identities that are in the evidence.
export function checkProposal(proposal: IncidentProposal, events: LogEvent[]): Problem[] {
  const byId = new Map(events.map((e) => [e.id, e]))
  const allTimes = new Set(events.flatMap(timesOf))
  const allAccounts = new Set(events.flatMap(accountsOf))
  const problems: Problem[] = []

  const checkMentionedIds = (path: string, text: string) => {
    for (const id of extractEventIds(text)) {
      if (!byId.has(id)) {
        problems.push({ path, problem: `mentions event ${id}, which is not in the evidence` })
      }
    }
  }
  const checkFreeText = (path: string, text: string) => {
    checkMentionedIds(path, text)
    for (const time of extractTimes(text)) {
      if (!allTimes.has(time)) {
        problems.push({ path, problem: `mentions ${time}, which is not a time in the evidence` })
      }
    }
    for (const id of identitiesIn(text)) {
      if (!allAccounts.has(id)) {
        problems.push({
          path,
          problem: `mentions ${identityKind(id)} ${id}, which is not in the evidence`,
        })
      }
    }
  }

  if (proposal.explanation.trim() === '') {
    problems.push({ path: 'explanation', problem: 'empty' })
  }
  checkFreeText('explanation', proposal.explanation)

  if (proposal.findings.length === 0) problems.push({ path: 'findings', problem: 'no findings' })
  proposal.findings.forEach((finding, i) => {
    const path = `findings[${i}]`
    if (finding.claim.trim() === '') problems.push({ path, problem: 'empty claim' })
    if (finding.event_ids.length === 0) problems.push({ path, problem: 'cites no event' })

    const cited: LogEvent[] = []
    for (const id of finding.event_ids) {
      const event = byId.get(id)
      if (event) cited.push(event)
      else problems.push({ path, problem: `cites event ${id}, which is not in the evidence` })
    }
    checkMentionedIds(path, finding.claim)

    const citedTimes = new Set(cited.flatMap(timesOf))
    for (const time of extractTimes(finding.claim)) {
      if (!citedTimes.has(time)) {
        problems.push({ path, problem: `mentions ${time}, which is not a time in the events it cites` })
      }
    }
    const citedAccounts = new Set(cited.flatMap(accountsOf))
    for (const id of identitiesIn(finding.claim)) {
      if (!citedAccounts.has(id)) {
        problems.push({
          path,
          problem: `mentions ${identityKind(id)} ${id}, which is not in the events it cites`,
        })
      }
    }
  })

  proposal.recommended_actions.forEach((action, i) =>
    checkFreeText(`recommended_actions[${i}]`, action),
  )
  return problems
}

type Rule = Pick<LogEvent, 'outcome' | 'device'> & {
  action: EventAction | readonly EventAction[]
  name?: string // how a list of actions is described in a note
}

// What an event must be for a finding of each type to rest on it.
const RULES: Record<Exclude<FindingType, 'other'>, Rule> = {
  sign_in_from_unrecognised_device: { action: 'sign-in', outcome: 'success', device: 'unrecognised' },
  sign_in: { action: 'sign-in', outcome: 'success' },
  sign_out: { action: 'sign-out', outcome: 'success' },
  account_created: { action: 'create account', outcome: 'success' },
  security_setting_changed: { action: 'change security setting', outcome: 'success' },
  data_access_denied: { action: 'read', outcome: 'denied' },
  data_access_succeeded: { action: 'read', outcome: 'success' },
  account_owner_statement: { action: 'written statement', outcome: 'recorded' },
  // LANL: a successful logon of any type. Not a sign-in, not an attack.
  logon: { action: LOGON_ACTIONS, outcome: 'success', name: 'a logon' },
  // LANL: a logon the evidence records as denied, and nothing more. A
  // successful logon contradicts it; a denied Kerberos ticket is not a logon.
  denied_logon: { action: LOGON_ACTIONS, outcome: 'denied', name: 'a logon' },
}

// One cited event against one rule. A different kind of event is no support;
// the right kind with a different outcome or device contradicts the finding.
function judge(event: LogEvent, rule: Rule): FindingSupport {
  const actions: readonly EventAction[] = typeof rule.action === 'string' ? [rule.action] : rule.action
  if (!actions.includes(event.action)) {
    const wanted = typeof rule.action === 'string' ? `"${rule.action}"` : rule.name
    return {
      status: 'unsupported',
      notes: [`${event.id} is a "${event.action}" event, not ${wanted}`],
    }
  }
  if (event.outcome !== rule.outcome) {
    return {
      status: 'contradicted',
      notes: [`${event.id} has outcome "${event.outcome}", not "${rule.outcome}"`],
    }
  }
  if (rule.device && event.device !== rule.device) {
    return {
      status: event.device ? 'contradicted' : 'unsupported',
      notes: [`${event.id} has device "${event.device ?? 'not recorded'}", not "${rule.device}"`],
    }
  }
  return { status: 'supported', notes: [] }
}

// A finding is supported only if it cites at least one event, every cited
// event exists, and every one meets the rule for the finding's type. A missing
// citation gets no note here: checkProposal already reports it.
export function checkSupport(proposal: IncidentProposal, events: LogEvent[]): FindingSupport[] {
  const byId = new Map(events.map((e) => [e.id, e]))
  return proposal.findings.map((finding) => {
    if (finding.type === 'other') return { status: 'unchecked', notes: [] }
    const rule = RULES[finding.type]
    const cited = finding.event_ids
      .map((id) => byId.get(id))
      .filter((e): e is LogEvent => e !== undefined)
    const verdicts = cited.map((event) => judge(event, rule))
    const notes = verdicts.flatMap((v) => v.notes)
    if (verdicts.some((v) => v.status === 'contradicted')) return { status: 'contradicted', notes }
    const allMet =
      cited.length > 0 &&
      cited.length === finding.event_ids.length &&
      verdicts.every((v) => v.status === 'supported')
    return { status: allMet ? 'supported' : 'unsupported', notes }
  })
}

// The explanation is prose, which code cannot read. What code can do is refuse
// to let it lean on an event that no supported finding cites. Events that are
// not in the evidence at all are reported by checkProposal.
export function checkExplanationEvents(
  proposal: IncidentProposal,
  support: FindingSupport[],
  events: LogEvent[],
): Problem[] {
  const inEvidence = new Set(events.map((e) => e.id))
  const supported = new Set(
    proposal.findings.flatMap((f, i) => (support[i]?.status === 'supported' ? f.event_ids : [])),
  )
  return [...new Set(extractEventIds(proposal.explanation))]
    .filter((id) => inEvidence.has(id) && !supported.has(id))
    .map((id) => ({
      path: 'explanation',
      problem: `mentions event ${id}, which no supported finding cites`,
    }))
}

// Generic finding types, and the more specific types that already say the
// same about an event and more.
const MORE_SPECIFIC: Partial<Record<FindingType, FindingType[]>> = {
  sign_in: ['sign_in_from_unrecognised_device'],
}

const sameEvents = (a: string[], b: string[]) =>
  new Set(a).size === new Set(b).size && a.every((id) => b.includes(id))

// A finding that repeats an earlier one adds no evidence, nor does a generic
// finding about events a supported, more specific finding already covers.
// Counting either would make the proposal look better evidenced than it is.
export function checkRepeats(proposal: IncidentProposal, support: FindingSupport[]): Problem[] {
  const { findings } = proposal
  return findings.flatMap((finding, i): Problem[] => {
    const path = `findings[${i}]`
    const earlier = findings.findIndex(
      (other, j) => j < i && other.type === finding.type && sameEvents(other.event_ids, finding.event_ids),
    )
    if (earlier !== -1) return [{ path, problem: `repeats finding ${earlier + 1}` }]
    const specific = findings.findIndex(
      (other, j) =>
        j !== i &&
        finding.event_ids.length > 0 &&
        (MORE_SPECIFIC[finding.type] ?? []).includes(other.type) &&
        support[j]?.status === 'supported' &&
        finding.event_ids.every((id) => other.event_ids.includes(id)),
    )
    if (specific !== -1) {
      return [{ path, problem: `repeats finding ${specific + 1} in a less specific form` }]
    }
    return []
  })
}

export function verifyProposal(
  raw: string,
  events: LogEvent[],
  findingTypes: readonly FindingType[] = FINDING_TYPES,
): Verification {
  const parse = parseProposal(raw, findingTypes)
  if (!parse.ok) return { parse, problems: [], support: [], passes: [], covered: [], uncited: [] }
  const { findings } = parse.proposal
  const support = checkSupport(parse.proposal, events)
  const problems = [
    ...checkProposal(parse.proposal, events),
    ...checkExplanationEvents(parse.proposal, support, events),
    ...checkRepeats(parse.proposal, support),
  ]
  const passes = findings.map(
    (_, i) =>
      support[i].status === 'supported' && !problems.some((p) => p.path === `findings[${i}]`),
  )
  const citedBy = (keep: (i: number) => boolean) =>
    new Set(findings.flatMap((f, i) => (keep(i) ? f.event_ids : [])))
  const passing = citedBy((i) => passes[i])
  const cited = citedBy(() => true)
  return {
    parse,
    problems,
    support,
    passes,
    covered: events.map((e) => e.id).filter((id) => passing.has(id)),
    uncited: events.map((e) => e.id).filter((id) => !cited.has(id)),
  }
}
