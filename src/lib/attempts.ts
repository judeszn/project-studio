// One investigation run, step by step (audit items C1, M6, H4; owner's
// approval of the D1–D3 package, 2026-11-26). Every inference attempt and
// every consent decision becomes a step, and every step is recorded: an
// analyst should never have to guess what happened.
//
// Bounded execution: an on-device attempt is stopped, and the stop recorded,
// when its output turns into a long run of whitespace (the breakdown measured
// on 2026-11-26), grows past a length no answer needs, or takes too long.
// Nothing here retries: a stopped attempt ends as a stopped attempt.

// Whitespace at the end of the output, counted since the last other
// character. Measured on 2026-11-26 over 20 attempts with no early stop: the
// longest whitespace run in any answer Gemini Nano completed was 66
// characters (12 completed answers); every attempt whose run passed 200 (4 of
// 4, between 6 and 16 s in) ended in Chrome's output-limit error after about
// 225 s, one of them after content resumed past an 8,209-character run. See
// attempts.test.ts.
export const WHITESPACE_RUN_LIMIT = 200

// The longest answer the schema allows is 8 findings of up to 4 IDs, an
// explanation and 5 actions; completed answers measured 1,005 to 2,353
// characters (2026-11-26). Chrome's own output limit fell at about 12,000.
export const OUTPUT_CHAR_LIMIT = 8_000

// The slowest completed on-device run recorded is 96.4 s (2026-11-23).
export const DEVICE_TIME_LIMIT_MS = 120_000

// The slowest completed cloud run recorded is 23.0 s (2026-11-26). The SDK's
// own default is 180 s.
export const CLOUD_TIME_LIMIT_MS = 90_000

export type StopReason = 'whitespace run' | 'output limit' | 'time limit' | 'cancelled by analyst'

export const STOP_EXPLANATION: Record<StopReason, string> = {
  'whitespace run': `its output turned into a run of more than ${WHITESPACE_RUN_LIMIT} whitespace characters`,
  'output limit': `its output passed ${OUTPUT_CHAR_LIMIT.toLocaleString('en')} characters`,
  'time limit': 'it reached the time limit',
  'cancelled by analyst': 'you stopped it',
}

// Length of the whitespace run at the end of `text`.
export function trailingWhitespace(text: string): number {
  let n = 0
  for (let i = text.length - 1; i >= 0 && /\s/.test(text[i]); i--) n++
  return n
}

// Why output streamed so far should be stopped, or null to keep going.
export function shouldStop(text: string): StopReason | null {
  if (trailingWhitespace(text) > WHITESPACE_RUN_LIMIT) return 'whitespace run'
  if (text.length > OUTPUT_CHAR_LIMIT) return 'output limit'
  return null
}

export type Where = 'device' | 'cloud'

export interface AttemptStep {
  kind: 'attempt'
  where: Where
  sdkMode: string
  streamed: boolean // on-device attempts stream, so they can be watched and stopped
  consented: boolean // the analyst's consent preceded it (always, for the cloud)
  startedAt: string
  finishedAt: string
  durationMs: number
  onlineAtStart: boolean
  onlineAtEnd: boolean
  outcome: 'completed' | 'stopped' | 'error'
  stopReason: StopReason | null
  error: string | null
  inferenceSource: string | null // as the Firebase AI Logic SDK reported it
  output: string | null // everything received, exactly; null when nothing was
  // A stopped or timed-out cloud request: this page stopped waiting, and the
  // SDK cannot say whether Google stopped processing. Null for the device.
  remoteProcessing: null | 'unknown'
}

export interface ConsentStep {
  kind: 'consent'
  reason: 'unavailable' | 'local_failed' | 'cloud_requested'
  detail: string
  askedAt: string
  decision: 'granted' | 'declined' | null // null while the question is on screen
  decidedAt: string | null
}

export type Step = AttemptStep | ConsentStep

// Raised inside an attempt that was stopped on purpose, with what it had
// written by then.
export class AttemptStopped extends Error {
  readonly reason: StopReason
  readonly output: string
  readonly inferenceSource: string | null
  constructor(reason: StopReason, output: string, inferenceSource: string | null) {
    super(`Stopped: ${STOP_EXPLANATION[reason]}.`)
    this.name = 'AttemptStopped'
    this.reason = reason
    this.output = output
    this.inferenceSource = inferenceSource
  }
}

// Wraps an async action so that a second call while the first is running is
// ignored: a double click on "Send … to the cloud" sends once.
export function guardInFlight<A extends unknown[], R>(
  action: (...args: A) => Promise<R>,
): (...args: A) => Promise<R | undefined> {
  let running = false
  return async (...args: A) => {
    if (running) return undefined
    running = true
    try {
      return await action(...args)
    } finally {
      running = false
    }
  }
}
