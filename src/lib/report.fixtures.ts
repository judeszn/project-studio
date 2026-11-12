import type { Provenance } from './casefile'
import { buildRunRecord } from './record'
import type { RunFacts } from './record'
import { buildReport } from './report'
import type { FindingType, LogEvent } from './schema'
import { verifyProposal } from './verify'

// Synthetic authentication events, shaped like a case file's. The proposals
// below repeat, on these events, each kind of failure the first on-device LANL
// run produced: an invented event ID, a time not in the cited events, a
// successful logon cited as denied, and findings of type "other".

export const event = (id: string, actor: string, target: string, outcome: 'success' | 'denied', time: string): LogEvent => ({
  id,
  date: 'Day 1',
  time: `elapsed ${time}`,
  source: 'identity',
  actor,
  action: 'network logon',
  target,
  outcome,
  logonType: 'Network',
  detail: `Day 1 · elapsed ${time}. Source user ${actor}; destination computer ${target}; result ${outcome === 'success' ? 'Success' : 'Fail'}.`,
})

export const EVENTS: LogEvent[] = [
  event('E01', 'U900001@SYN', 'C900001', 'denied', '10:00:01'),
  event('E02', 'U900002@SYN', 'C900002', 'success', '10:05:00'),
  event('E03', 'U900002@SYN', 'C900003', 'success', '10:06:00'),
  event('E04', 'U900003@SYN', 'C900004', 'denied', '10:07:00'),
  event('E05', 'U900004@SYN', 'C900005', 'success', '10:08:00'),
]

export const PROVENANCE: Record<string, Provenance> = Object.fromEntries(
  EVENTS.map((e, i) => [e.id, { file: 'SYNTHETIC-auth.txt', line: i + 1, raw: `${100 + i},${e.actor},${e.target}` }]),
)

export const TYPES: readonly FindingType[] = ['logon', 'denied_logon', 'other', 'sign_in_from_unrecognised_device']

export const finding = (type: string, claim: string, event_ids: string[]) => ({ type, claim, event_ids })

export const output = (findings: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    findings,
    explanation: 'Two accounts were refused logons and one logged on.',
    classification: 'Undetermined',
    confidence: 'Low',
    recommended_actions: ['Ask the owner of U900002 whether the logons were theirs.'],
    ...extra,
  })

export const MIXED = output([
  finding('denied_logon', 'U900001@SYN was refused a logon to C900001.', ['E01']),
  finding('other', 'U900003@SYN was refused again later (E48).', ['E04', 'E48']),
  finding('logon', 'U900002@SYN logged on to C900002 at 23:59.', ['E02']),
  finding('denied_logon', 'U900002@SYN was refused a logon to C900003.', ['E03']),
  finding('other', 'U900003@SYN was refused a logon to C900004.', ['E04']),
])

export async function recordFor(raw: string, over: Partial<RunFacts> = {}, events = EVENTS) {
  return buildRunRecord({
    case: {
      id: 'synthetic-sample',
      origin: 'case file',
      fileName: 'synthetic-sample.json',
      sha256: 'a'.repeat(64),
      events: events.length,
      source: { dataset: 'SYNTHETIC test fixture', citation: 'Project Studio', file: 'SYNTHETIC-auth.txt' },
    },
    systemPrompt: 'system',
    prompt: 'user',
    findingTypes: TYPES,
    requested: 'on_device',
    cloudAllowed: false,
    startedAt: '2026-11-13T09:00:00.000Z',
    finishedAt: '2026-11-13T09:00:40.000Z',
    onlineAtStart: true,
    onlineAtEnd: true,
    nanoAvailability: 'available',
    userAgent: 'test',
    onDeviceParams: null,
    cloudModel: 'cloud-model',
    result: { text: raw, inferenceSource: 'on_device', sdkMode: 'only_on_device', consented: false, latencyMs: 40000 },
    verification: verifyProposal(raw, events, TYPES),
    ...over,
  })
}

export const reportOf = async (raw: string, events = EVENTS) =>
  buildReport(await recordFor(raw, {}, events), events, PROVENANCE)
