import { describe, expect, it } from 'vitest'
import type { AttemptStep, ConsentStep } from './attempts'
import {
  RUN_RECORD_FORMAT,
  RUN_RECORD_FORMAT_V1,
  buildRunRecord,
  isRunRecord,
  locationOf,
  recordFileName,
  sha256Hex,
  stepsOf,
} from './record'
import type { RecordedAttempt, RunFacts, RunRecordV1 } from './record'
import { LANL_FINDING_TYPES } from './schema'
import { verifyProposal } from './verify'

const facts = (over: Partial<RunFacts> = {}): RunFacts => ({
  case: {
    id: 'lanl-c17693-h211',
    origin: 'case file',
    fileName: 'lanl-c17693-h211.json',
    sha256: 'f'.repeat(64),
    events: 43,
    source: { dataset: 'A dataset', citation: 'A citation', file: 'auth.txt.gz' },
  },
  systemPrompt: 'system',
  prompt: 'user',
  findingTypes: LANL_FINDING_TYPES,
  requested: 'on_device',
  cloudAllowed: false,
  startedAt: '2026-11-12T22:15:30.123Z',
  finishedAt: '2026-11-12T22:16:10.000Z',
  onlineAtStart: true,
  onlineAtEnd: true,
  nanoAvailability: 'available',
  userAgent: 'test agent',
  onDeviceParams: { defaultTopK: 3 },
  cloudModel: 'cloud-model',
  result: { text: '{"raw":true}', inferenceSource: 'on_device', sdkMode: 'only_on_device', consented: false, latencyMs: 4000 },
  verification: verifyProposal('{"raw":true}', [], LANL_FINDING_TYPES),
  ...over,
})

describe('sha256Hex', () => {
  it('hashes text as UTF-8, and bytes as given', async () => {
    const abc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    expect(await sha256Hex('abc')).toBe(abc)
    expect(await sha256Hex(new TextEncoder().encode('abc').buffer as ArrayBuffer)).toBe(abc)
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})

describe('locationOf', () => {
  it("puts the SDK's report in the record's words", () => {
    expect(locationOf('on_device')).toBe('on-device')
    expect(locationOf('in_cloud')).toBe('cloud')
    expect(locationOf('not reported')).toBe('not reported')
    expect(locationOf(null)).toBe('none')
  })
})

describe('buildRunRecord', () => {
  it('a completed on-device run: case hash, prompts and their hashes, raw output, location, latency, checks', async () => {
    const f = facts()
    const record = await buildRunRecord(f)
    expect(record.format).toBe(RUN_RECORD_FORMAT)
    expect(record.case).toEqual(f.case)
    expect(record.prompt).toEqual({
      system: 'system',
      systemSha256: await sha256Hex('system'),
      user: 'user',
      userSha256: await sha256Hex('user'),
      findingTypes: LANL_FINDING_TYPES,
    })
    expect(record.execution).toMatchObject({
      outcome: 'completed',
      location: 'on-device',
      model: 'Gemini Nano (Chrome built-in)',
      inferenceSource: 'on_device',
      sdkMode: 'only_on_device',
      requested: 'on_device',
      cloudAllowed: false,
      consentToSendToCloud: false,
      latencyMs: 4000,
      error: null,
    })
    expect(record.output.raw).toBe('{"raw":true}')
    expect(record.verification).toEqual(f.verification)
    expect(record.environment).toEqual({
      userAgent: 'test agent',
      nanoAvailability: 'available',
      onDeviceParams: { defaultTopK: 3 },
      cloudModel: 'cloud-model',
    })
  })

  it('a cloud run names the cloud model and the consent', async () => {
    const record = await buildRunRecord(
      facts({
        cloudAllowed: true,
        result: { text: '{}', inferenceSource: 'in_cloud', sdkMode: 'prefer_in_cloud', consented: true, latencyMs: 900 },
      }),
    )
    expect(record.execution).toMatchObject({
      location: 'cloud',
      model: 'cloud-model',
      cloudAllowed: true,
      consentToSendToCloud: true,
    })
  })

  it('never calls an unreported source on-device', async () => {
    const record = await buildRunRecord(
      facts({ result: { text: '{}', inferenceSource: 'not reported', sdkMode: 'only_on_device', consented: false, latencyMs: 1 } }),
    )
    expect(record.execution).toMatchObject({ location: 'not reported', model: null })
  })

  it('a failed run: the error, no output, no model, no location, no consent', async () => {
    const record = await buildRunRecord(
      facts({ result: { error: 'Nothing was sent to the cloud. On-device inference failed.' }, verification: null }),
    )
    expect(record.execution).toMatchObject({
      outcome: 'failed',
      location: 'none',
      model: null,
      inferenceSource: null,
      sdkMode: null,
      consentToSendToCloud: false,
      latencyMs: null,
      error: 'Nothing was sent to the cloud. On-device inference failed.',
    })
    expect(record.output.raw).toBeNull()
    expect(record.verification).toBeNull()
    expect(record.prompt.systemSha256).toBe(await sha256Hex('system'))
    expect(record.case.sha256).toBe('f'.repeat(64))
  })

  it('survives JSON: what is downloaded is what was built', async () => {
    const record = await buildRunRecord(facts())
    expect(JSON.parse(JSON.stringify(record))).toEqual(record)
  })
})

describe('recordFileName', () => {
  it('names the case, where it ran and when it started', async () => {
    expect(recordFileName(await buildRunRecord(facts()))).toBe(
      'lanl-c17693-h211.on-device.20261112T221530Z.run.json',
    )
  })

  it('says "failed" for a run with no answer, and keeps unsafe characters out', async () => {
    const record = await buildRunRecord(
      facts({ case: { ...facts().case, id: 'a case/../x' }, result: { error: 'x' }, verification: null }),
    )
    expect(recordFileName(record)).toBe('a_case_.._x.failed.20261112T221530Z.run.json')
  })
})

// Version 2 (2026-11-26): every attempt and every consent decision, with each
// attempt's output exactly as received; version 1 records still read.
describe('run record version 2', () => {
  const attempt = (over: Partial<AttemptStep> = {}): AttemptStep => ({
    kind: 'attempt',
    where: 'device',
    sdkMode: 'only_on_device',
    streamed: true,
    consented: false,
    startedAt: '2026-11-26T10:00:00.000Z',
    finishedAt: '2026-11-26T10:00:09.300Z',
    durationMs: 9300,
    onlineAtStart: true,
    onlineAtEnd: true,
    outcome: 'stopped',
    stopReason: 'whitespace run',
    error: null,
    inferenceSource: 'on_device',
    output: '{"findings": [' + '\n  '.repeat(80),
    remoteProcessing: null,
    ...over,
  })
  const consent = (decision: 'granted' | 'declined'): ConsentStep => ({
    kind: 'consent',
    reason: 'local_failed',
    detail: 'On-device inference stopped: its output turned into a run of more than 200 whitespace characters.',
    askedAt: '2026-11-26T10:00:09.400Z',
    decision,
    decidedAt: '2026-11-26T10:00:15.000Z',
  })

  it('keeps every step in order, each attempt with its exact output, length and SHA-256', async () => {
    const stopped = attempt()
    const cloud = attempt({
      where: 'cloud',
      sdkMode: 'prefer_in_cloud',
      streamed: false,
      consented: true,
      outcome: 'completed',
      stopReason: null,
      inferenceSource: 'in_cloud',
      output: '{"raw":true}',
    })
    const r = await buildRunRecord(
      facts({
        requested: 'on_device',
        cloudAllowed: true,
        result: { text: '{"raw":true}', inferenceSource: 'in_cloud', sdkMode: 'prefer_in_cloud', consented: true, latencyMs: 3000 },
        steps: [stopped, consent('granted'), cloud],
      }),
    )
    expect(r.format).toBe('project-studio.run-record/2')
    expect(r.steps.map((s) => s.kind)).toEqual(['attempt', 'consent', 'attempt'])
    const first = r.steps[0] as RecordedAttempt
    expect(first.output).toBe(stopped.output) // exactly as received, whitespace and all
    expect(first.outputChars).toBe(stopped.output!.length)
    expect(first.outputSha256).toBe(await sha256Hex(stopped.output!))
    expect(r.steps[1]).toMatchObject({ kind: 'consent', decision: 'granted' })
    // The verified answer is the record's output, as in version 1.
    expect(r.output.raw).toBe('{"raw":true}')
    expect(r.execution).toMatchObject({ outcome: 'completed', location: 'cloud', consentToSendToCloud: true })
  })

  it('a declined run has a record: nothing sent, the decision and the attempt before it kept', async () => {
    const r = await buildRunRecord(
      facts({ result: { error: 'Nothing was sent.' }, verification: null, ended: 'declined', steps: [attempt(), consent('declined')] }),
    )
    expect(r.execution).toMatchObject({ outcome: 'declined', location: 'none', consentToSendToCloud: false })
    expect(r.output.raw).toBeNull()
    expect(r.steps[1]).toMatchObject({ kind: 'consent', decision: 'declined' })
    expect(recordFileName(r)).toBe('lanl-c17693-h211.declined.20261112T221530Z.run.json')
  })

  it('a run the analyst stopped is recorded as cancelled, with the partial output', async () => {
    const stopped = attempt({ stopReason: 'cancelled by analyst', output: '{"findings": [{"type": "logon"' })
    const r = await buildRunRecord(
      facts({ result: { error: 'stopped' }, verification: null, ended: 'cancelled', steps: [stopped] }),
    )
    expect(r.execution.outcome).toBe('cancelled')
    expect(r.steps[0]).toMatchObject({ outcome: 'stopped', stopReason: 'cancelled by analyst', output: stopped.output })
    expect(recordFileName(r)).toBe('lanl-c17693-h211.cancelled.20261112T221530Z.run.json')
  })

  it('a failed attempt keeps its error; one with no output says so', async () => {
    const failed = attempt({ outcome: 'error', stopReason: null, error: 'QuotaExceededError: truncated', output: null })
    const r = await buildRunRecord(facts({ result: { error: 'failed' }, verification: null, steps: [failed] }))
    expect(r.steps[0]).toMatchObject({ error: 'QuotaExceededError: truncated', output: null, outputChars: 0, outputSha256: null })
  })

  it('facts given without steps get the one attempt their result describes', async () => {
    const r = await buildRunRecord(facts())
    expect(r.steps).toHaveLength(1)
    expect(r.steps[0]).toMatchObject({ kind: 'attempt', where: 'device', outcome: 'completed', output: '{"raw":true}', durationMs: 4000 })
  })

  it('reads version 1 records: the format is accepted and their one attempt is described from them', async () => {
    const v2 = await buildRunRecord(facts())
    const copy: Record<string, unknown> = { ...v2, format: RUN_RECORD_FORMAT_V1 }
    delete copy.steps
    const v1 = copy as unknown as RunRecordV1
    expect(isRunRecord(v1)).toBe(true)
    expect(isRunRecord(v2)).toBe(true)
    expect(isRunRecord({ format: 'something-else/1' })).toBe(false)
    expect(isRunRecord(null)).toBe(false)
    const steps = stepsOf(v1)
    expect(steps).toHaveLength(1)
    expect(steps[0]).toMatchObject({ kind: 'attempt', outcome: 'completed', output: '{"raw":true}', fromVersion1: true })
    expect(recordFileName(v1)).toBe('lanl-c17693-h211.on-device.20261112T221530Z.run.json')
  })
})
