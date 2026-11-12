# Project Studio

On-device incident response assistant, built solo for #BuildHybridAI 2026. One
incident type: credential compromise (scenario GS-03), on synthetic data.
Hybrid inference through Firebase AI Logic: Gemini Nano on-device (Chrome Prompt
API) plus Gemini in the cloud, with a deterministic TypeScript verification layer.
The model proposes, code verifies, a human decides.

Current milestone and evidence: `docs/DECISIONS.md`. Read it before starting work.

## Commands

- `npm run dev` — dev server
- `npm test` — Vitest unit tests
- `npm run build` — typecheck + production build
- `npm run lint`

Node is 20.15 on the build machine: stay on Vite 6 and Vitest 3 until Node is upgraded.

## Rules

- Never claim a capability works without testing it. Record the evidence in
  `docs/DECISIONS.md`; no item is complete without it.
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
  `.env.local`; the debug token goes in `.env.development.local` only.
  Read env vars as `import.meta.env.NAME`, never through an alias.
- Do not disable App Check to make something work.
- ATT&CK references (`src/lib/attack.ts`) are metadata on findings that pass,
  never evidence. Map a type only when its checked facts are the technique's
  behaviour; check IDs against attack.mitre.org; keep MITRE's notice.
- Synthetic demonstration data only, labelled as synthetic. No real logs, no
  real people, no real organisations.
- Do not fake network disconnection.
- Scope is the current milestone. No dashboard, auth, or sync work until
  `docs/DECISIONS.md` says the milestone before it passed.
- This repository is separate from the ADTC submission. Never modify
  `~/Desktop/eulermind-adtc-submission`.
- Ask the user only for credentials, hardware access, paid services,
  irreversible operations, or decisions that change the product.
