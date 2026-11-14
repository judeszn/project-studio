import { InferenceMode } from 'firebase/ai'
import { describe, expect, it } from 'vitest'
import {
  CLOUD_DATA_TERMS,
  GEMINI_TERMS_URL,
  LOCAL_MODE,
  NO_PROMPT_API,
  investigate,
  sendWithConsent,
  type Engine,
  type RunMode,
} from './hybrid'

// The router, with a fake engine that records every run and what it would
// send. hybrid-sdk.test.ts checks the modes themselves against the real SDK.

interface Fake extends Engine {
  runs: RunMode[]
}

function fakeEngine({
  adapter = true,
  availability = ['available'],
  local = 'ok',
}: {
  adapter?: boolean
  availability?: string[] // successive answers to availability()
  local?: 'ok' | 'throws'
} = {}): Fake {
  const answers = [...availability]
  const runs: RunMode[] = []
  return {
    runs,
    onDeviceAdapter: adapter,
    availability: async () => answers.shift() ?? 'available',
    run: async (mode, prompt) => {
      expect(prompt).toBe(PROMPT)
      runs.push(mode)
      if (mode === LOCAL_MODE && local === 'throws') throw new Error('QuotaExceededError')
      return { text: '{}', inferenceSource: mode === LOCAL_MODE ? 'on_device' : 'in_cloud' }
    },
  }
}

const PROMPT = 'Events: E01 | ...'

const cloudModes: RunMode[] = [InferenceMode.PREFER_ON_DEVICE, InferenceMode.PREFER_IN_CLOUD]
const sentToCloud = (e: Fake) => e.runs.some((m) => cloudModes.includes(m))

describe('investigate: never sends without consent', () => {
  it('runs locally when Nano is available', async () => {
    const engine = fakeEngine()
    const out = await investigate(engine, 'on_device', PROMPT)
    expect(out).toMatchObject({ kind: 'done', mode: LOCAL_MODE, consented: false, inferenceSource: 'on_device' })
    expect(engine.runs).toEqual([LOCAL_MODE])
  })

  it('asks for consent, and runs nothing, when Nano is unavailable', async () => {
    for (const availability of ['unavailable', 'downloadable', 'downloading', 'error: x']) {
      const engine = fakeEngine({ availability: [availability] })
      const out = await investigate(engine, 'on_device', PROMPT)
      expect(out).toMatchObject({ kind: 'consent', reason: 'unavailable' })
      expect(engine.runs).toEqual([])
    }
  })

  it('asks for consent, and runs nothing, when the browser has no Prompt API', async () => {
    const engine = fakeEngine({ adapter: false })
    expect(await investigate(engine, 'on_device', PROMPT)).toEqual({
      kind: 'consent',
      reason: 'unavailable',
      detail: NO_PROMPT_API,
    })
    expect(engine.runs).toEqual([])
  })

  it('asks for consent when local inference fails, after trying only locally', async () => {
    const engine = fakeEngine({ local: 'throws' })
    const out = await investigate(engine, 'on_device', PROMPT)
    expect(out).toMatchObject({ kind: 'consent', reason: 'local_failed' })
    expect(engine.runs).toEqual([LOCAL_MODE])
    expect(sentToCloud(engine)).toBe(false)
  })

  it('a direct cloud request still asks first, and runs nothing', async () => {
    const engine = fakeEngine()
    expect(await investigate(engine, 'in_cloud', PROMPT)).toMatchObject({ kind: 'consent', reason: 'cloud_requested' })
    expect(engine.runs).toEqual([])
  })

  it('only ever uses the local-only mode, whatever availability does', async () => {
    // Every sequence of availability answers, including "available" at the
    // check and then failing at the run (Nano lost in between).
    for (const availability of [['available'], ['unavailable'], ['downloadable', 'available']]) {
      for (const local of ['ok', 'throws'] as const) {
        const engine = fakeEngine({ availability, local })
        await investigate(engine, 'on_device', PROMPT)
        expect(engine.runs.every((m) => m === LOCAL_MODE)).toBe(true)
      }
    }
  })
})

describe('sendWithConsent', () => {
  it('uses the SDK fallback mode when Nano was unavailable', async () => {
    const engine = fakeEngine()
    const out = await sendWithConsent(engine, 'unavailable', PROMPT)
    expect(out).toMatchObject({ kind: 'done', mode: InferenceMode.PREFER_ON_DEVICE, consented: true })
  })

  it('uses the cloud-preferring mode after a local failure or a direct request', async () => {
    for (const reason of ['local_failed', 'cloud_requested'] as const) {
      const engine = fakeEngine()
      const out = await sendWithConsent(engine, reason, PROMPT)
      expect(out).toMatchObject({ mode: InferenceMode.PREFER_IN_CLOUD, consented: true })
    }
  })

  it('a declined request is simply never sent: the router has no other path to the cloud', async () => {
    // Declining means not calling sendWithConsent. investigate() is the only
    // other entry point, and the tests above show it never uses a cloud mode.
    const engine = fakeEngine({ availability: ['unavailable'] })
    await investigate(engine, 'on_device', PROMPT)
    expect(sentToCloud(engine)).toBe(false)
  })
})

describe('the consent prompt discloses the free Gemini tier', () => {
  it('says Google may use what is sent, people may read it, and not to send sensitive data', () => {
    expect(CLOUD_DATA_TERMS).toMatch(/free tier of the Gemini Developer API/)
    expect(CLOUD_DATA_TERMS).toMatch(/Google may use what you send to improve its products/)
    expect(CLOUD_DATA_TERMS).toMatch(/human reviewers may read it/)
    expect(CLOUD_DATA_TERMS).toMatch(/Do not send sensitive, confidential or personal information/)
    expect(GEMINI_TERMS_URL).toBe('https://ai.google.dev/gemini-api/terms')
  })
})

describe('consent is asked before every cloud send, not only the first', () => {
  it('after a consented send, the next cloud request asks again and sends nothing until consent', async () => {
    const engine = fakeEngine()
    expect(await investigate(engine, 'in_cloud', PROMPT)).toMatchObject({ kind: 'consent' })
    await sendWithConsent(engine, 'cloud_requested', PROMPT)
    expect(engine.runs).toEqual([InferenceMode.PREFER_IN_CLOUD])
    // The router keeps no memory of the earlier consent.
    expect(await investigate(engine, 'in_cloud', PROMPT)).toMatchObject({ kind: 'consent' })
    expect(engine.runs).toEqual([InferenceMode.PREFER_IN_CLOUD])
  })

  it('the same holds when Nano is unavailable each time', async () => {
    const engine = fakeEngine({ availability: ['downloadable', 'downloadable'] })
    expect(await investigate(engine, 'on_device', PROMPT)).toMatchObject({ kind: 'consent' })
    await sendWithConsent(engine, 'unavailable', PROMPT)
    expect(await investigate(engine, 'on_device', PROMPT)).toMatchObject({ kind: 'consent' })
    expect(engine.runs).toEqual([InferenceMode.PREFER_ON_DEVICE])
  })
})
