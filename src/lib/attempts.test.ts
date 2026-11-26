import { describe, expect, it } from 'vitest'
import BASELINE from './fixtures/nano-baseline-2026-11-26.json?raw'
import { OUTPUT_CHAR_LIMIT, WHITESPACE_RUN_LIMIT, guardInFlight, shouldStop, trailingWhitespace } from './attempts'

// The early stop must tell Gemini Nano's breakdown from legitimate JSON
// formatting. It is checked here against valid pretty-printed JSON and against
// every answer Gemini Nano completed in the 26 November baseline (production
// app, simulated sample; fixtures/nano-baseline-2026-11-26.json), at every
// point of the stream, one character at a time.

const baseline = JSON.parse(BASELINE) as {
  attempts: { n: number; outcome: string; raw?: string | null }[]
}
const completed = baseline.attempts.filter((a) => a.outcome === 'completed').map((a) => a.raw!)

// The first point at which a stream of `text` would be stopped, if any.
function firstStop(text: string) {
  for (let i = 1; i <= text.length; i++) {
    const reason = shouldStop(text.slice(0, i))
    if (reason) return { reason, at: i }
  }
  return null
}

const longestRun = (text: string) => Math.max(0, ...(text.match(/\s+/g) ?? []).map((r) => r.length))

const nested = (depth: number): unknown =>
  depth === 0 ? { claim: 'fin-clerk-04 was refused at 09:12', event_ids: ['E06', 'E07'] } : { level: depth, next: [nested(depth - 1)] }

describe('the early stop: whitespace breakdown versus formatting', () => {
  it('counts only the whitespace at the end of the output', () => {
    expect(trailingWhitespace('{"a": 1}')).toBe(0)
    expect(trailingWhitespace('{\n  ')).toBe(3)
    expect(trailingWhitespace('   ')).toBe(3)
    expect(trailingWhitespace('')).toBe(0)
  })

  it('never stops valid pretty-printed JSON, however deep, at any point of the stream', () => {
    for (const indent of [2, 4, '\t']) {
      const text = JSON.stringify(nested(12), null, indent)
      expect(firstStop(text), String(indent)).toBeNull()
      expect(firstStop(text.replace(/\n/g, '\r\n')), `${indent} CRLF`).toBeNull()
    }
  })

  it('never stops an answer Gemini Nano completed in the baseline, at any point of the stream', () => {
    expect(completed.length).toBeGreaterThanOrEqual(5)
    for (const raw of completed) expect(firstStop(raw)).toBeNull()
  })

  it('keeps a margin over the longest whitespace run in any completed answer', () => {
    const longest = Math.max(...completed.map(longestRun))
    expect(longest).toBeLessThan(WHITESPACE_RUN_LIMIT / 2)
  })

  it('stops the breakdown as observed: newline and indentation repeated without end', () => {
    const start = completed[0].slice(0, 700)
    const broken = start + '\n  '.repeat(1000)
    const stop = firstStop(broken)
    expect(stop?.reason).toBe('whitespace run')
    expect(stop!.at).toBe(start.length + WHITESPACE_RUN_LIMIT + 1 - trailingWhitespace(start))
  })

  it('stops output that passes the length limit, whatever it is', () => {
    expect(shouldStop('x'.repeat(OUTPUT_CHAR_LIMIT))).toBeNull()
    expect(shouldStop('x'.repeat(OUTPUT_CHAR_LIMIT + 1))).toBe('output limit')
  })
})

describe('guardInFlight: a double click acts once', () => {
  it('ignores a second call while the first runs, then allows the next', async () => {
    let calls = 0
    let release!: () => void
    const send = guardInFlight(async () => {
      calls++
      await new Promise<void>((r) => (release = r))
      return 'sent'
    })
    const first = send()
    const second = send() // the double click
    expect(await second).toBeUndefined()
    release()
    expect(await first).toBe('sent')
    expect(calls).toBe(1)
    const third = send()
    release()
    expect(await third).toBe('sent')
    expect(calls).toBe(2)
  })

  it('is released when the action fails', async () => {
    let calls = 0
    const send = guardInFlight(async () => {
      calls++
      throw new Error('boom')
    })
    await expect(send()).rejects.toThrow('boom')
    await expect(send()).rejects.toThrow('boom')
    expect(calls).toBe(2)
  })
})
