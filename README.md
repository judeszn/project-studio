# Project Studio

An incident response assistant that runs on the analyst's own machine, in
development for #BuildHybridAI 2026. Working name.

The idea: a small on-device model (Gemini Nano, through Firebase AI Logic)
proposes what happened from a bounded set of log events. Deterministic code
checks that every event it cites exists. A cloud model adds depth when the
machine is online, and is labelled as such. A human approves, modifies, rejects
or escalates. First scenario: credential compromise, on synthetic data.

Current state: pre-submission baseline. The one page here is a proof of concept
from an earlier direction (photo and note to a structured experiment record,
checked by code). It is being replaced. See [docs/DECISIONS.md](docs/DECISIONS.md)
for what was written when, and what has and has not been verified.

## Run it

Requires Node 20 and Chrome 139 or later on a desktop that supports Gemini Nano.

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in Chrome. On-device inference works without a
Firebase project. For cloud inference, copy `.env.example` to `.env.local` and
fill in the Firebase web app config.

## Checks

```bash
npm test
npm run build
npm run lint
```
