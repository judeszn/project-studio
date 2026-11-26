import { describe, expect, it } from 'vitest'
import { parseCaseFile } from '../../src/lib/casefile'
import { authSystemPrompt, buildPrompt } from '../../src/lib/prompts'
import { sha256Hex } from '../../src/lib/record'
import { AUTH_VOCABULARY, LANL_CITATION, LANL_TIME_NOTE, toEvidence, type CaseFile } from './case'
import { authFixture } from './testing'

// The LANL system prompt, frozen 2026-11-12 before any model saw LANL
// evidence. Both evaluation runs must record this hash.
export const FROZEN_LANL_PROMPT_SHA256 = '4439ce200e3d17fa250e425ce08a8e15c48220667d29f98034f8c36bfc46d6e7'

describe('frozen LANL system prompt', () => {
  it('is word for word the approved text', async () => {
    const prompt = authSystemPrompt([LANL_TIME_NOTE])
    expect(prompt).toBe(
      'You assist a security analyst. You are given a list of authentication events from one organisation, each with an ID. Use only the events given. First list your findings, at most 8, about the events that bear on whether an account was misused; leave out routine activity. Every finding must cite the IDs of the events that support it, and must quote times exactly as the events give them. Give each finding the type that matches what its cited events show, or "other" if no type fits, and cite only the events that directly show it. "logon": an account successfully authenticated to a computer; it is not a person signing in and not by itself an attack. "denied_logon": an authentication to a computer that was denied. A logoff or a Kerberos ticket is not a logon. Then explain in at most three sentences, then classify. Credential Compromise: someone other than the owner used an account. Insider Threat: a trusted person misused access they legitimately hold. Phishing: a deceptive message was used to gain access. Ransomware: data was encrypted for extortion. Data Exfiltration: data was copied out of the organisation. Do not say that data was accessed or taken, or that a person is at fault, unless an event says so. If the events are not enough to decide, choose Undetermined. Recommend at most 5 actions. You make a proposal. The analyst decides. Times are relative dataset timestamps: "Day N · elapsed HH:MM:SS" counts from the dataset\'s undisclosed start. They are not local clock times and cannot show whether an event happened at night or outside working hours. Order events by the numeric dataset time given in each event (seconds).',
    )
    expect(await sha256Hex(prompt)).toBe(FROZEN_LANL_PROMPT_SHA256)
  })
})

// The loader in the page must open what the case builder writes, unchanged.
describe('a built case opens in the page loader', () => {
  const built = (): CaseFile => {
    const c = toEvidence(authFixture().slice(0, 5), AUTH_VOCABULARY)
    if (!c.ok) throw new Error(c.errors.join('; '))
    return {
      spec: { id: 'synthetic-case', start: 100, end: 300, computers: [], users: [], maxEvents: 10 },
      source: { dataset: 'SYNTHETIC', citation: LANL_CITATION, file: 'SYNTHETIC-auth.txt', sha256: 'abc' },
      modelNotes: [LANL_TIME_NOTE],
      events: c.events,
    }
  }

  it('keeps every evidence row, its ID and its original record', () => {
    const file = built()
    const parsed = parseCaseFile(JSON.stringify(file, null, 2) + '\n')
    if (!parsed.ok) throw new Error(parsed.errors.join('; '))
    expect(parsed.case.id).toBe('synthetic-case')
    expect(parsed.case.events).toEqual(file.events.map((e) => e.evidence))
    expect(parsed.case.modelNotes).toEqual([LANL_TIME_NOTE])
    for (const e of file.events) expect(parsed.case.provenance[e.evidence.id]).toEqual(e.provenance)
  })

  it('gets the frozen system prompt, and a user prompt holding no provenance', async () => {
    const file = built()
    const parsed = parseCaseFile(JSON.stringify(file))
    if (!parsed.ok) throw new Error(parsed.errors.join('; '))
    expect(await sha256Hex(authSystemPrompt(parsed.case.modelNotes))).toBe(FROZEN_LANL_PROMPT_SHA256)
    const prompt = buildPrompt(parsed.case.events)
    for (const e of file.events) {
      expect(prompt).toContain(e.evidence.id)
      expect(prompt).not.toContain(e.provenance.raw)
    }
    expect(prompt).not.toContain('SYNTHETIC-auth.txt')
  })
})
