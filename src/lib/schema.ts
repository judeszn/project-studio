// One row of evidence, already parsed. The model only ever sees these rows.
export interface LogEvent {
  id: string
  date: string // YYYY-MM-DD
  time: string // HH:MM, 24-hour
  source: 'identity' | 'audit' | 'repository' | 'statement'
  actor: string
  action: string
  target: string
  outcome: 'success' | 'denied' | 'recorded'
  detail: string
}

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

export interface Finding {
  claim: string
  event_ids: string[]
}

export interface IncidentProposal {
  classification: Classification
  confidence: Confidence
  explanation: string
  findings: Finding[]
  recommended_actions: string[]
}

// Plain JSON Schema: passed to Gemini Nano as `responseConstraint`, and the
// shape `parseProposal` in verify.ts re-checks by hand. Keep the two in step.
export const incidentProposalSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['classification', 'confidence', 'explanation', 'findings', 'recommended_actions'],
  properties: {
    classification: { type: 'string', enum: CLASSIFICATIONS },
    confidence: { type: 'string', enum: CONFIDENCE_LEVELS },
    explanation: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'event_ids'],
        properties: {
          claim: { type: 'string' },
          event_ids: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    recommended_actions: { type: 'array', items: { type: 'string' } },
  },
} as const
