import { authSystemPrompt, buildPrompt } from '../../src/lib/prompts'
import { RUN_RECORD_FORMAT, sha256Hex, type RunRecord } from '../../src/lib/record'
import { LANL_FINDING_TYPES, type Classification, type Confidence } from '../../src/lib/schema'
import { verifyProposal } from '../../src/lib/verify'
import { parseAuthLine } from './auth'
import type { CaseFile } from './case'
import { matchedUser, matches, type MatchRule, type RedteamRecord, type UserField } from './redteam'

// Compares a model's proposal for a case with the red-team labels, after the
// fact. Labels are read here and in labelCase only; they never reach the case
// file, the prompt or the page.

export interface CaseTruth {
  caseId: string
  rule: MatchRule
  redteamFile: string
  // Case event IDs that match a red-team line, with each line they match and
  // which auth user field matched it.
  labelled: { id: string; matches: { redteamLine: number; user: UserField }[] }[]
}

// Labels a built case. The auth record is re-read from the preserved raw
// line, not from the evidence row, so a conversion mistake cannot hide a match.
export function labelCase(
  caseFile: CaseFile,
  redteam: RedteamRecord[],
  rule: MatchRule,
  redteamFile: string,
): CaseTruth {
  const labelled: CaseTruth['labelled'] = []
  for (const { evidence, provenance } of caseFile.events) {
    const parsed = parseAuthLine(provenance.raw, provenance.file, provenance.line)
    if (!parsed.ok) throw new Error(`${evidence.id}: preserved record does not parse: ${parsed.error}`)
    const found = redteam
      .filter((red) => matches(rule, red, parsed.record))
      .map((red) => ({ redteamLine: red.line, user: matchedUser(red, parsed.record)! }))
    if (found.length > 0) labelled.push({ id: evidence.id, matches: found })
  }
  return { caseId: caseFile.spec.id, rule, redteamFile, labelled }
}

export interface Evaluation {
  caseId: string
  rule: MatchRule
  parsed: boolean
  parseErrors: string[]
  // As the model gave them. LANL has no incident class to score them against.
  classification: Classification | null
  confidence: Confidence | null
  findings: number
  passing: number
  events: number
  labelled: string[]
  covered: string[] // cited by findings that pass every check
  coveredLabelled: string[]
  coveredUnlabelled: string[]
  labelledNotCovered: string[]
  citedLabelled: string[] // cited by any finding, passing or not
}

export function evaluate(caseFile: CaseFile, truth: CaseTruth, raw: string): Evaluation {
  if (truth.caseId !== caseFile.spec.id) {
    throw new Error(`truth is for case ${truth.caseId}, not ${caseFile.spec.id}`)
  }
  const events = caseFile.events.map((e) => e.evidence)
  const ids = new Set(events.map((e) => e.id))
  const labelled = truth.labelled.map((l) => l.id)
  const unknown = labelled.filter((id) => !ids.has(id))
  if (unknown.length > 0) throw new Error(`truth labels events not in the case: ${unknown.join(', ')}`)

  const v = verifyProposal(raw, events, LANL_FINDING_TYPES)
  const isLabelled = (id: string) => labelled.includes(id)
  const base = { caseId: truth.caseId, rule: truth.rule, events: events.length, labelled }
  if (!v.parse.ok) {
    return {
      ...base,
      parsed: false,
      parseErrors: v.parse.errors,
      classification: null,
      confidence: null,
      findings: 0,
      passing: 0,
      covered: [],
      coveredLabelled: [],
      coveredUnlabelled: [],
      labelledNotCovered: labelled,
      citedLabelled: [],
    }
  }
  const { proposal } = v.parse
  const cited = new Set(proposal.findings.flatMap((f) => f.event_ids))
  return {
    ...base,
    parsed: true,
    parseErrors: [],
    classification: proposal.classification,
    confidence: proposal.confidence,
    findings: proposal.findings.length,
    passing: v.passes.filter(Boolean).length,
    covered: v.covered,
    coveredLabelled: v.covered.filter(isLabelled),
    coveredUnlabelled: v.covered.filter((id) => !isLabelled(id)),
    labelledNotCovered: labelled.filter((id) => !v.covered.includes(id)),
    citedLabelled: labelled.filter((id) => cited.has(id)),
  }
}

// What a saved run record says about its run, once it is shown to belong to
// this case: the model's raw output and where it ran. The record is checked
// against the case file as it is on disk and against the prompts rebuilt from
// it, so a record of other evidence, or of another prompt, is refused.
export interface RecordedRun {
  raw: string
  location: RunRecord['execution']['location']
  model: string | null
  consentToSendToCloud: boolean
  latencyMs: number | null
  startedAt: string
  systemPromptSha256: string
}

export async function recordedRun(
  record: RunRecord,
  caseFile: CaseFile,
  caseFileSha256: string,
): Promise<RecordedRun> {
  if (record.format !== RUN_RECORD_FORMAT) throw new Error(`not a run record (format ${String(record.format)})`)
  if (record.case.sha256 !== caseFileSha256) {
    throw new Error(`the record is of a case file with sha256 ${record.case.sha256}, not ${caseFileSha256}`)
  }
  const system = authSystemPrompt(caseFile.modelNotes)
  if (record.prompt.system !== system || record.prompt.systemSha256 !== (await sha256Hex(system))) {
    throw new Error("the record's system prompt is not the one this case gets")
  }
  const user = buildPrompt(caseFile.events.map((e) => e.evidence))
  if (record.prompt.user !== user || record.prompt.userSha256 !== (await sha256Hex(user))) {
    throw new Error("the record's prompt is not this case's evidence")
  }
  const { execution } = record
  if (execution.outcome !== 'completed' || record.output.raw === null) {
    throw new Error(`the run failed and has no output to evaluate: ${execution.error ?? 'no error recorded'}`)
  }
  return {
    raw: record.output.raw,
    location: execution.location,
    model: execution.model,
    consentToSendToCloud: execution.consentToSendToCloud,
    latencyMs: execution.latencyMs,
    startedAt: execution.startedAt,
    systemPromptSha256: record.prompt.systemSha256,
  }
}
