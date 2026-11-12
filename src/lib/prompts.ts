import { MAX_ACTIONS, MAX_FINDINGS } from './schema'
import type { LogEvent } from './schema'

// What the models are told. The two system prompts share every sentence that
// is not about the evidence vocabulary, so the task and the classification
// definitions cannot drift apart. Both are pinned by tests: changing a word
// here changes what an evaluation ran against.

const task = (events: string) =>
  `You assist a security analyst. You are given a list of ${events} from one ` +
  'organisation, each with an ID. Use only the events given. First list your ' +
  `findings, at most ${MAX_FINDINGS}, about the events that bear on whether an ` +
  'account was misused; leave out routine activity. Every finding must cite the ' +
  'IDs of the events that support it, and must quote times exactly as the events ' +
  'give them. Give each finding the type that matches what its cited events show, ' +
  'or "other" if no type fits, and cite only the events that directly show it'

const CLASSIFY =
  'Then explain in at most three sentences, then ' +
  'classify. Credential Compromise: someone other than the owner used an account. ' +
  'Insider Threat: a trusted person misused access they legitimately hold. ' +
  'Phishing: a deceptive message was used to gain access. Ransomware: data was ' +
  'encrypted for extortion. Data Exfiltration: data was copied out of the ' +
  'organisation. Do not say that data was accessed or taken, or that a person is ' +
  'at fault, unless an event says so. If the events are not enough to decide, ' +
  `choose Undetermined. Recommend at most ${MAX_ACTIONS} actions. You make a ` +
  'proposal. The analyst decides.'

// The built-in GS-03 case.
export const SYSTEM_PROMPT = `${task('log events')}: a sign-out is not a sign-in. ${CLASSIFY}`

// Authentication case files (owner's approval, 2026-11-12). It names no
// pattern a selector or a baseline looks for: nothing about new destinations,
// many computers or movement between them.
const AUTH_TYPES =
  '"logon": an account successfully authenticated to a computer; it is not a ' +
  'person signing in and not by itself an attack. "denied_logon": an ' +
  'authentication to a computer that was denied. A logoff or a Kerberos ticket ' +
  'is not a logon.'

// A case file's own notes for the model (how its times are written, say)
// follow the instruction, in the file's order.
export const authSystemPrompt = (modelNotes: readonly string[]) =>
  [`${task('authentication events')}. ${AUTH_TYPES} ${CLASSIFY}`, ...modelNotes].join(' ')

const eventLine = (e: LogEvent) =>
  [e.id, `${e.date} ${e.time}`, e.source, e.actor, e.action, e.target, e.outcome, e.detail].join(' | ')

// The evidence as the model reads it: one line per event, in the given order.
export function buildPrompt(events: LogEvent[]): string {
  return (
    'Events (ID | date time | source | actor | action | target | outcome | detail):\n' +
    events.map(eventLine).join('\n') +
    '\n\nList findings that cite event IDs, then explain, then propose a classification.'
  )
}
