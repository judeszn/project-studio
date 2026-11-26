import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import { GoogleAIBackend, InferenceMode, getAI, getGenerativeModel } from 'firebase/ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_MODE, createEngine, failureOf, investigate, sendWithConsent } from './hybrid'
import { incidentProposalSchema, lanlProposalSchema } from './schema'

// The installed Firebase AI Logic SDK itself, not a mock of it. Under Node,
// `firebase/ai` resolves to the SDK's Node build, which has no on-device
// support; the page gets the browser build, so these tests load that.
// The build file ships without its own type declarations; its types are
// firebase/ai's.
// @ts-expect-error TS7016
vi.mock('firebase/ai', () => import('../../node_modules/@firebase/ai/dist/esm/index.esm.js'))

// Chrome's Prompt API is replaced by a stub whose availability answers are
// scripted, and the network by a stub that records every request. A request
// to the cloud is a call to fetch.

const PROMPT = 'Events: E01 | 2026-03-09 08:02 | identity | ...'
const CLOUD_TEXT = '{"from":"cloud"}'
const LOCAL_TEXT = '{"from":"device"}'

let app: FirebaseApp
let fetchCalls: { url: string; headers: Headers; body: string; signal: AbortSignal | null }[]
let localCalls: { createOptions: unknown; promptOptions: unknown }[]
let availabilityAnswers: string[]
let localPrompt: () => Promise<string>
// What Chrome's streaming prompt call yields, chunk by chunk; given the
// signal it received, so a fake can watch for its abort as Chrome does.
let localStream: (signal: AbortSignal | undefined) => ReadableStream<string>

const chunksOf = (...chunks: string[]) =>
  new ReadableStream<string>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
  })

// A stream that writes `first`, then `repeat` without end, as Gemini Nano's
// breakdown does, until its signal aborts it, as Chrome's stream is.
const endless = (first: string, repeat: string) => (signal: AbortSignal | undefined) =>
  new ReadableStream<string>({
    start(controller) {
      controller.enqueue(first)
      signal?.addEventListener('abort', () => controller.error(signal.reason))
    },
    async pull(controller) {
      await new Promise((r) => setTimeout(r, 0))
      if (signal?.aborted) return
      controller.enqueue(repeat)
    },
  })

function installPromptApi() {
  vi.stubGlobal('LanguageModel', {
    availability: vi.fn(async () => availabilityAnswers.shift() ?? 'available'),
    create: vi.fn(async (createOptions: unknown) => ({
      prompt: (_input: unknown, promptOptions: unknown) => {
        localCalls.push({ createOptions, promptOptions })
        return localPrompt()
      },
      promptStreaming: (_input: unknown, promptOptions: { signal?: AbortSignal }) => {
        localCalls.push({ createOptions, promptOptions })
        return localStream(promptOptions?.signal)
      },
      destroy() {},
    })),
  })
}

beforeEach(() => {
  app = initializeApp({ apiKey: 'test-key', projectId: 'test-project', appId: '1:1:web:1' }, `t${Math.random()}`)
  fetchCalls = []
  localCalls = []
  availabilityAnswers = []
  localPrompt = async () => LOCAL_TEXT
  localStream = () => chunksOf('{"from":', '"device"}')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      fetchCalls.push({
        url: String(url),
        headers: new Headers(init.headers),
        body: String(init.body),
        signal: init.signal ?? null,
      })
      if (cloudHangs) {
        // A request that never answers until its signal aborts it.
        await new Promise((_, reject) =>
          init.signal?.addEventListener('abort', () => reject(init.signal!.reason)),
        )
      }
      const body = { candidates: [{ content: { role: 'model', parts: [{ text: CLOUD_TEXT }] }, finishReason: 'STOP' }] }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }),
  )
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await deleteApp(app)
})

let cloudHangs = false
afterEach(() => {
  cloudHangs = false
})

const ai = () => getAI(app, { backend: new GoogleAIBackend() })
const engineNow = () => createEngine(ai(), 'system prompt').engine

describe('installed SDK: the run made without consent never reaches the cloud', () => {
  it('runs on the device when Nano is available', async () => {
    installPromptApi()
    const out = await investigate(engineNow(), 'on_device', PROMPT)
    expect(out).toMatchObject({ kind: 'done', mode: LOCAL_MODE, inferenceSource: 'on_device', text: LOCAL_TEXT })
    expect(fetchCalls).toEqual([])
  })

  it('race: Nano available at the page check, unavailable when the SDK checks', async () => {
    installPromptApi()
    availabilityAnswers = ['available', 'unavailable'] // page check, then the SDK's own
    const out = await investigate(engineNow(), 'on_device', PROMPT)
    expect(out).toMatchObject({ kind: 'consent', reason: 'local_failed' })
    expect(fetchCalls).toEqual([])
  })

  it('race: Nano available at the page check, downloadable when the SDK checks', async () => {
    installPromptApi()
    availabilityAnswers = ['available', 'downloadable']
    await investigate(engineNow(), 'on_device', PROMPT)
    expect(fetchCalls).toEqual([])
  })

  it('Nano fails during inference', async () => {
    installPromptApi()
    // On-device attempts stream (2026-11-26), so Chrome's failure arrives on
    // the stream.
    localStream = () =>
      new ReadableStream<string>({
        start(controller) {
          controller.error(new DOMException('input too large', 'QuotaExceededError'))
        },
      })
    const out = await investigate(engineNow(), 'on_device', PROMPT)
    expect(out).toMatchObject({ kind: 'consent', reason: 'local_failed' })
    expect(fetchCalls).toEqual([])
  })

  it('no Prompt API: asks for consent and sends nothing', async () => {
    const out = await investigate(engineNow(), 'on_device', PROMPT)
    expect(out).toMatchObject({ kind: 'consent', reason: 'unavailable' })
    expect(fetchCalls).toEqual([])
  })
})

describe('installed SDK: after consent, cloud requests are hybrid', () => {
  const hybridTagged = () =>
    fetchCalls.length === 1 && /\bhybrid\b/.test(fetchCalls[0].headers.get('x-goog-api-client') ?? '')

  it('Nano unavailable + consent: the SDK falls back to the cloud', async () => {
    installPromptApi()
    availabilityAnswers = ['unavailable', 'unavailable']
    const engine = engineNow()
    expect(await investigate(engine, 'on_device', PROMPT)).toMatchObject({ kind: 'consent' })
    expect(fetchCalls).toEqual([])
    const out = await sendWithConsent(engine, 'unavailable', PROMPT)
    expect(out).toMatchObject({ mode: InferenceMode.PREFER_ON_DEVICE, inferenceSource: 'in_cloud', text: CLOUD_TEXT })
    expect(hybridTagged()).toBe(true)
  })

  it('no Prompt API + consent: the cloud answers', async () => {
    const out = await sendWithConsent(engineNow(), 'unavailable', PROMPT)
    expect(out).toMatchObject({ inferenceSource: 'in_cloud' })
    expect(hybridTagged()).toBe(true)
  })

  it('local failure + consent, or a direct cloud request + consent: PREFER_IN_CLOUD', async () => {
    installPromptApi()
    const out = await sendWithConsent(engineNow(), 'cloud_requested', PROMPT)
    expect(out).toMatchObject({ mode: InferenceMode.PREFER_IN_CLOUD, inferenceSource: 'in_cloud' })
    expect(hybridTagged()).toBe(true)
  })
})

// A case file's instruction and finding types must be the ones each model
// is actually given.
describe('installed SDK: the instruction and schema of the case reach the model', () => {
  const caseEngine = () => createEngine(ai(), 'case instruction', lanlProposalSchema).engine

  it('on the device: system prompt and response constraint', async () => {
    installPromptApi()
    await investigate(caseEngine(), 'on_device', PROMPT)
    expect(localCalls).toHaveLength(1)
    expect(JSON.stringify(localCalls[0].createOptions)).toContain('case instruction')
    expect(localCalls[0].promptOptions).toMatchObject({ responseConstraint: lanlProposalSchema })
    expect(fetchCalls).toEqual([])
  })

  it('in the cloud, after consent: system instruction and response schema', async () => {
    await sendWithConsent(caseEngine(), 'cloud_requested', PROMPT)
    expect(fetchCalls).toHaveLength(1)
    const body = JSON.parse(fetchCalls[0].body)
    expect(JSON.stringify(body.systemInstruction)).toContain('case instruction')
    expect(body.generationConfig.responseJsonSchema).toEqual(lanlProposalSchema)
  })

  it('the built-in case keeps its own schema', async () => {
    installPromptApi()
    await investigate(engineNow(), 'on_device', PROMPT)
    expect(localCalls[0].promptOptions).toMatchObject({ responseConstraint: incidentProposalSchema })
  })
})

// What the SDK does that the design has to work around. If an SDK upgrade
// changes any of these, the tests say so.
describe('installed SDK behaviour the design depends on', () => {
  const model = (mode: InferenceMode) =>
    getGenerativeModel(ai(), { mode, inCloudParams: { model: 'gemini-3.5-flash-lite' } })

  it('PREFER_ON_DEVICE re-checks availability itself and goes to the cloud: not usable before consent', async () => {
    installPromptApi()
    availabilityAnswers = ['unavailable']
    const { response } = await model(InferenceMode.PREFER_ON_DEVICE).generateContent(PROMPT)
    expect(response.inferenceSource).toBe('in_cloud')
    expect(fetchCalls).toHaveLength(1)
  })

  it('PREFER_ON_DEVICE does not fall back when Nano fails mid-run', async () => {
    installPromptApi()
    localPrompt = async () => {
      throw new Error('boom')
    }
    await expect(model(InferenceMode.PREFER_ON_DEVICE).generateContent(PROMPT)).rejects.toThrow()
    expect(fetchCalls).toEqual([])
  })

  it('ONLY_ON_DEVICE with no Prompt API when the model is built goes to the cloud', async () => {
    const { response } = await model(InferenceMode.ONLY_ON_DEVICE).generateContent(PROMPT)
    expect(response.inferenceSource).toBe('in_cloud')
    expect(fetchCalls).toHaveLength(1)
  })

  it('ONLY_IN_CLOUD requests are not marked as hybrid; PREFER_IN_CLOUD requests are', async () => {
    await model(InferenceMode.ONLY_IN_CLOUD).generateContent(PROMPT)
    await model(InferenceMode.PREFER_IN_CLOUD).generateContent(PROMPT)
    const tags = fetchCalls.map((c) => c.headers.get('x-goog-api-client') ?? '')
    expect(tags[0]).not.toMatch(/\bhybrid\b/)
    expect(tags[1]).toMatch(/\bhybrid\b/)
  })
})

// Bounded execution (2026-11-26): the on-device attempt streams through the
// installed SDK and is stopped, with its signal reaching Chrome, when its
// output breaks down, runs too long or too slow, or the analyst stops it.
// Nothing is retried and nothing goes to the cloud without consent.
describe('installed SDK: bounded on-device attempts', () => {
  const caseEngine = (limits?: { deviceMs?: number; cloudMs?: number }) =>
    createEngine(ai(), 'case instruction', lanlProposalSchema, limits).engine
  const signalSeen = () => (localCalls[0].promptOptions as { signal?: AbortSignal }).signal

  it('a completed stream is one completed attempt, its output exactly as received', async () => {
    installPromptApi()
    localStream = () => chunksOf('{\n  "findings": [],\n', '  "explanation": "x"\n}')
    const out = await investigate(caseEngine(), 'on_device', PROMPT)
    expect(out).toMatchObject({ kind: 'done', mode: LOCAL_MODE, inferenceSource: 'on_device' })
    expect(out.attempt).toMatchObject({ outcome: 'completed', streamed: true, stopReason: null, consented: false })
    expect(out.attempt?.output).toBe('{\n  "findings": [],\n  "explanation": "x"\n}')
    expect(signalSeen()).toBeInstanceOf(AbortSignal) // the signal reaches Chrome's call
    expect(signalSeen()?.aborted).toBe(false)
    expect(fetchCalls).toEqual([])
  })

  it('a whitespace breakdown is stopped: Chrome is told to stop, nothing is sent, the output is kept', async () => {
    installPromptApi()
    localStream = endless('{"findings": [', '\n  ')
    const out = await investigate(caseEngine(), 'on_device', PROMPT)
    expect(out.kind).toBe('consent') // the existing route: ask, never send
    expect(out.attempt).toMatchObject({ outcome: 'stopped', stopReason: 'whitespace run', error: null })
    expect(out.attempt?.output?.startsWith('{"findings": [')).toBe(true)
    expect(out.attempt!.output!.length).toBeGreaterThan(200)
    expect(signalSeen()?.aborted).toBe(true)
    expect(out.kind === 'consent' && out.detail).toMatch(/stopped: its output turned into a run of more than 200 whitespace/)
    expect(fetchCalls).toEqual([])
  })

  it('output that will not end is stopped at the length limit', async () => {
    installPromptApi()
    localStream = endless('{"findings": [', '"E01", ')
    const out = await investigate(caseEngine(), 'on_device', PROMPT)
    expect(out.attempt).toMatchObject({ outcome: 'stopped', stopReason: 'output limit' })
    expect(signalSeen()?.aborted).toBe(true)
    expect(fetchCalls).toEqual([])
  })

  it('an attempt that writes nothing is stopped at the time limit', async () => {
    installPromptApi()
    localStream = (signal) =>
      new ReadableStream<string>({
        start(controller) {
          signal?.addEventListener('abort', () => controller.error(signal.reason))
        },
      })
    const out = await investigate(caseEngine({ deviceMs: 30 }), 'on_device', PROMPT)
    expect(out.attempt).toMatchObject({ outcome: 'stopped', stopReason: 'time limit', output: null })
    expect(signalSeen()?.aborted).toBe(true)
    expect(fetchCalls).toEqual([])
  })

  it("the analyst's Stop ends the run: recorded, no consent question, nothing sent", async () => {
    installPromptApi()
    const stop = new AbortController()
    localStream = (signal) => {
      setTimeout(() => stop.abort(), 5)
      return endless('{"findings": [', '"x"')(signal)
    }
    const out = await investigate(caseEngine(), 'on_device', PROMPT, { signal: stop.signal })
    expect(out.kind).toBe('ended')
    expect(out.attempt).toMatchObject({ outcome: 'stopped', stopReason: 'cancelled by analyst' })
    expect(signalSeen()?.aborted).toBe(true)
    expect(fetchCalls).toEqual([])
  })

  it("Chrome's own error mid-stream is a failed attempt, with what it had written", async () => {
    installPromptApi()
    localStream = () =>
      new ReadableStream<string>({
        start(controller) {
          controller.enqueue('{"findings": [')
          const e = new Error('The response exceeded output limits and was truncated.')
          e.name = 'QuotaExceededError'
          controller.error(e)
        },
      })
    const out = await investigate(caseEngine(), 'on_device', PROMPT)
    expect(out.kind).toBe('consent')
    expect(out.attempt).toMatchObject({ outcome: 'error', stopReason: null })
    expect(out.attempt?.error).toMatch(/QuotaExceededError/)
    expect(fetchCalls).toEqual([])
  })

  it('malformed output still completes: the verifier, not the attempt, judges it', async () => {
    installPromptApi()
    localStream = () => chunksOf('not JSON at all')
    const out = await investigate(caseEngine(), 'on_device', PROMPT)
    expect(out).toMatchObject({ kind: 'done', text: 'not JSON at all' })
    expect(out.attempt?.outcome).toBe('completed')
  })
})

describe('installed SDK: bounded cloud attempts after consent', () => {
  const caseEngine = (limits?: { deviceMs?: number; cloudMs?: number }) =>
    createEngine(ai(), 'case instruction', lanlProposalSchema, limits).engine

  it('the cloud request carries a signal; a completed answer is a completed attempt', async () => {
    const out = await sendWithConsent(caseEngine(), 'cloud_requested', PROMPT)
    expect(out).toMatchObject({ kind: 'done', inferenceSource: 'in_cloud', consented: true })
    expect(out.attempt).toMatchObject({ where: 'cloud', outcome: 'completed', streamed: false, remoteProcessing: null })
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0].signal).toBeInstanceOf(AbortSignal)
  })

  it("the analyst's Stop aborts the request, and says only that the page stopped waiting", async () => {
    cloudHangs = true
    const stop = new AbortController()
    setTimeout(() => stop.abort(), 5)
    const out = await sendWithConsent(caseEngine(), 'local_failed', PROMPT, { signal: stop.signal })
    expect(out.kind).toBe('ended')
    expect(out.attempt).toMatchObject({ outcome: 'stopped', stopReason: 'cancelled by analyst', remoteProcessing: 'unknown' })
    expect(fetchCalls[0].signal?.aborted).toBe(true)
    expect(failureOf(out.attempt)).toMatch(/This page stopped waiting; Google may already have received the request/)
    expect(failureOf(out.attempt)).not.toMatch(/cancelled at Google|was cancelled remotely/)
  })

  it('a cloud request that does not answer in time is stopped, remote processing unknown', async () => {
    cloudHangs = true
    const out = await sendWithConsent(caseEngine({ cloudMs: 30 }), 'cloud_requested', PROMPT)
    expect(out.attempt).toMatchObject({ outcome: 'stopped', stopReason: 'time limit', remoteProcessing: 'unknown' })
  })
})
