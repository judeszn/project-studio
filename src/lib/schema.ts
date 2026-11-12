// One row of evidence, already parsed. The model only ever sees these rows.
export interface LogEvent {
  id: string
  date: string // YYYY-MM-DD
  time: string // HH:MM, 24-hour
  source: 'identity' | 'audit' | 'repository' | 'statement'
  actor: string
  action: EventAction
  target: string
  outcome: 'success' | 'denied' | 'recorded'
  device?: 'managed' | 'unrecognised' // sign-in and sign-out events only
  logonType?: string // LANL only: the logon type exactly as recorded, or 'not recorded'
  detail: string
}

export type EventAction =
  | 'sign-in'
  | 'sign-out'
  | 'run scheduled job'
  | 'create account'
  | 'change security setting'
  | 'read'
  | 'written statement'
  // LANL Kerberos ticket activity. Not a sign-in: no finding type's rule
  // accepts these, so they can support no finding until one is decided.
  | 'ticket-granting ticket'
  | 'service ticket'
  // LANL orientations kept under their own names (owner's decision,
  // 2026-11-11): context only; no finding type's rule accepts them.
  | 'AuthMap'
  | 'ScreenLock'
  | 'ScreenUnlock'
  // LANL LogOff: context only. Not 'sign-out', which implies a person.
  | 'logoff'
  | LogonAction

// LANL LogOn, named by its logon type (owner's decision, 2026-11-11). A logon
// is an account authenticating to a computer; only the interactive kinds
// involve a person at a keyboard, and none of them says who.
export const LOGON_ACTIONS = [
  'network logon',
  'interactive logon',
  'remote interactive logon',
  'service logon',
  'batch logon',
  'unlock logon',
  'new-credentials logon',
  'network cleartext logon',
  'cached interactive logon',
  'logon, type not recorded',
] as const
export type LogonAction = (typeof LOGON_ACTIONS)[number]

export const CLASSIFICATIONS = [
  'Ransomware',
  'Phishing',
  'Credential Compromise',
  'Data Exfiltration',
  'Insider Threat',
  'Undetermined',
] as const
export type Classification = (typeof CLASSIFICATIONS)[number]

export const CONFIDENCE_LEVELS = ['Low', 'Medium', 'High'] as const
export type Confidence = (typeof CONFIDENCE_LEVELS)[number]

// What a finding says its cited events show. The model picks one; verify.ts
// holds the rule each type must meet. `other` has no rule, so code cannot
// check it and it is never shown as supported.
//
// Which types a model may choose depends on the evidence source. GS-03 keeps
// exactly these nine; its schema is pinned by a regression test.
export const FINDING_TYPES = [
  'sign_in_from_unrecognised_device',
  'sign_in',
  'sign_out',
  'account_created',
  'security_setting_changed',
  'data_access_denied',
  'data_access_succeeded',
  'account_owner_statement',
  'other',
] as const

// LANL offers only these (owner's decisions, 2026-11-11 and 2026-11-12): no
// LANL event can satisfy a GS-03 type, so offering them only invites findings
// that fail. `logon`: an account successfully authenticated to a computer. It
// does not say a person signed in, or that anything malicious happened.
// `denied_logon`: a logon the evidence records as denied. It says only that:
// not that access was obtained, that an account is compromised, or that there
// was an attack. Added before any model saw LANL evidence, so that a verified
// finding can rest on a denied event at all.
export const LANL_FINDING_TYPES = ['logon', 'denied_logon', 'other'] as const

// Every type any source may use: the verifier has a rule for each.
export const ALL_FINDING_TYPES = [...FINDING_TYPES, 'logon', 'denied_logon'] as const

export type FindingType = (typeof ALL_FINDING_TYPES)[number]

export interface Finding {
  type: FindingType
  claim: string
  event_ids: string[]
}

export interface IncidentProposal {
  findings: Finding[]
  explanation: string
  classification: Classification
  confidence: Confidence
  recommended_actions: string[]
}

// Upper bounds on every list the model writes. Without them Gemini Nano once
// wrote past Chrome's output limit (QuotaExceededError). parseProposal enforces
// the same bounds, so output over them is rejected even if a model ignores
// the schema.
export const MAX_FINDINGS = 8
export const MAX_EVENTS_PER_FINDING = 4
export const MAX_ACTIONS = 5

// Plain JSON Schema: passed to Gemini Nano as `responseConstraint` and to the
// cloud model as `responseJsonSchema`, and the shape `parseProposal` in
// verify.ts re-checks by hand. Keep the two in step.
// Property order is deliberate: the model writes findings first and the
// classification after them, so the classification comes after the evidence
// rather than the evidence being written to fit it.
export function proposalSchemaFor(findingTypes: readonly FindingType[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['findings', 'explanation', 'classification', 'confidence', 'recommended_actions'],
    properties: {
      findings: {
        type: 'array',
        maxItems: MAX_FINDINGS,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'claim', 'event_ids'],
          properties: {
            type: { type: 'string', enum: findingTypes },
            claim: { type: 'string' },
            event_ids: { type: 'array', maxItems: MAX_EVENTS_PER_FINDING, items: { type: 'string' } },
          },
        },
      },
      explanation: { type: 'string' },
      classification: { type: 'string', enum: CLASSIFICATIONS },
      confidence: { type: 'string', enum: CONFIDENCE_LEVELS },
      recommended_actions: { type: 'array', maxItems: MAX_ACTIONS, items: { type: 'string' } },
    },
  } as const
}

// GS-03's schema, as the page sends it to both models.
export const incidentProposalSchema = proposalSchemaFor(FINDING_TYPES)

// For LANL cases, opened through the case-file loader (casefile.ts).
export const lanlProposalSchema = proposalSchemaFor(LANL_FINDING_TYPES)
