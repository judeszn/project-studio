# Decisions and evidence

One file for what was decided, why, and what has actually been shown to work.
Status words: **verified** (tested, evidence below), **unverified** (not yet
tested), **blocked** (waiting on something named).

## Baseline, 2026-11-11

The first commit in this repository is the pre-submission baseline. All code in
it was written on 2026-11-10, before the #BuildHybridAI submission period opened
(2026-11-11, 18:00 WAT). It was committed on 2026-11-11 at about 14:00 WAT with
documentation edits and a `.gitignore` hardening only.

What the baseline is: a Vite scaffold, Firebase AI Logic wiring, a deterministic
verification module with unit tests, and one proof-of-concept page. That page
still implements the earlier direction (photo + note to an experiment record).
No on-device inference has been run yet, on this page or any other.

The official rules were not published when the baseline was committed (checked
13:53 WAT). Whether code written before the submission period is permitted is
therefore unknown, which is why this section exists.

## Product direction, decided 2026-11-11

An incident response assistant that runs on the analyst's own machine, for one
incident type. The earlier direction (a STEM project platform for schools) is
dropped.

Research basis: a 2026 MSc Cybersecurity dissertation that designs a five-module
AI-assisted incident response framework and evaluates it conceptually on five
synthetic scenarios. It recommends, as future work, validating the framework in
a controlled hybrid prototype. This project is that prototype for one scenario.
Full citation: to be added by the owner.

**Scenario: GS-03, credential compromise** (MITRE ATT&CK T1078, Valid Accounts).
Reasons, against the other four:

- Its five indicators are discrete log events (unusual privileged login, new
  administrator, security setting change, attempted repository access, account
  owner's denial). Code can confirm each one exists. Ransomware and exfiltration
  need endpoint and network-flow evidence, which is harder to bound and fake
  honestly.
- The evidence is a short identity and audit log. It fits Gemini Nano's context
  after deterministic filtering.
- The human decision is real: is an anomalous login corroborated enough to
  restrict the account? The model cannot settle that and should not.
- Compliance is unresolved by design: access to customer data was attempted, not
  shown to have succeeded. The tool must refuse to turn that into a conclusion.
- Phishing and insider threat have ambiguous classifications in the source
  evaluation. A first demo should not rest on a case the framework itself rates
  as only partially consistent. Insider threat also concerns a named employee.

What carries over from the baseline: the pattern in `src/lib/verify.ts` (strict
parse, fail closed, every item the model cites must exist in the evidence) and
the on-device-only inference setup. What gets replaced: the experiment-record
schema, the photo input, and the number-grounding rule.

All incident data in this repository is synthetic and labelled as such.

## Milestone 1: hardware check, scaffold, early deployment, Gemini Nano proof of concept

| Item | Status |
| --- | --- |
| Build machine meets Gemini Nano system requirements | verified (system level) |
| Prompt API reports the model available in the user's Chrome | verified 2026-11-11 |
| Vite scaffold builds, lints, tests pass | verified |
| Deterministic verification (schema, missing fields, number grounding) | verified by unit tests |
| App Check debug token cannot reach the production bundle | verified |
| Proof-of-concept page renders and reads Prompt API availability | verified in the Claude desktop browser only |
| On-device inference returns a structured record from photo + note | unverified |
| Same, with the network disabled | unverified |
| Output quality on five real experiment photos | unverified |
| Firebase project, App Check, deployment to Firebase Hosting | blocked: needs the owner's Firebase project and login |

### Evidence, 2026-11-10

**Hardware.** Apple M1, 8 cores, 16 GB RAM, macOS 15.7.1, 362 GiB free disk,
Chrome 157.0.8103.39. Chrome's own `Local State` records `performance_class: 5`,
`vram_mb: 10922`, and a model component `2025.8.8.1141` (4.0 GB on disk under
`OptGuideOnDeviceModel/`, dated 6 June). No `chrome://flags` entries are enabled.
This shows the machine is eligible and a model was downloaded at some point. It
does not show that the Prompt API reports `available` for text + image input today.

**Build.** `npm run build`, `npm run lint` clean. `npm test`: 19 of 19 passing
(`src/lib/verify.test.ts`).

**Debug token leak check.** Built with a canary `VITE_APPCHECK_DEBUG_TOKEN` and a
canary site key in `.env.local`. The site key appeared in `dist/` (control); the
debug token did not.

**Page.** Loaded `http://localhost:5173` in the Claude desktop app's built-in
browser. The page rendered and showed `Prompt API availability: downloadable`,
Firebase `not configured`, App Check `not initialised`. No model was downloaded
and no inference was run there. That browser is not the target browser.

### Evidence, 2026-11-11

**Model availability in the target browser.** The owner opened
`http://localhost:5173` in Chrome on the build machine and sent a screenshot.
It shows `Prompt API availability (text + image): available` and, after
**Initialise on-device model**, `Model ready on this device.` No inference was
run. The three inference rows in the table above remain unverified.

### How to finish the on-device checks (owner, in Chrome on the build machine)

1. `npm run dev`, open `http://localhost:5173` in Chrome.
2. Read **Prompt API availability**. If it is `no Prompt API` or `unavailable`,
   enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`,
   relaunch Chrome, reload. Record what it says.
3. Click **Initialise on-device model**. Record whether it downloads and how long.
4. Choose a JPEG, type a note containing at least two measurements, click
   **Generate record on this device**. Record inference source, latency, schema
   validation, missing fields, and ungrounded numbers.
5. Offline run: turn Wi-Fi off at the OS (not DevTools throttling), confirm the
   page shows `offline`, open DevTools > Network, repeat step 4. Pass means:
   source `on_device`, a valid record, and no network requests during the run.
6. Repeat step 4 on five real photos. For each: is the record correct, and did
   the grounding check flag anything it should not have, or miss anything?

Paste the results under a new dated Evidence heading.

## Decisions

**Vite + React + TypeScript single-page app, not Next.js.** On-device inference
and offline use are entirely client-side; a server framework adds nothing here.

**Vite 6 and Vitest 3.** The build machine has Node 20.15.0. Vite 8 and Vitest 5
need Node 20.19+ / 22.12+. Upgrading Node is the owner's call.

**`ONLY_ON_DEVICE` for the offline path.** `PREFER_ON_DEVICE` falls back to the
cloud silently, which would make an on-device claim unprovable.

**The page checks for the Prompt API itself.** In `firebase` 13.2.0, when the
browser has no `LanguageModel` global, `initializeDeviceModel` resolves without
error in `ONLY_ON_DEVICE` mode. The app refuses to proceed in that case.

**Placeholder Firebase config until a project exists.** The AI SDK will not
construct a model without `apiKey`, `projectId` and `appId`. The placeholder
lets the on-device path run now; a cloud request with it cannot succeed.

**Grounding rule: every number in the record must appear in the student's note.**
A number the model read from the photo is flagged the same as an invented one,
because code cannot tell them apart; the student confirms it. Known limits:
sign is ignored, units are not compared, number words are not recognised.

**The model's `missing_information` field is not trusted.** Missing fields are
computed from the record in `findMissingFields`.

**Firestore's built-in offline persistence for records; a custom queue only for
photos.** Not built yet. No conflict detection planned.

## Open questions

- Official #BuildHybridAI rules: eligibility, individual or organisation entry,
  reuse of prior work and prior research, submission requirements, judging
  weights. Not published as of 2026-11-11 13:53 WAT.
- Whether on-device inference works on the target demo hardware at usable latency.
- Licence and copyright holder. Held until the rules say who the entrant can be.
- Custom domain. Needs a Firebase project and a Hosting deployment first.
