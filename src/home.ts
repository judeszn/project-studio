import type { Verdict } from './lib/report'
import { DESCRIPTOR } from './site'

// The home page's wording (owner's decision, 2026-11-24). Every claim here is
// something the code does today, and Overview.test.tsx checks the verdict
// examples against the verifier itself.

export const HEADLINE = DESCRIPTOR

export const DESCRIPTION =
  'Investigate authentication events. Every finding is matched against the original records before your SOC acts.'

// The slogan, one part per role. Gemini Nano is named without a version:
// Chrome manages which Nano model is installed, and the page cannot read it.
export const MOTTO = ['Gemini Nano proposes.', 'Deterministic engine verifies.', 'The SOC decides.'] as const

export const QUALIFIER = 'On-device inference through Chrome. Cloud Gemini only with your consent.'

export const STEPS: { title: string; text: string }[] = [
  {
    title: 'Load Evidence',
    text: 'Open a case file of authentication records, or use the sample case.',
  },
  { title: 'Inspect Events', text: 'Review the original sign-in records.' },
  {
    title: 'Gemini Nano Proposes',
    text: 'It analyses the events and suggests findings, each citing its events.',
  },
  {
    title: 'Deterministic Engine Verifies',
    text: 'Each claim is checked against its cited events using fixed verification rules.',
  },
  {
    title: 'SOC Decides',
    text: 'Review the verdicts and follow your organisation’s incident-response process.',
  },
]

export const QUESTIONS = [
  'Does the cited event exist?',
  'Does it support the claim?',
  'Can someone else reproduce the result?',
] as const

// One finding of the worked example (src/data/worked-example.ts) for each
// verdict, by its number there. The claim and the cited events are read from
// the worked example; `found` says what the code's reason says.
export const VERDICT_EXAMPLES: { finding: number; verdict: Verdict; found: string }[] = [
  { finding: 1, verdict: 'verified', found: 'E06–E08 are denied logons' },
  { finding: 3, verdict: 'contradicted', found: 'E10 records a successful logon' },
  { finding: 6, verdict: 'rejected', found: 'E21 is not in the evidence' },
  { finding: 7, verdict: 'unchecked', found: 'Type “other”: no rule in code checks it; never counted as Verified' },
]

// The checks as src/lib/verify.ts applies them.
export const CHECKS = [
  'Each cited event exists.',
  'Each event is the kind and outcome the finding states.',
  'Quoted times, accounts and computer names belong to the cited events.',
  'A repeated finding is not counted twice.',
  'A finding no rule covers is Unchecked.',
] as const

export const REPRODUCIBLE =
  'Each run exports a record that holds the model’s raw output, so the checks can be run again and give the same verdicts.'

// README "Evaluation on public data": the evaluation case, 12 November 2026.
export const EVALUATION =
  'On public LANL authentication data, none of seven failing findings was shown as Verified. Single runs, not benchmarks.'

// The two CSF 2.0 outcomes, word for word as NIST CSWP 29 and SP 800-61r3
// give them (checked against both PDFs, 2026-11-24).
export const NIST_DE_AE_02 = 'Potentially adverse events are analyzed to better understand associated activities'
export const NIST_RS_AN_03 =
  'Analysis is performed to establish what has taken place during an incident and the root cause of the incident'

export const SOURCES = {
  sp80061r3: 'https://doi.org/10.6028/NIST.SP.800-61r3',
  csf2: 'https://doi.org/10.6028/NIST.CSWP.29',
  sans: 'https://www.giac.org/research-papers/33901',
  attack: 'https://attack.mitre.org/',
} as const

export const NOT_COMPLIANCE = 'These are references, not a certification or a compliance claim.'

export const DOES_NOT =
  'AEMAS does not monitor infrastructure, raise alerts, take action, confirm that an attack happened, or replace incident responders.'
