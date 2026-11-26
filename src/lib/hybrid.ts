import { InferenceMode, getGenerativeModel } from 'firebase/ai'
import type { AI, LanguageModelCreateOptions, LanguageModelPromptOptions } from 'firebase/ai'
import {
  AttemptStopped,
  CLOUD_TIME_LIMIT_MS,
  DEVICE_TIME_LIMIT_MS,
  STOP_EXPLANATION,
  shouldStop,
  type AttemptStep,
  type StopReason,
  type Where,
} from './attempts'
import { incidentProposalSchema } from './schema'
import type { proposalSchemaFor } from './schema'

export type ProposalSchema = ReturnType<typeof proposalSchemaFor>

// Consent-gated hybrid inference through Firebase AI Logic.
//
// Evidence leaves the device only after the analyst agrees. What the installed
// SDK (@firebase/ai 3.0.0) does, read from its code and tested in
// hybrid.test.ts against the SDK itself:
// - PREFER_ON_DEVICE checks availability again inside the SDK and calls the
//   cloud if Nano is not available at that moment. A check made by the page
//   beforehand cannot stop that, so it is used only after consent.
// - ONLY_ON_DEVICE never calls the cloud, provided the SDK built its on-device
//   adapter. It builds one only if the browser had the Prompt API
//   (`LanguageModel`) when the model was created; without one, every mode,
//   ONLY_ON_DEVICE included, goes to the cloud.
// - Only the PREFER_* modes mark a cloud request as hybrid use.
// So: the run made without consent is ONLY_ON_DEVICE and is refused when there
// is no adapter; every cloud-capable run uses a PREFER_* mode and only follows
// consent.
//
// Bounded execution (2026-11-26): the on-device attempt streams, through the
// same SDK and the same Chrome call, so that it can be stopped when its output
// breaks down (attempts.ts). The decisions above are unchanged, and nothing is
// retried.

export const CLOUD_MODEL = 'gemini-3.5-flash-lite'

// Shown before every send to the cloud (owner's decision, 2026-11-14). The
// project uses the Gemini Developer API's free tier, whose terms allow Google
// to use what is sent; see GEMINI_TERMS_URL.
export const CLOUD_DATA_TERMS =
  "This app uses the free tier of the Gemini Developer API. Under Google's terms for it, Google may use what you send to improve its products, and human reviewers may read it. Do not send sensitive, confidential or personal information: use synthetic data, such as the demo case."

export const GEMINI_TERMS_URL = 'https://ai.google.dev/gemini-api/terms'

export const LOCAL_MODE = InferenceMode.ONLY_ON_DEVICE

export function createOptionsFor(systemPrompt: string): LanguageModelCreateOptions {
  return {
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
    initialPrompts: [{ role: 'system', content: [{ type: 'text', value: systemPrompt }] }],
  }
}

// One Firebase AI Logic hybrid configuration, the same instruction and schema
// on both sides. The schema carries the finding types of the evidence source;
// GS-03's by default.
//
// `signal`, for an on-device attempt: the SDK passes promptOptions straight to
// Chrome's prompt call and takes no per-call options on the device path, so a
// model is built for each such attempt with its own signal. Nothing else in
// the configuration changes.
export function modelFor(
  ai: AI,
  mode: InferenceMode,
  systemPrompt: string,
  schema: ProposalSchema = incidentProposalSchema,
  signal?: AbortSignal,
) {
  return getGenerativeModel(ai, {
    mode,
    inCloudParams: {
      model: CLOUD_MODEL,
      systemInstruction: systemPrompt,
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
      },
    },
    onDeviceParams: {
      createOptions: createOptionsFor(systemPrompt),
      // The SDK's type for these options omits `signal`, which Chrome's prompt
      // call accepts; the SDK hands the object to Chrome unchanged
      // (ChromeAdapterImpl.generateContentStream), as hybrid-sdk.test.ts checks.
      promptOptions: (signal
        ? { responseConstraint: schema, signal }
        : { responseConstraint: schema }) as LanguageModelPromptOptions,
    },
  })
}

// One model per mode the router uses.
export function buildModels(
  ai: AI,
  systemPrompt: string,
  schema: ProposalSchema = incidentProposalSchema,
) {
  const build = (mode: InferenceMode) => modelFor(ai, mode, systemPrompt, schema)
  return {
    [InferenceMode.ONLY_ON_DEVICE]: build(InferenceMode.ONLY_ON_DEVICE),
    [InferenceMode.PREFER_ON_DEVICE]: build(InferenceMode.PREFER_ON_DEVICE),
    [InferenceMode.PREFER_IN_CLOUD]: build(InferenceMode.PREFER_IN_CLOUD),
  }
}

export type RunMode = keyof ReturnType<typeof buildModels>

export interface RunOptions {
  signal?: AbortSignal // the analyst's Stop
}

export interface RunOutput {
  text: string
  inferenceSource: string
  streamed: boolean
}

export interface Engine {
  // Whether the browser had the Prompt API when the models were built, which
  // is when the SDK decides whether to build its on-device adapter.
  onDeviceAdapter: boolean
  availability(): Promise<string>
  // Rejects with AttemptStopped when stopped on purpose; with the SDK's or
  // Chrome's own error otherwise.
  run(mode: RunMode, prompt: string, options?: RunOptions): Promise<RunOutput>
}

interface PromptApi {
  availability(options?: object): Promise<string>
}

const describe = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e))

// The on-device attempt. It streams through the SDK and is stopped, with its
// own signal so that Chrome stops generating, when the output breaks down,
// passes the length limit, or takes too long, or when the analyst stops it.
async function runOnDevice(
  ai: AI,
  systemPrompt: string,
  schema: ProposalSchema | undefined,
  prompt: string,
  options: RunOptions,
  timeLimitMs: number,
): Promise<RunOutput> {
  const controller = new AbortController()
  let reason: StopReason | null = null
  let text = ''
  let inferenceSource: string | null = null
  const stop = (why: StopReason) => {
    if (reason === null) reason = why
    controller.abort(new AttemptStopped(why, text, inferenceSource))
  }
  const timer = setTimeout(() => stop('time limit'), timeLimitMs)
  const onCancel = () => stop('cancelled by analyst')
  if (options.signal?.aborted) onCancel()
  options.signal?.addEventListener('abort', onCancel)
  try {
    const model = modelFor(ai, LOCAL_MODE, systemPrompt, schema, controller.signal)
    const { stream, response } = await model.generateContentStream(prompt)
    response.catch(() => {}) // its failure is the stream's, handled below
    for await (const chunk of stream) {
      inferenceSource ??= chunk.inferenceSource ?? null
      text += chunk.text()
      const why = shouldStop(text)
      if (why) {
        stop(why)
        break
      }
    }
    if (reason !== null) throw new AttemptStopped(reason, text, inferenceSource)
    return { text, inferenceSource: inferenceSource ?? 'not reported', streamed: true }
  } catch (e) {
    if (reason !== null) throw new AttemptStopped(reason, text, inferenceSource)
    throw Object.assign(e instanceof Error ? e : new Error(String(e)), { partialOutput: text })
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onCancel)
  }
}

// The engine the page uses. The Prompt API is read in the same call that
// builds the models, so `onDeviceAdapter` says what the SDK saw.
export function createEngine(
  ai: AI,
  systemPrompt: string,
  schema?: ProposalSchema,
  limits: { deviceMs?: number; cloudMs?: number } = {},
) {
  const promptApi = (globalThis as { LanguageModel?: PromptApi }).LanguageModel
  const models = buildModels(ai, systemPrompt, schema)
  const createOptions = createOptionsFor(systemPrompt)
  const engine: Engine = {
    onDeviceAdapter: promptApi !== undefined,
    async availability() {
      if (!promptApi) return 'no Prompt API'
      try {
        return await promptApi.availability(createOptions)
      } catch (e) {
        return `error: ${describe(e)}`
      }
    },
    async run(mode, prompt, options = {}) {
      if (mode === LOCAL_MODE) {
        return runOnDevice(ai, systemPrompt, schema, prompt, options, limits.deviceMs ?? DEVICE_TIME_LIMIT_MS)
      }
      // The cloud: the SDK aborts its request on this signal or at the
      // timeout. That stops this page waiting; whether Google stops
      // processing is not something the SDK reports.
      const timeout = limits.cloudMs ?? CLOUD_TIME_LIMIT_MS
      try {
        const { response } = await models[mode].generateContent(prompt, { signal: options.signal, timeout })
        return { text: response.text(), inferenceSource: response.inferenceSource ?? 'not reported', streamed: false }
      } catch (e) {
        if (options.signal?.aborted) throw new AttemptStopped('cancelled by analyst', '', null)
        if (e instanceof Error && /timeout|timed out|deadline/i.test(`${e.name} ${e.message}`)) {
          throw new AttemptStopped('time limit', '', null)
        }
        throw e
      }
    },
  }
  return { engine, models }
}

export type Request = 'on_device' | 'in_cloud'
export type ConsentReason = 'unavailable' | 'local_failed' | 'cloud_requested'

export interface Done {
  kind: 'done'
  mode: RunMode
  consented: boolean
  text: string
  inferenceSource: string
  latencyMs: number
  attempt: AttemptStep
}

// Nothing has been sent; the analyst is asked whether to send to the cloud.
// `attempt`: the on-device attempt that led here, if one was made.
export interface NeedsConsent {
  kind: 'consent'
  reason: ConsentReason
  detail: string
  attempt: AttemptStep | null
}

// An attempt that gave no answer and leads to no question: stopped by the
// analyst, or a cloud attempt that failed or was stopped.
export interface Ended {
  kind: 'ended'
  attempt: AttemptStep
}

export const NO_PROMPT_API =
  'This browser does not expose the Prompt API (LanguageModel), so Gemini Nano cannot run here.'

const UNAVAILABLE: Record<string, string> = {
  unavailable: 'This device or browser cannot run Gemini Nano.',
  downloadable: 'Gemini Nano is not downloaded on this device yet. Prepare it above, or use the cloud.',
  downloading: 'Gemini Nano is still downloading on this device.',
}

const where = (mode: RunMode): Where => (mode === LOCAL_MODE ? 'device' : 'cloud')

// One attempt, always described in full, whatever happened.
async function attempt(
  engine: Engine,
  mode: RunMode,
  prompt: string,
  consented: boolean,
  options: RunOptions,
): Promise<AttemptStep> {
  const startedAt = new Date().toISOString()
  const onlineAtStart = navigator.onLine
  const t0 = performance.now()
  const base = { kind: 'attempt' as const, where: where(mode), sdkMode: mode, consented, startedAt, onlineAtStart }
  const end = () => ({
    finishedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - t0),
    onlineAtEnd: navigator.onLine,
  })
  try {
    const out = await engine.run(mode, prompt, options)
    return {
      ...base,
      ...end(),
      streamed: out.streamed,
      outcome: 'completed',
      stopReason: null,
      error: null,
      inferenceSource: out.inferenceSource,
      output: out.text,
      remoteProcessing: null,
    }
  } catch (e) {
    const stopped = e instanceof AttemptStopped ? e : null
    const partial = stopped?.output ?? (e as { partialOutput?: string }).partialOutput ?? ''
    return {
      ...base,
      ...end(),
      streamed: mode === LOCAL_MODE,
      outcome: stopped ? 'stopped' : 'error',
      stopReason: stopped?.reason ?? null,
      error: stopped ? null : describe(e),
      inferenceSource: stopped?.inferenceSource ?? null,
      output: partial === '' ? null : partial,
      remoteProcessing: mode === LOCAL_MODE ? null : 'unknown',
    }
  }
}

const doneOf = (a: AttemptStep, mode: RunMode): Done => ({
  kind: 'done',
  mode,
  consented: a.consented,
  text: a.output ?? '',
  inferenceSource: a.inferenceSource ?? 'not reported',
  latencyMs: a.durationMs,
  attempt: a,
})

// What an attempt that gave no answer is called on the page.
export function failureOf(a: AttemptStep): string {
  const where = a.where === 'device' ? 'On-device inference' : 'Cloud inference'
  if (a.outcome === 'stopped' && a.stopReason) {
    const remote =
      a.remoteProcessing === 'unknown'
        ? ' This page stopped waiting; Google may already have received the request and may still process it.'
        : ''
    return `${where} stopped: ${STOP_EXPLANATION[a.stopReason]}.${remote}`
  }
  return `${where} failed. ${a.error}`
}

// Starts an investigation. Never sends evidence off the device: the only run
// it makes is LOCAL_MODE, and only when the SDK has an on-device adapter.
export async function investigate(
  engine: Engine,
  request: Request,
  prompt: string,
  options: RunOptions = {},
): Promise<Done | NeedsConsent | Ended> {
  if (request === 'in_cloud') {
    return { kind: 'consent', reason: 'cloud_requested', detail: 'You asked for the cloud model.', attempt: null }
  }
  if (!engine.onDeviceAdapter) return { kind: 'consent', reason: 'unavailable', detail: NO_PROMPT_API, attempt: null }
  const availability = await engine.availability()
  if (availability !== 'available') {
    return {
      kind: 'consent',
      reason: 'unavailable',
      detail: UNAVAILABLE[availability] ?? `Gemini Nano is not available (reported: ${availability}).`,
      attempt: null,
    }
  }
  const a = await attempt(engine, LOCAL_MODE, prompt, false, options)
  if (a.outcome === 'completed') return doneOf(a, LOCAL_MODE)
  // The analyst's Stop ends the run here: it is not a failure to offer the
  // cloud for.
  if (a.stopReason === 'cancelled by analyst') return { kind: 'ended', attempt: a }
  // Includes Nano becoming unavailable after the check above: LOCAL_MODE
  // fails rather than falling back.
  return { kind: 'consent', reason: 'local_failed', detail: failureOf(a), attempt: a }
}

// The cloud-capable mode for each reason. Unavailable: PREFER_ON_DEVICE, the
// SDK's own fallback (it still runs locally if Nano has become available).
// Otherwise PREFER_IN_CLOUD, since Nano is present and PREFER_ON_DEVICE would
// run it again.
export const cloudModeFor = (reason: ConsentReason): RunMode =>
  reason === 'unavailable' ? InferenceMode.PREFER_ON_DEVICE : InferenceMode.PREFER_IN_CLOUD

// Call only from the analyst's explicit consent.
export async function sendWithConsent(
  engine: Engine,
  reason: ConsentReason,
  prompt: string,
  options: RunOptions = {},
): Promise<Done | Ended> {
  const mode = cloudModeFor(reason)
  const a = await attempt(engine, mode, prompt, true, options)
  return a.outcome === 'completed' ? doneOf(a, mode) : { kind: 'ended', attempt: a }
}
