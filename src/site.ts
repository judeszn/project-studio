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

// The case study's primary source.
export const TESTIMONY = {
  label:
    'Andrew Witty, Chief Executive Officer, UnitedHealth Group. Written testimony before the House Energy and Commerce Committee, Subcommittee on Oversight and Investigations, 1 May 2024.',
  url: 'https://docs.house.gov/meetings/IF/IF02/20240501/117242/HHRG-118-IF02-Wstate-WittyS-20240501-U5.pdf',
}
