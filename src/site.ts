// Navigation and sources shared by the page components and their tests.

export type Page = 'overview' | 'case-study' | 'investigations' | 'case'

// The three places a visitor can go. An open investigation is reached from
// Investigations, so no menu item leads to an empty page.
export const NAV: { page: Exclude<Page, 'case'>; label: string; href: string }[] = [
  { page: 'overview', label: 'Overview', href: '#/' },
  { page: 'case-study', label: 'Case Study', href: '#/case-study' },
  { page: 'investigations', label: 'Investigations', href: '#/investigations' },
]

// What AEMAS stands for (owner's decision, 2026-11-23). "Matching": code
// matches each AI finding against the event records it cites. Never
// "Monitoring": AEMAS does not monitor systems.
export const FULL_NAME = 'AI Event Matching and Analysis System'

// Under the wordmark, and in the footer (owner's decision, 2026-11-24).
export const DESCRIPTOR = 'Security Investigation & Event Matching'

// One plain sentence at the top of each screen, saying what happens there
// (owner's decision, 2026-11-24).
export const SCREEN = {
  investigations:
    'Select the records you want to investigate. Investigations stay in this browser tab; no case data is saved.',
  evidence: 'These are the original sign-in records. Every finding must refer back to them.',
  analysis:
    'Gemini suggests findings, on this device or in the cloud if you allow it. Code then checks each one against the records.',
  report: 'Review and export everything that was checked.',
  verdicts: 'See how code reaches each of the four verdicts, with no AI involved.',
  caseStudy: 'Explore the 2024 Change Healthcare incident and the role of authentication evidence.',
} as const

// The case-file format, for anyone writing a file by hand or with a tool, and
// the name the sample case file downloads as (owner's decision, 2026-11-24).
export const CASE_FILE_DOC_URL = 'https://github.com/judeszn/project-studio/blob/main/docs/CASE_FILE.md'
export const SAMPLE_CASE_DOWNLOAD = 'aemas-sample-case.json'

// The case study's primary source.
export const TESTIMONY = {
  label:
    'Andrew Witty, Chief Executive Officer, UnitedHealth Group. Written testimony before the House Energy and Commerce Committee, Subcommittee on Oversight and Investigations, 1 May 2024.',
  url: 'https://docs.house.gov/meetings/IF/IF02/20240501/117242/HHRG-118-IF02-Wstate-WittyS-20240501-U5.pdf',
}
