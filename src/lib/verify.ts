import { CLASSIFICATIONS, CONFIDENCE_LEVELS } from './schema'
import type { IncidentProposal, LogEvent } from './schema'

// Deterministic checks on model output. Nothing here calls a model, and every
// check fails closed: anything it cannot confirm is reported, never assumed OK.
//
// What these checks establish: the events a finding cites exist, and the times
// it quotes are times of those events. They do not establish that the finding
// reads those events correctly, or that the classification is right. That
// judgement belongs to the analyst.

export type ParseResult =
  | { ok: true; proposal: IncidentProposal }
  | { ok: false; errors: string[] }

export interface Problem {
  path: string
  problem: string
}

export interface Verification {
  parse: ParseResult
  problems: Problem[]
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === 'string')

const oneOf = (allowed: readonly string[], v: unknown) =>
  typeof v === 'string' && allowed.includes(v)

const PROPOSAL_KEYS = [
  'classification',
  'confidence',
  'explanation',
  'findings',
  'recommended_actions',
]
const FINDING_KEYS = ['claim', 'event_ids']

function unknownKeys(obj: Record<string, unknown>, allowed: string[], at: string): string[] {
  return Object.keys(obj)
    .filter((k) => !allowed.includes(k))
    .map((k) => `${at}${k}: unexpected field`)
}

export function parseProposal(raw: string): ParseResult {
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
  }
  if (!Array.isArray(data.findings)) {
    errors.push('findings: expected an array')
  } else {
    data.findings.forEach((f: unknown, i: number) => {
      const at = `findings[${i}]`
      if (!isObject(f)) {
        errors.push(`${at}: expected an object`)
        return
      }
      errors.push(...unknownKeys(f, FINDING_KEYS, `${at}.`))
      if (typeof f.claim !== 'string') errors.push(`${at}.claim: expected a string`)
      if (!isStringArray(f.event_ids)) errors.push(`${at}.event_ids: expected an array of strings`)
    })
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, proposal: data as unknown as IncidentProposal }
}

const TIME = /\b(\d{1,2}):(\d{2})\b/g
const EVENT_ID = /\bE\d+\b/g

// Clock times as zero-padded HH:MM ("2:20" -> "02:20"). Known limit: am/pm is
// not read, so "2:20 pm" is treated as 02:20.
export function extractTimes(text: string): string[] {
  return [...text.matchAll(TIME)].map(([, h, m]) => `${h.padStart(2, '0')}:${m}`)
}

export function extractEventIds(text: string): string[] {
  return text.match(EVENT_ID) ?? []
}

// An event's own time, plus any time quoted in its detail (a statement may
// refer to an earlier moment).
const timesOf = (event: LogEvent) => [event.time, ...extractTimes(event.detail)]

// Every finding must cite at least one event, every cited event must exist,
// and every time a finding quotes must belong to an event it cites. Free text
// outside findings may only mention events and times that are in the evidence.
export function checkProposal(proposal: IncidentProposal, events: LogEvent[]): Problem[] {
  const byId = new Map(events.map((e) => [e.id, e]))
  const allTimes = new Set(events.flatMap(timesOf))
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
  })

  proposal.recommended_actions.forEach((action, i) =>
    checkFreeText(`recommended_actions[${i}]`, action),
  )
  return problems
}

export function verifyProposal(raw: string, events: LogEvent[]): Verification {
  const parse = parseProposal(raw)
  if (!parse.ok) return { parse, problems: [] }
  return { parse, problems: checkProposal(parse.proposal, events) }
}
