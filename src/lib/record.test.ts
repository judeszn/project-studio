import { describe, expect, it } from 'vitest'
import { RUN_RECORD_FORMAT, buildRunRecord, locationOf, recordFileName, sha256Hex } from './record'
import type { RunFacts } from './record'
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
