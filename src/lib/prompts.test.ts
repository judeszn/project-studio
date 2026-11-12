import { describe, expect, it } from 'vitest'
import { SYSTEM_PROMPT, authSystemPrompt, buildPrompt } from './prompts'
import { sha256Hex } from './record'
import type { LogEvent } from './schema'

// The prompts are pinned word for word. A change here is a change to what
// every earlier run was asked, so it has to be made on purpose.

describe('GS-03 system prompt', () => {
  it('is the text the built-in case has always run against', async () => {
    expect(SYSTEM_PROMPT).toBe(
      'You assist a security analyst. You are given a list of log events from one organisation, each with an ID. Use only the events given. First list your findings, at most 8, about the events that bear on whether an account was misused; leave out routine activity. Every finding must cite the IDs of the events that support it, and must quote times exactly as the events give them. Give each finding the type that matches what its cited events show, or "other" if no type fits, and cite only the events that directly show it: a sign-out is not a sign-in. Then explain in at most three sentences, then classify. Credential Compromise: someone other than the owner used an account. Insider Threat: a trusted person misused access they legitimately hold. Phishing: a deceptive message was used to gain access. Ransomware: data was encrypted for extortion. Data Exfiltration: data was copied out of the organisation. Do not say that data was accessed or taken, or that a person is at fault, unless an event says so. If the events are not enough to decide, choose Undetermined. Recommend at most 5 actions. You make a proposal. The analyst decides.',
    )
    expect(await sha256Hex(SYSTEM_PROMPT)).toBe(
      '50ad17ee4825842169b963b32289b11c0cfab5bf0a2301fb9ba2edf9d98009a8',
    )
  })
})

describe('authentication system prompt', () => {
  it('defines logon and denied_logon in the approved words', () => {
    const prompt = authSystemPrompt([])
    expect(prompt).toContain(
      '"logon": an account successfully authenticated to a computer; it is not a person signing in and not by itself an attack. "denied_logon": an authentication to a computer that was denied. A logoff or a Kerberos ticket is not a logon.',
    )
  })

  it('keeps the classification definitions of the GS-03 prompt', () => {
    const tail = SYSTEM_PROMPT.slice(SYSTEM_PROMPT.indexOf('Then explain'))
    expect(authSystemPrompt([])).toContain(tail)
    expect(authSystemPrompt([]).endsWith(tail)).toBe(true)
  })

  it("appends the case file's notes after the instruction, in order", () => {
    const base = authSystemPrompt([])
    expect(authSystemPrompt(['First note.', 'Second note.'])).toBe(`${base} First note. Second note.`)
  })

  it('names no pattern a selector or baseline looks for', () => {
    expect(authSystemPrompt([])).not.toMatch(/first[- ]seen|lateral|new destination|many computers|red team/i)
  })
})

describe('buildPrompt', () => {
  const event = (over: Partial<LogEvent>): LogEvent => ({
    id: 'E01',
    date: 'Day 2',
    time: 'elapsed 00:00:01',
    source: 'identity',
    actor: 'U1@DOM1',
    action: 'network logon',
    target: 'C2',
    outcome: 'success',
    detail: 'from C1',
    ...over,
  })

  it('gives one line per event, in the given order, between a header and the task', () => {
    expect(buildPrompt([event({}), event({ id: 'E02', outcome: 'denied' })])).toBe(
      'Events (ID | date time | source | actor | action | target | outcome | detail):\n' +
        'E01 | Day 2 elapsed 00:00:01 | identity | U1@DOM1 | network logon | C2 | success | from C1\n' +
        'E02 | Day 2 elapsed 00:00:01 | identity | U1@DOM1 | network logon | C2 | denied | from C1\n\n' +
        'List findings that cite event IDs, then explain, then propose a classification.',
    )
  })
})
