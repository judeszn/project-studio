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
- Never substitute cloud inference for a claimed on-device result. On-device
  features use `InferenceMode.ONLY_ON_DEVICE` and fail visibly when the model is
  unavailable. Show `response.inferenceSource` wherever a result is shown.
- Deterministic checks (schema, missing fields, number grounding) live in
  `src/lib/verify.ts` and are never delegated to a model. They fail closed.
  Every change there comes with unit tests.
- Never commit Firebase secrets or App Check debug tokens. Config comes from
  `.env.local`; the debug token goes in `.env.development.local` only.
  Read env vars as `import.meta.env.NAME`, never through an alias.
- Do not disable App Check to make something work.
- Synthetic demonstration data only, labelled as synthetic. No real logs, no
  real people, no real organisations.
- Do not fake network disconnection.
- Scope is the current milestone. No dashboard, auth, or sync work until
  `docs/DECISIONS.md` says the milestone before it passed.
- This repository is separate from the ADTC submission. Never modify
  `~/Desktop/eulermind-adtc-submission`.
- Ask the user only for credentials, hardware access, paid services,
  irreversible operations, or decisions that change the product.
