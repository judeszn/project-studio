import type { CaseSource } from './casefile'
import type { Verification } from './verify'

// The record of one run, for the analyst to keep: enough to say what was
// asked, of which evidence, where it ran, what came back and what the checks
// made of it. It is built in the page and saved by the browser as a download;
// nothing here sends it anywhere. It holds the evidence (inside the prompt),
// so it is as sensitive as the case.

export const RUN_RECORD_FORMAT = 'project-studio.run-record/1'

export async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// The browser's defaults for its built-in model (the page sets no sampling
// parameters, so these are what a run used), where the browser reports them.
export async function readOnDeviceParams(): Promise<unknown> {
  type Params = Record<'defaultTopK' | 'maxTopK' | 'defaultTemperature' | 'maxTemperature', unknown>
  const api = (globalThis as { LanguageModel?: { params?: () => Promise<Params | null> } }).LanguageModel
  try {
    const p = await api?.params?.()
    if (!p) return null
    return {
      defaultTopK: p.defaultTopK,
      maxTopK: p.maxTopK,
      defaultTemperature: p.defaultTemperature,
      maxTemperature: p.maxTemperature,
    }
  } catch {
    return null
  }
}

// Where the answer came from, in the record's words. The SDK's report is kept
// beside it, as given.
export type Location = 'on-device' | 'cloud' | 'none' | 'not reported'

export const locationOf = (inferenceSource: string | null): Location =>
  inferenceSource === null
    ? 'none'
    : inferenceSource === 'on_device'
      ? 'on-device'
      : inferenceSource === 'in_cloud'
        ? 'cloud'
        : 'not reported'

export interface RunFacts {
  case: {
    id: string
    origin: 'case file' | 'built-in'
    fileName: string | null
    sha256: string // of the file's bytes; for the built-in case, of its events as JSON
    events: number
    source: CaseSource | null
  }
  systemPrompt: string
  prompt: string
  findingTypes: readonly string[]
  requested: 'on_device' | 'in_cloud'
  cloudAllowed: boolean // false: the case could run on this device or not at all
  startedAt: string
  finishedAt: string
  onlineAtStart: boolean
  onlineAtEnd: boolean
  nanoAvailability: string
  userAgent: string
  onDeviceParams: unknown // the browser's defaults for its built-in model, if it reports them
  cloudModel: string
  // A run that returned text, or the reason there is none.
  result:
    | { text: string; inferenceSource: string; sdkMode: string; consented: boolean; latencyMs: number }
    | { error: string }
  verification: Verification | null
}

export interface RunRecord {
  format: typeof RUN_RECORD_FORMAT
  case: RunFacts['case']
  prompt: {
    system: string
    systemSha256: string
    user: string
    userSha256: string
    findingTypes: readonly string[]
  }
  execution: {
    outcome: 'completed' | 'failed'
    location: Location
    model: string | null
    inferenceSource: string | null // as the Firebase AI Logic SDK reported it
    sdkMode: string | null
    requested: RunFacts['requested']
    cloudAllowed: boolean
    consentToSendToCloud: boolean // without it, nothing is sent
    latencyMs: number | null
    startedAt: string
    finishedAt: string
    onlineAtStart: boolean
    onlineAtEnd: boolean
    error: string | null
  }
  environment: { userAgent: string; nanoAvailability: string; onDeviceParams: unknown; cloudModel: string }
  output: { raw: string | null }
  verification: Verification | null
}

export async function buildRunRecord(facts: RunFacts): Promise<RunRecord> {
  const ran = 'text' in facts.result ? facts.result : null
  const location = locationOf(ran?.inferenceSource ?? null)
  return {
    format: RUN_RECORD_FORMAT,
    case: facts.case,
    prompt: {
      system: facts.systemPrompt,
      systemSha256: await sha256Hex(facts.systemPrompt),
      user: facts.prompt,
      userSha256: await sha256Hex(facts.prompt),
      findingTypes: facts.findingTypes,
    },
    execution: {
      outcome: ran ? 'completed' : 'failed',
      location,
      model: location === 'on-device' ? 'Gemini Nano (Chrome built-in)' : location === 'cloud' ? facts.cloudModel : null,
      inferenceSource: ran?.inferenceSource ?? null,
      sdkMode: ran?.sdkMode ?? null,
      requested: facts.requested,
      cloudAllowed: facts.cloudAllowed,
      consentToSendToCloud: ran?.consented ?? false,
      latencyMs: ran?.latencyMs ?? null,
      startedAt: facts.startedAt,
      finishedAt: facts.finishedAt,
      onlineAtStart: facts.onlineAtStart,
      onlineAtEnd: facts.onlineAtEnd,
      error: 'error' in facts.result ? facts.result.error : null,
    },
    environment: {
      userAgent: facts.userAgent,
      nanoAvailability: facts.nanoAvailability,
      onDeviceParams: facts.onDeviceParams,
      cloudModel: facts.cloudModel,
    },
    output: { raw: ran?.text ?? null },
    verification: facts.verification,
  }
}

// "lanl-c17693-h211.on-device.20261112T221530Z.run.json"
export const recordFileName = (record: RunRecord) =>
  [
    record.case.id.replace(/[^\w.-]+/g, '_'),
    record.execution.outcome === 'failed' ? 'failed' : record.execution.location,
    record.execution.startedAt.replace(/[-:]|\.\d+/g, ''),
    'run.json',
  ].join('.')
