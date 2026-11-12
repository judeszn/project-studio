import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import { GoogleAIBackend, InferenceMode, getAI, getGenerativeModel } from 'firebase/ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_MODE, createEngine, investigate, sendWithConsent } from './hybrid'
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
let fetchCalls: { url: string; headers: Headers; body: string }[]
let localCalls: { createOptions: unknown; promptOptions: unknown }[]
let availabilityAnswers: string[]
let localPrompt: () => Promise<string>

function installPromptApi() {
  vi.stubGlobal('LanguageModel', {
    availability: vi.fn(async () => availabilityAnswers.shift() ?? 'available'),
    create: vi.fn(async (createOptions: unknown) => ({
      prompt: (_input: unknown, promptOptions: unknown) => {
        localCalls.push({ createOptions, promptOptions })
        return localPrompt()
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
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      fetchCalls.push({ url: String(url), headers: new Headers(init.headers), body: String(init.body) })
      const body = { candidates: [{ content: { role: 'model', parts: [{ text: CLOUD_TEXT }] }, finishReason: 'STOP' }] }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }),
  )
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await deleteApp(app)
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
    localPrompt = async () => {
      throw new DOMException('input too large', 'QuotaExceededError')
    }
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
