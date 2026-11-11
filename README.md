# Project Studio

An incident response assistant that runs on the analyst's own machine, in
development for #BuildHybridAI 2026. Working name.

The idea: a small on-device model (Gemini Nano, through Firebase AI Logic)
proposes what happened from a bounded set of log events. Deterministic code
checks that every event it cites exists. A cloud model adds depth when the
machine is online, and is labelled as such. A human approves, modifies, rejects
or escalates. First scenario: credential compromise, on synthetic data.

Current state: Milestone 1 proof of concept. One page sends eleven synthetic log
events to Gemini Nano on the device, gets back a proposed classification with
findings that cite events, and checks those citations with deterministic code.
See [docs/DECISIONS.md](docs/DECISIONS.md) for what was written when, and what
has and has not been verified.

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
