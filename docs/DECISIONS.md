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
| Deterministic verification (schema, cited events, quoted times) | verified by unit tests |
| App Check debug token cannot reach the production bundle | verified |
| Proof-of-concept page renders and reads Prompt API availability | verified |
| On-device inference returns an incident proposal from the GS-03 events | verified 2026-11-11 |
| Same, with the network disabled | verified in part: page reported offline and `on_device`; Network tab not captured |
| Output quality over five runs on the GS-03 events | unverified: 2 of 5 runs recorded, and they disagree |
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
run. The three inference rows in the table above remain unverified. The
screenshot was of the baseline page (text + image input). The page now asks for
text input only, which has not been re-checked in Chrome.

**Proof of concept retargeted to GS-03 (after the baseline commit, about 14:00
WAT, before the submission period opened).** The page now sends eleven synthetic
log events (`src/data/gs03.ts`) to the on-device model and checks the proposal
it returns. `npm test`: 21 of 21 passing. `npm run build` and `npm run lint`
clean. The page rendered in the Claude desktop app's built-in browser with no
console errors, showing `Prompt API availability (text): downloadable`. No
inference was run.

**Retargeted page in the target browser.** A second screenshot from the owner's
Chrome shows the GS-03 page with `Prompt API availability (text): available`,
`Model ready on this device.` and `Running on-device inference…`. The run had
not finished when the screenshot was taken, so there is no result to record yet.

**Confirmed by the owner, 2026-11-11.** Entrant: individual. Firebase: a new,
separate project. Domain: `phang.store`; intended URL: `project.phang.store`.
The GS-03 work stays uncommitted on `feat/gs03-investigation` until one
on-device inference run has succeeded.

**First on-device inference runs (owner's Chrome, about 14:15 WAT).** Two runs
of **Propose on this device** on the eleven GS-03 events. Source: the page text
pasted by the owner (run A) and a screenshot (run B).

| | Run A | Run B |
| --- | --- | --- |
| Network during run (`navigator.onLine`) | online at start and end | offline at start and end |
| Inference source (SDK) | `on_device` | `on_device` |
| Latency | 42,464 ms | 28,922 ms |
| Schema validation | valid | valid |
| Classification proposed | Credential Compromise | Insider Threat |
| Confidence proposed | Medium | Medium |
| Citation and time checks | no problem found | no problem found |
| Findings (events cited) | 5 (E05; E06; E07; E08; E11) | 4 (E05, E09; E06; E08; E11) |
| Says customer data was accessed | no | no |

What the runs show:

- On-device inference works on the build machine, with no Firebase project
  configured, and returns output that passes the schema check.
- Run B is the offline evidence so far. The page reported offline throughout
  and the SDK reported `on_device`. How the network was turned off, and the
  DevTools Network tab, were not captured, so "no network requests during the
  run" is not yet shown.
- The model's reading is not reliable. Both runs treat E09, a sign-out, as a
  sign-in: run A in its explanation ("sign-in from an unrecognized device (E05 &
  E09)"), run B in a finding ("Unrecognized device login" citing E05 and E09)
  and again in its explanation, which says the account "signs out" at E05. Run B
  leaves out E07 (alerts disabled) and proposes Insider Threat although the
  account owner denies the activity.
- The code check reported no problem in either run. That is what it was built
  to do (cited events exist, quoted times belong to them) and it is not enough:
  it cannot tell a correct reading of an event from a wrong one.
- Latency is 29 to 42 seconds for eleven events on an Apple M1 with 16 GB.

### How to finish the on-device checks (owner, in Chrome on the build machine)

1. `npm run dev`, open `http://localhost:5173` in Chrome.
2. Read **Prompt API availability**. If it is `no Prompt API` or `unavailable`,
   enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`,
   relaunch Chrome, reload. Record what it says.
3. Click **Initialise on-device model**. Record whether it downloads and how long.
4. Click **Propose on this device**. Record inference source, latency, schema
   validation, the classification, and every problem the code check lists.
5. Offline run: turn Wi-Fi off at the OS (not DevTools throttling), confirm the
   page shows `offline`, open DevTools > Network, repeat step 4. Pass means:
   source `on_device`, a valid record, and no network requests during the run.
6. Repeat step 4 five times. For each run: is the classification Credential
   Compromise, does any finding claim that customer data was accessed (event E08
   was denied), and did the code check flag anything it should not have, or miss
   anything?

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

**Grounding rule: every finding cites events, and code checks the citations.**
A finding with no cited event, a cited event that is not in the evidence, or a
quoted time that does not belong to a cited event is reported as a problem.
Known limits: this shows the cited events exist, not that the finding reads
them correctly; am/pm is not read; dates are not checked.

**The model's classification and confidence are shown as a proposal, never as
verified.** Code has no way to confirm them. The analyst decides.

**The model only sees parsed events, never raw logs.** The on-device context is
small, so selection and parsing happen in code first. Today the eleven events
are fixed; a real parser is not built.

**Firestore's built-in offline persistence for case records.** Not built yet.
No conflict detection planned.

## Open questions

- Official #BuildHybridAI rules: eligibility, individual or organisation entry,
  reuse of prior work and prior research, submission requirements, judging
  weights. Not published as of 2026-11-11 13:53 WAT.
- Whether 29 to 42 seconds per proposal is usable, and whether it holds on the
  demo hardware.
- Licence. The owner enters as an individual; no licence file has been added yet.
- Custom domain `project.phang.store`. Needs a Firebase project and a Hosting
  deployment first.
