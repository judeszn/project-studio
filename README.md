# Project Studio

An incident response assistant that runs on the analyst's own machine, in
development for #BuildHybridAI 2026. Working name.

The idea: a small on-device model (Gemini Nano, through Firebase AI Logic)
proposes what happened from a bounded set of log events. Deterministic code
checks that every event it cites exists and is the kind of event the finding
says it is. A cloud model adds depth when the
machine is online, and is labelled as such. A human approves, modifies, rejects
or escalates. First scenario: credential compromise, on synthetic data.

Current state: proof of concept. One page sends eleven synthetic log events to
Gemini Nano on the device, gets back a proposed classification with findings
that cite events, and checks those citations, and whether the cited events
support each finding, with deterministic code. If Nano is unavailable or fails,
the page asks before sending the events to Gemini in the cloud, using the
Firebase AI Logic hybrid modes; nothing leaves the device without that consent.
Each result shows the mode used and which model actually answered.
See [docs/DECISIONS.md](docs/DECISIONS.md) for what was written when, and what
has and has not been verified.

## Run it

Requires Node 20 and Chrome 139 or later on a desktop that supports Gemini Nano.

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in Chrome. On-device inference works without a
Firebase project. For cloud inference, copy `.env.example` to `.env.local`, fill
in the Firebase web app config, and register the App Check debug token that the
browser console prints (see `.env.example`).

## Checks

```bash
npm test
npm run build
npm run lint
```

## Licence

Project Studio's original source code is licensed under the
[Apache License 2.0](LICENSE). Copyright and third-party attributions are in
[NOTICE](NOTICE). The licence does not cover third-party material: MITRE
ATT&CK content stays under MITRE's terms of use, the LANL dataset (not
included here) under LANL's terms, and dependencies under their own licences.
