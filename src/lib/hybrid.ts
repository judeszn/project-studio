import { InferenceMode, getGenerativeModel } from 'firebase/ai'
import type { AI, LanguageModelCreateOptions } from 'firebase/ai'
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

export const CLOUD_MODEL = 'gemini-3.5-flash-lite'

export const LOCAL_MODE = InferenceMode.ONLY_ON_DEVICE

export function createOptionsFor(systemPrompt: string): LanguageModelCreateOptions {
  return {
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
    initialPrompts: [{ role: 'system', content: [{ type: 'text', value: systemPrompt }] }],
  }
}

// One Firebase AI Logic hybrid configuration, the same instruction and schema
// on both sides, built once per mode the router uses. The schema carries the
// finding types of the evidence source; GS-03's by default.
export function buildModels(
  ai: AI,
  systemPrompt: string,
  schema: ProposalSchema = incidentProposalSchema,
) {
  const modelFor = (mode: InferenceMode) =>
    getGenerativeModel(ai, {
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
        promptOptions: { responseConstraint: schema },
      },
    })
  return {
    [InferenceMode.ONLY_ON_DEVICE]: modelFor(InferenceMode.ONLY_ON_DEVICE),
    [InferenceMode.PREFER_ON_DEVICE]: modelFor(InferenceMode.PREFER_ON_DEVICE),
    [InferenceMode.PREFER_IN_CLOUD]: modelFor(InferenceMode.PREFER_IN_CLOUD),
  }
}

export type RunMode = keyof ReturnType<typeof buildModels>

export interface Engine {
  // Whether the browser had the Prompt API when the models were built, which
  // is when the SDK decides whether to build its on-device adapter.
  onDeviceAdapter: boolean
  availability(): Promise<string>
  run(mode: RunMode, prompt: string): Promise<{ text: string; inferenceSource: string }>
}

interface PromptApi {
  availability(options?: object): Promise<string>
}

// The engine the page uses. The Prompt API is read in the same call that
// builds the models, so `onDeviceAdapter` says what the SDK saw.
export function createEngine(ai: AI, systemPrompt: string, schema?: ProposalSchema) {
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
    async run(mode, prompt) {
      const { response } = await models[mode].generateContent(prompt)
      return { text: response.text(), inferenceSource: response.inferenceSource ?? 'not reported' }
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
}

// Nothing has been sent; the analyst is asked whether to send to the cloud.
export interface NeedsConsent {
  kind: 'consent'
  reason: ConsentReason
  detail: string
}

export const NO_PROMPT_API =
  'This browser does not expose the Prompt API (LanguageModel), so Gemini Nano cannot run here.'

const UNAVAILABLE: Record<string, string> = {
  unavailable: 'This device or browser cannot run Gemini Nano.',
  downloadable: 'Gemini Nano is not downloaded on this device yet. Prepare it above, or use the cloud.',
  downloading: 'Gemini Nano is still downloading on this device.',
}

async function timed(engine: Engine, mode: RunMode, prompt: string, consented: boolean): Promise<Done> {
  const started = performance.now()
  const { text, inferenceSource } = await engine.run(mode, prompt)
  return {
    kind: 'done',
    mode,
    consented,
    text,
    inferenceSource,
    latencyMs: Math.round(performance.now() - started),
  }
}

const describe = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e))

// Starts an investigation. Never sends evidence off the device: the only run
// it makes is LOCAL_MODE, and only when the SDK has an on-device adapter.
export async function investigate(
  engine: Engine,
  request: Request,
  prompt: string,
): Promise<Done | NeedsConsent> {
  if (request === 'in_cloud') {
    return { kind: 'consent', reason: 'cloud_requested', detail: 'You asked for the cloud model.' }
  }
  if (!engine.onDeviceAdapter) return { kind: 'consent', reason: 'unavailable', detail: NO_PROMPT_API }
  const availability = await engine.availability()
  if (availability !== 'available') {
    return {
      kind: 'consent',
      reason: 'unavailable',
      detail: UNAVAILABLE[availability] ?? `Gemini Nano is not available (reported: ${availability}).`,
    }
  }
  try {
    return await timed(engine, LOCAL_MODE, prompt, false)
  } catch (e) {
    // Includes Nano becoming unavailable after the check above: LOCAL_MODE
    // fails rather than falling back.
    return { kind: 'consent', reason: 'local_failed', detail: `On-device inference failed. ${describe(e)}` }
  }
}

// The cloud-capable mode for each reason. Unavailable: PREFER_ON_DEVICE, the
// SDK's own fallback (it still runs locally if Nano has become available).
// Otherwise PREFER_IN_CLOUD, since Nano is present and PREFER_ON_DEVICE would
// run it again.
export const cloudModeFor = (reason: ConsentReason): RunMode =>
  reason === 'unavailable' ? InferenceMode.PREFER_ON_DEVICE : InferenceMode.PREFER_IN_CLOUD

// Call only from the analyst's explicit consent.
export function sendWithConsent(engine: Engine, reason: ConsentReason, prompt: string): Promise<Done> {
  return timed(engine, cloudModeFor(reason), prompt, true)
}
