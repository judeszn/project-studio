import type { AttemptStep, ConsentStep, Step } from './attempts'
import type { CaseSource } from './casefile'
import type { Verification } from './verify'

// The record of one run, for the analyst to keep: enough to say what was
// asked, of which evidence, where it ran, what came back and what the checks
// made of it. It is built in the page and saved by the browser as a download;
// nothing here sends it anywhere. It holds the evidence (inside the prompt),
// so it is as sensitive as the case.
//
// Version 2 (2026-11-26) keeps every field of version 1 with the same
// meaning, and adds `steps`: every inference attempt (completed, stopped or
// failed, with all the output it received) and every consent question with
// the analyst's answer. A run that ends without an answer, declined or
// stopped, has a record too. Version 1 records stay readable (stepsOf).

export const RUN_RECORD_FORMAT = 'project-studio.run-record/2'
export const RUN_RECORD_FORMAT_V1 = 'project-studio.run-record/1'
export const RUN_RECORD_FORMATS: readonly string[] = [RUN_RECORD_FORMAT_V1, RUN_RECORD_FORMAT]

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
    origin: 'case file' | 'built-in' | 'demo' // built-in and demo cases are synthetic
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
  // How a run without text ended, when it was not simply a failure.
  ended?: 'declined' | 'cancelled'
  verification: Verification | null
  // Every step of the run. Left out, the run is taken to be the one attempt
  // its result describes (a record built outside the page, or a test).
  steps?: Step[]
}

// An attempt as recorded: its output exactly as received, with its length and
// hash so the record can be checked independently.
export interface RecordedAttempt extends AttemptStep {
  outputChars: number
  outputSha256: string | null
}
export type RecordedStep = RecordedAttempt | ConsentStep

export type RunOutcome = 'completed' | 'failed' | 'declined' | 'cancelled'

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
    outcome: RunOutcome
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
  output: { raw: string | null } // the answer that was verified
  verification: Verification | null
  steps: RecordedStep[]
}

// A version 1 record, as written before 2026-11-26: no steps, and an outcome
// of completed or failed only.
export type RunRecordV1 = Omit<RunRecord, 'format' | 'steps' | 'execution'> & {
  format: typeof RUN_RECORD_FORMAT_V1
  execution: Omit<RunRecord['execution'], 'outcome'> & { outcome: 'completed' | 'failed' }
}

export type AnyRunRecord = RunRecord | RunRecordV1

export const isRunRecord = (value: unknown): value is AnyRunRecord =>
  typeof value === 'object' &&
  value !== null &&
  RUN_RECORD_FORMATS.includes((value as { format?: unknown }).format as string)

// The steps of any record. A version 1 record held one attempt and no steps;
// it is described from its execution fields, marked as such, and its output
// is the record's own.
export function stepsOf(record: AnyRunRecord): (RecordedStep & { fromVersion1?: true })[] {
  if (record.format === RUN_RECORD_FORMAT) return record.steps
  const e = record.execution
  const raw = record.output.raw
  return [
    {
      kind: 'attempt',
      where: e.location === 'cloud' ? 'cloud' : 'device',
      sdkMode: e.sdkMode ?? 'not recorded',
      streamed: false,
      consented: e.consentToSendToCloud,
      startedAt: e.startedAt,
      finishedAt: e.finishedAt,
      durationMs: e.latencyMs ?? 0,
      onlineAtStart: e.onlineAtStart,
      onlineAtEnd: e.onlineAtEnd,
      outcome: e.outcome === 'completed' ? 'completed' : 'error',
      stopReason: null,
      error: e.error,
      inferenceSource: e.inferenceSource,
      output: raw,
      remoteProcessing: null,
      outputChars: raw?.length ?? 0,
      outputSha256: null,
      fromVersion1: true,
    },
  ]
}

async function recordStep(step: Step): Promise<RecordedStep> {
  if (step.kind === 'consent') return { ...step }
  return {
    ...step,
    outputChars: step.output?.length ?? 0,
    outputSha256: step.output === null ? null : await sha256Hex(step.output),
  }
}

// The single attempt a run's result describes, for facts given without steps.
function attemptFromResult(facts: RunFacts): AttemptStep {
  const ran = 'text' in facts.result ? facts.result : null
  const startedMs = Date.parse(facts.startedAt)
  const finishedMs = Date.parse(facts.finishedAt)
  return {
    kind: 'attempt',
    where: ran ? (ran.sdkMode === 'only_on_device' || ran.inferenceSource === 'on_device' ? 'device' : 'cloud') : facts.requested === 'on_device' ? 'device' : 'cloud',
    sdkMode: ran?.sdkMode ?? 'not recorded',
    streamed: false,
    consented: ran?.consented ?? false,
    startedAt: facts.startedAt,
    finishedAt: facts.finishedAt,
    durationMs: ran?.latencyMs ?? (Number.isNaN(finishedMs - startedMs) ? 0 : finishedMs - startedMs),
    onlineAtStart: facts.onlineAtStart,
    onlineAtEnd: facts.onlineAtEnd,
    outcome: ran ? 'completed' : 'error',
    stopReason: null,
    error: 'error' in facts.result ? facts.result.error : null,
    inferenceSource: ran?.inferenceSource ?? null,
    output: ran?.text ?? null,
    remoteProcessing: null,
  }
}

export async function buildRunRecord(facts: RunFacts): Promise<RunRecord> {
  const ran = 'text' in facts.result ? facts.result : null
  const location = locationOf(ran?.inferenceSource ?? null)
  const steps = facts.steps ?? [attemptFromResult(facts)]
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
      outcome: ran ? 'completed' : (facts.ended ?? 'failed'),
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
    steps: await Promise.all(steps.map(recordStep)),
  }
}

// "lanl-c17693-h211.on-device.20261112T221530Z.run.json"; a run without an
// answer is named by how it ended ("failed", "declined", "cancelled").
export const recordFileName = (record: AnyRunRecord) =>
  [
    record.case.id.replace(/[^\w.-]+/g, '_'),
    record.execution.outcome === 'completed' ? record.execution.location : record.execution.outcome,
    record.execution.startedAt.replace(/[-:]|\.\d+/g, ''),
    'run.json',
  ].join('.')
