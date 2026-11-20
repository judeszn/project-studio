# Project Studio

AI-assisted investigation of technical security incidents, built solo for
#BuildHybridAI 2026 (Web/Chrome). An analyst opens a case of authentication
events (a JSON case file, or the simulated sample); Gemini Nano on the device,
or Gemini in the cloud after the analyst's consent, proposes findings through
Firebase AI Logic; deterministic TypeScript checks every finding against the
records it cites; the analyst decides. **AI proposes. Code verifies. The
analyst decides.**

Product direction (Option C: accept broadly, verify narrowly):
`docs/PRODUCT_DIRECTION.md`. Decisions and evidence: `docs/DECISIONS.md`;
read it before starting work. Hackathon scope and checklist:
`docs/HACKATHON_MVP_SCOPE.md`.

## Commands

- `npm run dev` — dev server
- `npm test` — Vitest unit tests
- `npm run build` — typecheck + production build
- `npm run lint`

Node.js 24.12 or later (`.nvmrc`); the installed Firebase SDK requires it.

## Rules

- Never claim a capability works without testing it. Record the evidence in
  `docs/DECISIONS.md`; no item is complete without it. The log is
  append-only: add dated entries, and mark what they supersede.
- Evidence never reaches the cloud without the analyst's consent. Routing lives
  in `src/lib/hybrid.ts`: the only run made without consent is
  `ONLY_ON_DEVICE`, refused when the SDK has no on-device adapter; cloud-capable
  runs use `PREFER_ON_DEVICE` or `PREFER_IN_CLOUD` and only follow consent.
  `src/lib/hybrid-sdk.test.ts` checks this against the installed SDK; rerun it
  after any Firebase upgrade. Firebase AI Logic only, never a direct Gemini API
  call. Show the SDK mode and `response.inferenceSource` wherever a result is
  shown.
- Deterministic checks (schema, citations, quoted times and accounts, whether
  cited events support a finding's type, repeated findings) live in
  `src/lib/verify.ts` and are never delegated to a model. They fail closed.
  Every change there comes with unit tests.
- Never commit Firebase secrets or App Check debug tokens. Config comes from
  `.env.local`; the debug token goes in `.env.development.local` only; the
  reCAPTCHA site key in `.env.production.local`. `.env.example` holds
  placeholders only. Read env vars as `import.meta.env.NAME`, never through an
  alias.
- Do not disable App Check to make something work.
- ATT&CK references (`src/lib/attack.ts`) are metadata on findings that pass,
  never evidence. Map a type only when its checked facts are the technique's
  behaviour; check IDs against attack.mitre.org; keep MITRE's notice.
- Exception (owner's decision, 2026-11-14): the sample case may name the
  owner's own organisation and product, PHANG Group and InfoPro, as long as it
  is labelled as simulated everywhere it appears and says InfoPro has had no
  such incident.
- Synthetic demonstration data only, labelled as synthetic. No real logs, no
  real people, no real organisations. No LANL data in the repository.
- Do not fake network disconnection.
- Do not present the two models as performing the same, and do not rank them
  from single runs.
- Planned capabilities (other intake, other investigation types, persistent
  history) are not shown in the app, which shows only what the product does
  (owner's decision, 2026-11-20); where the docs describe them, they are
  labelled Planned. Do not build them before the submission.
- Internal deployment notes stay out of the repository.
- This repository is separate from the ADTC submission. Never modify
  `~/Desktop/eulermind-adtc-submission`.
- Nothing is committed, pushed, merged or deployed without the owner's
  approval.
- Ask the user only for credentials, hardware access, paid services,
  irreversible operations, or decisions that change the product.
