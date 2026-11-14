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
| Deterministic verification (schema, citations, quoted times and accounts, event support) | verified by unit tests |
| On-device model fills the finding `type` field in a way the support check can use | verified in one run 2026-11-11; two of seven findings fell back to `other` |
| App Check debug token cannot reach the production bundle | verified |
| Proof-of-concept page renders and reads Prompt API availability | verified |
| On-device inference returns an incident proposal from the GS-03 events | verified 2026-11-11 |
| Same, with the network disabled | verified in part, first schema only: page reported offline and `on_device`; Network tab not captured. An offline attempt on the current schema did not finish |
| Output quality over five runs on the GS-03 events | unverified: on the current prompt, 3 on-device runs (2 Credential Compromise, 1 Insider Threat) and 1 cloud run |
| Firebase project, App Check, deployment to Firebase Hosting | blocked: see Milestone 2; deployment not started |

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

The code as it stood for those two runs is commit `85a5702` on
`feat/gs03-investigation` (local, not pushed).

**Support check added after those runs (about 14:30 WAT, before the submission
period opened).** Each finding now carries a `type`, and code checks the cited
events against a rule for that type (see Decisions). `npm test`: 39 of 39
passing. `npm run build` and `npm run lint` clean. The page loads in the Claude
desktop app's built-in browser with no console errors.

Not shown yet: the model has not been run against the new schema, so the two
runs above are evidence for the old schema only. Whether Gemini Nano picks
finding types sensibly, and what it does to latency, is unknown. The new rows
in the result panel have been type-checked and built but not seen rendered,
because that needs an inference run.

**Run C: first run on the typed schema (owner's Chrome, screenshot, about
14:45 WAT).** Online at start and end. Source `on_device`. Latency 61,406 ms.
Schema valid. Classification proposed: Insider Threat, confidence Medium.
Seven findings. The new rows in the result panel rendered.

- Five findings carried a checkable type and all five were reported supported:
  E05 as an unrecognised-device sign-in, E06 account created, E07 setting
  changed, E08 access denied, E11 owner statement. Each matches the event.
- The citation check reported two problems, both real errors by the model: the
  E06 finding gives the time as 02:20 (the event is 02:24), and the E11 finding
  gives 07:55 (the event is 08:45; 07:55 belongs to E10).
- Two findings were typed `other` and so shown as not checked. One of them
  lists E09, the 02:36 sign-out, as a sign-in. This is the third run in three to
  misread E09, and the support check did not catch it, because `other` has no
  rule. It was not shown as supported.
- The explanation lists "read restricted data" among actions that were carried
  out. E08 was denied. The explanation names no event, so code had nothing to
  check. In all three runs the explanation has contained an error that the
  findings did not.
- Classification was Insider Threat in two runs of three. Code does not judge
  the classification.
- Latency rose from 29 to 42 seconds to 61 seconds. Likely the longer output
  (seven typed findings); three runs are not enough to say.

**Offline attempt on the typed schema: did not finish.** A screenshot shows
`Model ready on this device.` and `Running on-device inference…` with no
result. The owner reports that it did not respond. Not captured: how long it
ran, the network status on the page, and the console. The cause is unknown.
The page shows no elapsed time, so a slow run and a stuck run look the same.

**A later run on the typed schema failed on output length (owner's Chrome,
screenshot, 2026-11-11).** The page showed `On-device inference failed; no
cloud request was attempted. QuotaExceededError: The response exceeded output
limits and was truncated.` The page failed visibly and made no cloud request,
as designed. Not captured: whether the page was online or offline, how long
the run took, and whether this is the same run as the attempt above. Likely
cause, not yet tested: the schema puts no upper bound on the number of
findings or recommended actions, so the model can write until Chrome cuts it
off. No fix has been made or tested.

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
   was denied), how many findings are supported, contradicted, unsupported or
   unchecked, and did either code check flag anything it should not have, or
   miss anything?

Paste the results under a new dated Evidence heading.

## Milestone 2: cloud inference through Firebase AI Logic

The owner reports a Firebase project `project-studio-4c811` with a registered
web app, "project studio web" (2026-11-11). Its config has not been put in this
checkout, so nothing here has reached that project yet.

| Item | Status |
| --- | --- |
| Cloud path written: same prompt, same schema, `ONLY_IN_CLOUD`, `gemini-3.5-flash-lite` | verified as far as a failing request (below) |
| Cloud path returns a proposal from the real project | verified once 2026-11-11 (run E) |
| Cloud model accepts the schema as `responseJsonSchema` (it has `additionalProperties: false`) | verified once (run E: schema valid) |
| App Check on localhost by debug token, with no reCAPTCHA key | verified 2026-11-11: token registered by the owner, cloud call succeeded |
| Debug token and the development-only provider stay out of the production bundle | verified |
| On-device path unchanged by this work | verified once (run D) |
| App Check on the deployed site (reCAPTCHA Enterprise), deployment, custom domain | not started |

### What the official documentation says (read 2026-11-11, pages updated 2026-11-10)

- One `getGenerativeModel(ai, { mode, inCloudParams, onDeviceParams })` call
  serves both models. Modes: `PREFER_ON_DEVICE`, `ONLY_ON_DEVICE`,
  `PREFER_IN_CLOUD`, `ONLY_IN_CLOUD`. `response.inferenceSource` says which ran.
- Structured output is configured twice: `responseConstraint` on the device,
  `responseMimeType` and a schema in the cloud.
- Default cloud model: `gemini-3.5-flash-lite`.
- App Check is required for Firebase AI Logic from 2026-11-02, and the console
  setup enforces it. Localhost uses the debug provider; localhost must not be
  added to a reCAPTCHA key's allowed domains.

### Evidence, 2026-11-11

`npm test` 39 of 39, `npm run build`, `npm run lint` clean.

**No config (the running dev server).** The page renders; **Propose in the
cloud** is disabled; Firebase project shows `not configured`; App Check shows
`not initialised`; no console errors.

**Fake config (temporary second dev server, since stopped).** With made-up
`VITE_FIREBASE_*` values, **Propose in the cloud** sent one request to
`https://firebasevertexai.googleapis.com/v1beta/projects/<fake>/models/gemini-3.5-flash-lite:generateContent`
(the Firebase AI Logic endpoint), Google answered `400 API key not valid`, and
the page showed `Cloud inference failed; no on-device result is shown in its
place.` with the error and no proposal. App Check ran in debug mode and printed
a debug token to the console. This shows the wiring and the failure path. It
does not show a cloud proposal.

**Bundle check.** Built with canary values in the environment. The API key and
site key canaries are in `dist/` (controls). The debug token canary and the
development-only provider are not. `generativelanguage.googleapis.com` does not
appear in `dist/`.

**Real config, before the debug token is registered (my browser, 17:40 WAT).**
The six values were first typed into `.env.example`, which git tracks; they
were moved to `.env.local` (gitignored) before any commit, and the template is
back to empty values. All six present; project ID, auth domain, storage bucket,
app ID and sender ID agree with each other. One debug token, generated locally
into `.env.development.local` (gitignored, absent from `dist/`), so every
browser on localhost uses the same token. The page shows Firebase project
`project-studio-4c811` and App Check `debug token (development build)`. The
debug-token exchange returned `403 App attestation failed`, not `400 API key
not valid` or `404`: Google accepts the API key, project and app, and refuses
only because the token is not registered yet. Not yet shown: that AI Logic's
Gemini Developer API is enabled, and any cloud response.

### Runs D and E: same evidence, both paths (owner's Chrome, screenshots, about 18:00 WAT)

Both online. One run each, so no comparison of the two models can rest on them.

| | Run D | Run E |
| --- | --- | --- |
| Requested / reported source | `on_device` / `on_device` | `in_cloud` / `in_cloud` |
| Model | Gemini Nano | `gemini-3.5-flash-lite` |
| Latency | 54,391 ms | 16,519 ms |
| Schema | valid | valid |
| Classification, confidence (model's own) | Insider Threat, Medium | Credential Compromise, High |
| Citation, time and account problems | 3, all in the explanation | none |
| Findings supported | 3 of 5 | 5 of 5 |
| Recommended actions | 5 | 3 |

Run D, what code caught: finding 1 (`sign_in_from_unrecognised_device`)
cited E05 and E09; E09 is a sign-out, so the finding is unsupported, with the
note `E09 is a "sign-out" event, not "sign-in"`. The three problems are the
explanation rule: it names E05, E09 and E11, and no supported finding cites
them. E05 is flagged only because the one finding citing it also cites E09.
E11 is flagged because Nano typed the owner's statement `other` although
`account_owner_statement` exists.

Run D, what code did not catch: the explanation calls E05 and E09 "a sign-in
from an unrecognized device" and speaks of a discrepancy between E11 and system
activity; the code flags the event IDs, not the wording.

Run E, what code did not catch: the explanation and finding 1 say the sign-in
was "without multi-factor authentication"; E05 says no multi-factor challenge
was recorded, which is not the same claim. Run E makes no finding of E09, the
02:36 sign-out from the unrecognised device.

Nano has now proposed Insider Threat in 3 of 4 recorded runs. Not established:
why. Neither the classes nor what distinguishes them are defined in the prompt,
and the schema asks for the classification before the findings.

### Changes after runs D and E (uncommitted)

- Every list is bounded: at most 8 findings, 4 cited events per finding, 5
  recommended actions, in the schema sent to both models and enforced again by
  `parseProposal`, which rejects output over a bound. Aimed at the
  `QuotaExceededError`. Not yet shown: that Chrome's `responseConstraint`
  accepts `maxItems`, or that the error stops.
- The schema asks for findings, then the explanation, then the classification.
- Finding types `sign_in` and `sign_out`, each checked against the event's
  action, so claims about ordinary sign-ins and sign-outs no longer have to be
  `other` and escape the check.
- The shared prompt now defines the six classes in one line each, limits the
  explanation to three sentences, and says "a sign-out is not a sign-in".
  Runs from here on are not comparable with runs A to E.

`npm test` 43 of 43, build and lint clean.

**Run F: cloud, changed schema and prompt (my browser, 18:45 WAT).** Requested
and reported `in_cloud`, 9,300 ms, schema valid, Credential Compromise, High,
no citation, time or account problems, 4 of 5 findings supported, 5 actions
(the bound). The output came back in the new order, findings first: the cloud
model accepted `maxItems` and kept the property order. The fifth finding not
supported is E06, typed `other` although `account_created` exists. Not caught
by code: the explanation again says "without multi-factor authentication" (E05:
none recorded) and that the sign-in "is contradicted by the account owner's
statement"; it cites no event IDs, so the explanation rule has nothing to check.

**Runs G, H, I: on-device, changed schema and prompt (owner's Chrome, pasted
page text, about 19:00 WAT).** All online, all `on_device`, all schema valid.

| | G | H | I |
| --- | --- | --- | --- |
| Latency | 68,062 ms | 55,391 ms | 63,751 ms |
| Classification, confidence | Credential Compromise, High | Insider Threat, Medium | Credential Compromise, High |
| Findings (bound is 8) | 8 | 6 | 8 |
| Supported | 8 of 8 | 5 of 6 | 8 of 8 |
| Citation, time and account problems | 1 | 2 | 3 |

What this shows: Chrome accepted `maxItems` and two runs stopped at exactly 8
findings; no `QuotaExceededError` in three runs. Output came findings first.

Caught by code: E06 quoted at 02:20 (it is 02:24) in all three runs; in H, E09
typed `sign_in_from_unrecognised_device` although the claim itself says
"signed out" (unsupported); in I, E09 typed `sign_out` correctly but quoted at
02:20 (it is 02:36); explanations naming E09 (H) and E11 (I).

Not caught: G repeats one finding about E05 three times as `sign_in`, beside
the specific `sign_in_from_unrecognised_device` finding; I repeats E05 once the
same way. Routine events became findings (E01 in H and I, E03 in G and I)
although the prompt says to leave routine activity out. No run made a finding
of E11, the owner's denial; G made none of E09 either. Every run says "without
MFA" or similar where E05 says no challenge was recorded. A finding with a
wrong time still shows "supported by the cited events", and the summary still
reads 8 of 8 supported.

### Changes after runs G, H, I (uncommitted, approved by the owner)

- A third check per finding, repeats: a finding with the same type and the
  same cited events as an earlier one is flagged `repeats finding N`; a
  `sign_in` finding about events a supported `sign_in_from_unrecognised_device`
  finding already cites is flagged as a less specific repeat. A generic finding
  beside an unsupported specific one is not a repeat.
- One verdict per finding: it passes only if it is supported and has no
  citation, time, account or repeat problem. The headline is now "N of M pass
  every check, covering K distinct events"; the page lists the events no
  finding cites, without judging whether they matter.
- MITRE ATT&CK references as metadata in `src/lib/attack.ts`, checked against
  attack.mitre.org (Enterprise, v20) on 2026-11-11, shown only beside findings
  that pass, worded as a reference, not a conclusion, with MITRE's copyright
  notice and a link to its terms on the page. Two mappings only:
  `sign_in_from_unrecognised_device` to T1078 Valid Accounts, `account_created`
  to T1136 Create Account. No technique for a denied read (nothing collected),
  a successful read (not shown to be T1213's information repository), a
  setting change (the type does not record that a defence was weakened; T1562
  now redirects to T1685), ordinary sign-ins and sign-outs, or statements.
- MFA phrase check: deferred by the owner.

Regression tests from runs G and I as returned: run G now shows 4 of 8 passing
over 4 events (was 8 of 8 supported); run I 5 of 8 over 5 events. `npm test`
51 of 51, build and lint clean.

**Run J: cloud, to see the new view (my browser, about 20:00 WAT).** `in_cloud`,
11,461 ms, schema valid, Credential Compromise, High, 5 of 6 findings pass,
covering 5 events. E06 (account created) typed `security_setting_changed`,
caught as unsupported; in run F the cloud model typed E06 `other`. Uncited:
E01 to E04, E10. Explanation again says "without MFA".

### Consent-gated hybrid routing (decided and built 2026-11-11)

Why: the official requirement reads "Using the Firebase AI Logic Hybrid
Inference SDK, your app runs prompts on-device when a local model is available
and falls back to the cloud when it isn't." The page used `ONLY_ON_DEVICE` and
`ONLY_IN_CLOUD`, so it never fell back, and the SDK marks only `PREFER_*`
requests as hybrid (`x-goog-api-client: ... hybrid`; its comment: "ONLY_IN_CLOUD
does not indicate an intention to use hybrid"). Owner's condition: evidence
never reaches the cloud without the analyst's consent.

What the installed SDK (`@firebase/ai` 3.0.0) does, read from
`dist/esm/index.esm.js` and tested in `src/lib/hybrid-sdk.test.ts` against
that build with a stubbed Prompt API and network:

- `PREFER_ON_DEVICE` checks availability again inside `generateContent` and
  calls the cloud if Nano is not "available" at that moment. A check by the
  page beforehand cannot prevent it (the race), so this mode is used only
  after consent.
- `PREFER_ON_DEVICE` does not fall back when Nano fails mid-run; it throws.
- `ONLY_ON_DEVICE` never calls the cloud, but only if the SDK built its
  on-device adapter, which it does only when `LanguageModel` exists as the
  model is created. Without it, `ONLY_ON_DEVICE` goes to the cloud.

Design (`src/lib/hybrid.ts`): the only run without consent is `ONLY_ON_DEVICE`,
refused when there is no adapter. Nano unavailable: explain, ask; on consent
`PREFER_ON_DEVICE` (the SDK's own fallback). Nano fails: explain, ask; on
consent `PREFER_IN_CLOUD`. Direct cloud comparison: asks too, then
`PREFER_IN_CLOUD`. Declining sends nothing. Every result shows the request,
whether consent was given, the SDK mode and `inferenceSource`.

This keeps `ONLY_ON_DEVICE` for the unconsented run, contrary to the first
proposal to drop the `ONLY_*` modes: it is the only mode that closes the race.
Every cloud request uses a `PREFER_*` mode.

Evidence:

- 21 tests (`hybrid.test.ts`, `hybrid-sdk.test.ts`): local run, Nano
  unavailable, no Prompt API, consent given, declined, local failure, and
  availability changing between the page's check and the SDK's ("available"
  then "unavailable" or "downloadable"). No cloud request without consent in
  any case.
- Mutation checks: with `PREFER_ON_DEVICE` as the unconsented mode, both race
  tests fail (the request reaches the stubbed network). Without the
  no-adapter guard, the no-Prompt-API test fails. Both restored.
- Browser (built-in pane, Chrome 152, Nano "downloadable", about 21:40 WAT),
  counting requests to `*.googleapis.com` in the page's resource log:
  Investigate showed the consent panel with 0 requests; Keep on this device:
  "Nothing was sent", 0 requests. Then:

| Run | Path | SDK mode | Source | Latency (ms) | Classification | Passing |
| --- | --- | --- | --- | --- | --- | --- |
| K | Investigate, Nano not downloaded, consent | prefer_on_device | in_cloud | 4,286 | Credential Compromise | 5 of 6 |
| L | Compare in the cloud, consent | prefer_in_cloud | in_cloud | 3,003 | Credential Compromise | 4 of 5 |

  Run K made exactly one request (`firebasevertexai.googleapis.com/.../
  gemini-3.5-flash-lite:generateContent`), after the click. Run L's request
  carried `x-goog-api-client: gl-js/3.0.0 fire/3.0.0 hybrid`.
- **Run M: on-device, owner's Chrome** (read from the owner's screenshot,
  about 22:00 WAT): requested on this device; consent not asked, nothing sent;
  mode `only_on_device`; source `on_device`; 79,384 ms; online throughout;
  schema valid; Credential Compromise, Medium; 5 of 8 findings pass, covering 5
  events; 4 problems: the explanation names E11, which no supported finding
  cites; findings 2 and 8 quote 02:20 against events at other times; finding 7
  repeats finding 1 in a less specific form. Uncited: E02, E04, E10, E11. The
  same failure kinds as runs G and I, caught the same way.
- Runs N and O (built-in pane, after the mobile layout change): cloud after
  consent, `prefer_in_cloud`, `in_cloud`; 6 of 6 and 5 of 5 findings pass
  (O: 3.3 s). Used to check the result view at 375 px, not as measurements.

**Mobile-first layout (2026-11-11).** Base styles are for a phone; from 40rem,
labels and values sit side by side and buttons share a row. Environment,
on-device model, evidence, run details, explanation, findings, actions and
raw output fold away (`<details>`), with a summary line kept visible: Nano
availability, event count, mode, latency and consent, findings passing. The
inference source and the verdict rows stay outside any fold. The event table
became a list, so nothing scrolls sideways at 375 px (checked:
`scrollWidth` = 375). The result scrolls into view when it arrives. A bug found
while checking: in Chrome 152 `scrollIntoView` returns a Promise, and returning
it from an effect crashed the page; fixed. No change to evidence, inference or
verification.

### LANL dataset (decided 2026-11-11, not started)

First real-world evaluation data: LANL "Comprehensive, Multi-Source
Cyber-Security Events" (Kent, 2015), copyright waived by LANL. Official route
only (`csr.lanl.gov/data/cyber1/`, which asks for an email address and intended
use); the Imperial College mirror is not used. Order: red-team file (4.8 KB)
first, then auth (7.2 GB), others only if a case needs them.
GS-03 stays as the regression fixture.

**Red-team file, as found (2026-11-11, 21:00 WAT).** Downloaded by the owner
through the official form, copied to `~/Data/lanl-cyber1/redteam.txt.gz`
(4,858 bytes, sha256 `e8ffba53…a4aff`, gzip header dated 2019-06-06). Format
matches the documentation, "time,user@domain,source computer,destination
computer":

- 749 lines, all 4 fields, no `?`, sorted by time, 150,885 to 2,557,047 s
  (dataset days 2 to 30, so the last 28 days have no red-team events).
- 715 distinct lines. 12 lines repeat (up to 9 times, at the same second).
- 104 users. 722 lines are `@DOM1`. 27 are local accounts (`U8777@C583`), where the domain is the destination computer.
- 4 source computers: C17693 on 701 lines, C22409 on 26, C19932 on 19, C18025 on 3. 301 destinations. No line has source equal to destination.
- Heaviest days: day 9 (273 lines) and day 13 (209).

**How red-team lines relate to auth lines: documented, not yet measured.**
The documentation says they are "specific events taken from the
authentication data". Auth lines have nine fields, including two users
(source and destination); red-team lines have one. The documentation does not
say which auth user the red-team user is, nor how repeated red-team lines
correspond to auth lines. `npm run lanl -- match` measures, for each red-team
line, how many auth lines share its time and computers, and of those how many
name its user as source user or destination user. The match rule
(`source_user`, `destination_user` or `either_user`) is chosen from that
measurement; there is no default.

**Pipeline, prepared, not run on real auth data** (`tools/lanl/`, outside
`src/`, so it cannot enter the page bundle; checked: `dist/` has no LANL
content):

- `auth.ts`: streams `auth.txt.gz` line by line through gunzip. Keeps file
  name, line number and raw line on every record; `?` becomes no value; a
  truncated file throws.
- `case.ts`: label-free selection (time window plus optional computers/users),
  file order, fails above `maxEvents` rather than truncating. Converts to the
  existing `LogEvent` shape with provenance beside each row.
- `redteam.ts`, `evaluate.ts`: ground truth. Labels a built case from its
  preserved raw lines under a chosen rule; compares a model's answer, after
  `verifyProposal`, with the labels. Truth files go to
  `~/Data/lanl-cyber1/truth/`, cases to `cases/`.
- `cli.ts`: `inventory` must run first, on the finished file. It reads it
  whole, hashes it, records ordering and the values that occur. `match` and
  `case` refuse to run without it, or if the file changed since. Every write
  outside the repository; writes inside it are refused.
- Tests on hand-written synthetic fixtures (`tools/lanl/fixtures/`), including
  that nothing in `src/` imports `tools/` and that evidence-building files do
  not import the labels.

**Open before the first LANL case is run** (owner's decisions):

1. Vocabulary. Resolved 2026-11-11, see "LANL vocabulary and relative time".
2. Time. Resolved 2026-11-11, see "LANL vocabulary and relative time".
3. Accounts. Resolved 2026-11-11, see "LANL identity check" below.
4. Size. On-device input is about 9,216 tokens; GS-03's 11 events fit. Each
   LANL row is longer. The case limit for Nano has to be measured, not assumed.
5. No-incident class, for control cases (proposed earlier, not approved).

### Red-team matching measured (2026-11-11, 23:31 to 23:42 WAT)

`npm run lanl -- match`, unchanged code, auth sha256 `eee54f2e…f53d`; stopped
after the last red-team time (file sorted). Output (outside the repository):
`~/Data/lanl-cyber1/redteam-match.json`. Aggregates only here.

- 735 of 749 red-team lines (98.1%) have at least one auth line with the same
  time, source computer, destination computer and user.
- Source-user and destination-user agreement are identical on every line: no
  matched red-team line distinguishes the two. The three candidate rules
  (`source_user`, `destination_user`, `either_user`) give the same counts here.
- 731 lines match exactly one auth line; 4 match two (three auth lines share
  their time and computers, two of them the user).
- 14 lines (all `@DOM1` accounts; 12 on day 9, 2 on day 13) match no auth line
  at that second between those computers. Not investigated; no tolerance
  added.
- The red-team file's 12 repeated lines (34 extra copies) are not one per auth
  line: 11 of them match a single auth line, one matches two. Labels are
  therefore counted per auth record, as `labelCase` does, never per red-team
  line.
- All 27 local-account lines (`user@computer`) match exactly one auth line.

### Red-team matching: record level, rule locked (2026-11-11, 23:47 to 23:58 WAT)

Owner's decision: rule `either_user`, keeping per match which user field
matched (`source`, `destination`, `both`). `labelCase` now records it for
every label; `match` records every candidate auth line per red-team line.

Record-level result on the real file (same sha256):

- On 0 of 749 red-team lines do the source-user and destination-user rules
  pick different auth lines. The rules are equivalent here record by record,
  not only in totals.
- Every one of the 739 line-to-record matches is `both`: in each matched auth
  record the source user and the destination user are both the red-team user.
- 42 more auth lines share a red-team line's time and computers but name
  another user; they are not labelled.
- **702 distinct auth records are labelled.** The earlier "about 739" counted
  red-team lines, including repeats that point at the same record.
- 14 red-team lines match no auth record (unchanged).

### Nano evidence-size limit measured, selector frozen (2026-11-12)

Owner's decision: `MAX_EVENTS` = 50, keeping the 10% margin. Figures, method
and limitations are in `docs/SELECTOR_SPEC.md`, which is now frozen.

- Chrome 156, context window 9,216 tokens, system prompt 311, output reserve
  766, about 135 tokens per event. 50 events total 7,825 (fits under 8,294);
  55 total 8,501 (does not).
- Real runs on synthetic evidence: 20 events in 41.9 s, 50 events in 53.9 s;
  both answers valid with 8 findings; context afterwards 3,652 and 7,706; no
  overflow.
- `measureContextUsage` does not count the response schema. The real runs
  show about 190 tokens for it; with that, 50 events total 8,015 and still fit.
- The script first failed with `TypeError` on every measurement: it called
  `measureInputUsage`, which the Prompt API now gives only to extensions. Web
  pages have `measureContextUsage`, `contextUsage` and `contextWindow`. That
  first attempt's results are not used.
- Real records were compared with the synthetic ones by prompt length only
  (2,000,000 records from day 8): 18,400 to 19,320 characters per 50 records,
  against 18,851 synthetic.

No candidate scan, case or LANL inference has run.

### Candidate scan run (2026-11-12, 08:53 to 09:19 WAT)

`npm run lanl -- candidates` (`tools/lanl/candidates.ts`, 16 tests), by the
frozen rule, once. It reads `auth.txt.gz` only; the red-team file and the
match file were not opened. Result: `~/Data/lanl-cyber1/candidates.json`.

- Integrity: sha256 checked before the scan (4 s) and again on the bytes
  scanned; 1,051,430,459 lines, as in the inventory. The command refuses to
  overwrite its result.
- Before the real run, the command's result on a 1,188,809-line synthetic
  file equalled a separate brute-force implementation of the specification
  (pairs, window counts, score distribution, top 10, control).
- 808,610 distinct (account, destination computer) pairs in the file; 397,036
  formed in the excluded hours 0 to 167.
- From hour 168: 11,435,406 windows with at least one record. 11,296,396 have
  score 0. Of the 139,010 with a score, 1,751 have fewer than 5 records,
  107,281 more than 50, and **29,978 are eligible**.
- Eligible windows by score: 22,075 at 1; 5,745 at 2; 1,073 at 3; 544 at 4;
  196 at 5; 395 from 6 to 30. One window has the top score, 30, so no
  tie-break decided rank 1.
- **Evaluation case (rank 1):** C17693, hour 211 (Day 9 · elapsed 19:00:00),
  43 records, all outgoing network logons (23 Success, 20 Fail), 30 first-seen
  pairs, all user accounts, 36 destination computers, 19 accounts.
- **Control:** C17693, hour 658 (Day 28 · elapsed 10:00:00), score 0, **7
  records, 36 fewer than the evaluation case.** C17693 has only 12 score-0
  hours from hour 168 on; this is the closest in size. The rule gives it; it
  is not changed.
- The top 10 are two computers: C17693 (ranks 1, 5, 7, 8, 10; network logons,
  3 to 19 accounts, 16 to 36 destinations) and C4832 (ranks 2, 3, 4, 6, 9;
  remote interactive logons, 40 to 54 accounts, 11 to 13 destinations).
- C17693 is the computer already recorded above as the source on 701 of 749
  red-team lines, known when the rule was designed. Which records in the two
  windows are labelled is not known: labels are applied only after both case
  files exist.
- Resources: 26.3 minutes for the scan, 1,726 CPU-seconds, peak memory about
  1.0 GiB resident (975 MiB sampled; 992 MiB reported by `time -l`).
- Two readings of the specification, made before the run: an hour in which a
  computer has no record is not a window; the control has no size bounds of
  its own, only "closest".

No case has been built and no model has seen LANL data.

### LANL cases built (2026-11-12, 09:26 to 09:39 WAT)

Owner's approval: both cases exactly as selected; the control is not
size-matched and is disclosed as such; no post-hoc size-matched control in
this evaluation (a later one would be its own, separately specified
experiment). The selector stays described as label-informed in design and
label-blind in execution; C17693's known red-team role makes that disclosure
essential.

`npm run lanl -- case` now checks the auth file's sha256 before building and
writes it into the case's `source`. Files in `~/Data/lanl-cyber1/cases/`:

| Case | Window | Events | File lines | Case file sha256 |
| --- | --- | --- | --- | --- |
| `lanl-c17693-h211` (evaluation) | 759601–763200 s, Day 9 · 19:00:00 to 19:59:59 | 43 | 149,269,194 to 149,849,739 | `1e06b8e2…5c09` |
| `lanl-c17693-h658` (control) | 2368801–2372400 s, Day 28 · 10:00:00 to 10:59:59 | 7 | 459,113,915 to 459,966,703 | `d8f6cc66…b2f7` |

Case ids name the computer and hour only, not the role.

- Counts equal the scan's (43, 7). An independent extraction with
  `gzip -dc | awk` over the same window found the same file lines and raw
  records in the same order.
- Checked per event by a separate script: id sequence, Day and elapsed time
  recomputed from the raw time, actor, action, target, outcome and logon type
  from the raw fields, every raw field in the detail, time inside the window,
  C17693 as source or destination, provenance file, and only the existing
  evidence and provenance keys. No problems.
- Model-visible text (evidence rows and model notes) contains none of:
  red team, label, truth, attack, compromise, malicious, suspicious,
  evaluation, control.
- Both cases: every event is an NTLM network logon from C17693, source user
  equal to destination user. Evaluation: 19 accounts (U3635@DOM1 on 14
  events), 36 destinations, 23 success and 20 denied. Control: 3 accounts
  (U66@DOM1 on 5), 7 destinations, 6 success and 1 denied.
- Prompt size in the measurement script's row format: 15,949 characters for
  43 events and 2,720 for 7, against 18,851 for the 50 synthetic events
  measured to fit.
- **Found while checking:** 3 evaluation events name `U10582@?` (domain not
  recorded). The LANL identity check reads no identity from `U10582@?`, so a
  finding naming bare `U10582` would be rejected though the evidence names it,
  and a finding naming `U10582@?` would not be checked at all. Not changed;
  for the owner's decision before any baseline or model run.

No labels applied, no baseline run, no model has seen LANL data.

### LANL identity with an unrecorded domain (owner's decision, built 2026-11-12)

Found in the evaluation case (`U10582@?` on 3 events), fixed before any
baseline or model run. `?` is a domain LANL did not record: kept exactly as
written, never inferred, never a wildcard. `src/lib/verify.ts` now reads
`U…@?` as a principal; as for any principal, its bare name is vouched for
too, and a principal written in full must match in full.

| A finding names | Cited event has `U10582@?` |
| --- | --- |
| `U10582@?` | accepted |
| `U10582` | accepted |
| `U10582@DOM1` | rejected: the domain is not in the evidence |
| an unrelated account | rejected |

Also tested: `U900748@?` is rejected when the evidence has `U900748@DOM1`
(a recorded domain is not "?"), and a bare name is checked against the cited
events only. 7 new tests; with the old pattern restored, 5 of them fail.
Accepting the bare name accepts no other domain-qualified form of it.

### Deterministic baseline run (2026-11-12, 22:05 to 22:16 WAT)

`npm run lanl -- baseline --case <file>` (`tools/lanl/baseline.ts`, 4
tests): the frozen rule, flagging case events that formed a first-seen
(account, destination computer) pair, counting from line 1. Reads no labels
(isolation test). Checks the auth file's sha256, that the case was built from
it, and that each case event's line in the file is the record the case
preserved. Run once; results in `~/Data/lanl-cyber1/baseline/`.

| Case | Flagged | Of which success / denied | Lines scanned |
| --- | --- | --- | --- |
| `lanl-c17693-h211` (evaluation) | 30 of 43 | 12 / 18 | 149,849,739 |
| `lanl-c17693-h658` (control) | 0 of 7 | 0 / 0 | 459,966,703 |

Both equal the scan's scores (30 and 0), computed by separate code. Flagged
events in the evaluation case name 16 distinct accounts.

Known before any model run, from the LANL finding types decided on
2026-11-11: a `logon` finding is supported only by successful logons, and an
`other` finding never passes. So no verified model finding can cover a
denied event; 20 of the 43 events, 18 of the 30 the baseline flags, are
denied. Raised for the owner's decision before Nano runs.

No labels applied, no model has seen LANL data.

### Evaluation protocol decided; `denied_logon`, frozen prompt, case-file loader (2026-11-12, to 22:55 WAT)

Owner's decisions, in the order they are to be carried out: (1) `denied_logon`
and tests; (2) freeze and hash the LANL prompt; (3) build and test the
case-file loader; (4) run the 43-event case on Nano; (5) run the 7-event
control on Nano; (6) keep both raw run records; (7) only then apply ground
truth. No cloud fallback in these runs: if Nano fails, the failure is
recorded. Nothing is tuned after results are seen. The owner also set the win
criteria (`docs/HACKATHON_MVP_SCOPE.md`, section 4). Steps 1 to 3 are done;
4 to 7 are not.

**1. `denied_logon`.** A finding type for LANL cases, beside `logon` and
`other` (`LANL_FINDING_TYPES` in `src/lib/schema.ts`). Its rule in
`src/lib/verify.ts`: every cited event is a logon whose recorded outcome is
denied. A successful logon cited under it is contradicted; a logoff or a
ticket is unsupported. It says an attempt was refused and nothing more. Code
does not read a finding's wording, so it cannot check that a claim avoids
implying access, compromise or an attack; the prompt and a note under each
such finding say it, and that is not presented as verified. GS-03's types are
unchanged.

**2. Frozen LANL system prompt.** `authSystemPrompt([LANL_TIME_NOTE])` in
`src/lib/prompts.ts`. 1,643 characters, SHA-256
`4439ce200e3d17fa250e425ce08a8e15c48220667d29f98034f8c36bfc46d6e7`, pinned
word for word by `tools/lanl/prompt.test.ts`. It shares its task and
classification sentences with the GS-03 prompt, and names no pattern the
selector or the baseline looks for. Exact text (one line, spaces between
sentences; wrapped here):

```
You assist a security analyst. You are given a list of authentication
events from one organisation, each with an ID. Use only the events given.
First list your findings, at most 8, about the events that bear on whether
an account was misused; leave out routine activity. Every finding must cite
the IDs of the events that support it, and must quote times exactly as the
events give them. Give each finding the type that matches what its cited
events show, or "other" if no type fits, and cite only the events that
directly show it. "logon": an account successfully authenticated to a
computer; it is not a person signing in and not by itself an attack.
"denied_logon": an authentication to a computer that was denied. A logoff
or a Kerberos ticket is not a logon. Then explain in at most three
sentences, then classify. Credential Compromise: someone other than the
owner used an account. Insider Threat: a trusted person misused access they
legitimately hold. Phishing: a deceptive message was used to gain access.
Ransomware: data was encrypted for extortion. Data Exfiltration: data was
copied out of the organisation. Do not say that data was accessed or taken,
or that a person is at fault, unless an event says so. If the events are
not enough to decide, choose Undetermined. Recommend at most 5 actions. You
make a proposal. The analyst decides. Times are relative dataset
timestamps: "Day N · elapsed HH:MM:SS" counts from the dataset's undisclosed
start. They are not local clock times and cannot show whether an event
happened at night or outside working hours. Order events by the numeric
dataset time given in each event (seconds).
```

What each run must show in its record, computed from the case files as they
are on disk:

| Case | Case file SHA-256 | User prompt SHA-256 | User prompt characters |
| --- | --- | --- | --- |
| `lanl-c17693-h211` | `1e06b8e2df7c6301166727a51550f71a29a921b6304dcb428dc68f1c3d1a5c09` | `e6fb5306f11db11d8b6bc65e3a4bce517dcf0798a4028c17fa488eb43592227f` | 15,949 |
| `lanl-c17693-h658` | `d8f6cc668d5b595a0431fa37cbf2991754d2daeb8a62160b63f4daf0b638b2f7` | `57f8471f604ef278b2ed9f271169651020c085bd7a23a665bd297f4b1cb20368` | 2,720 |

Both files pass the loader's checks, and both give the frozen system prompt.
The GS-03 prompt moved into `src/lib/prompts.ts` unchanged: SHA-256
`50ad17ee4825842169b963b32289b11c0cfab5bf0a2301fb9ba2edf9d98009a8`, equal to
the hash of the text the page used before (`src/lib/prompts.test.ts`).

**3. Case-file loader and run records.** Format and limits:
`docs/CASE_FILE.md`.

- `src/lib/casefile.ts` reads a file the analyst picks from disk, in the page.
  It is refused whole, every reason listed, if anything is missing, malformed
  or not named by the format (a field holding labels, say). Nothing is
  repaired or dropped. Limits: 2 MB, 50 events, 5 model notes.
- Only evidence rows and the file's model notes reach a model. Each event's
  source file, line and original record stay beside it on the page.
- **The cloud is off for a case file** until the analyst ticks a box for that
  case, and consent is still asked before each send. With it off, the run is
  `ONLY_ON_DEVICE`; if Nano is missing or fails, the run fails, says nothing
  was sent, and offers a record of the failure. No consent prompt, no
  fallback.
- **Run record** (`src/lib/record.ts`, format `project-studio.run-record/1`),
  built in the page and saved as a download: case id, file name and SHA-256;
  system and user prompt with their SHA-256; outcome; where it ran, as the SDK
  reported it; model; whether the cloud was allowed and consented to; latency
  and times; browser; raw output; the full verification result. The record
  contains the evidence, so it is as sensitive as the case.
- Each result states where it ran: on this device, on this device after
  consent, in the cloud after consent, or not reported.
- `npm run lanl -- evaluate --record <file>` takes a run record and refuses
  it unless its case hash is the case file's, its prompts are the ones the
  case produces, and the run completed.

Evidence. 210 of 210 tests in 14 files; `tsc -b` and `eslint .` clean. New
or extended: `casefile.test.ts` (16), `record.test.ts` (9), `prompts.test.ts`
(6), `tools/lanl/prompt.test.ts` (3), `hybrid-sdk.test.ts` (15: the case's
instruction and schema reach the Prompt API and the cloud request),
`evaluate.test.ts` (22), `verify.test.ts` (83). In the app's browser pane
(no Nano there), with an 8-event synthetic case made from the test fixtures:

| Check | Result |
| --- | --- |
| File with an added `truth` field and an invalid outcome | Refused, both reasons listed; the open case unchanged |
| File that is not UTF-8 | Refused |
| Valid file | Opened; SHA-256 shown equals `shasum`; original record shown per event |
| Run on this device, cloud off, Nano not available | No consent prompt; no request left localhost; failure record with `location: none`, `cloudAllowed: false`, no output |
| Box ticked, consent prompt shown, box unticked | Prompt withdrawn; nothing sent |
| Box ticked, consent given | Ran in the cloud in 3.1 s; record complete; 5 of 5 findings pass, one of them `denied_logon` |

Not tested yet: an on-device run of a case file (needs the owner's Chrome),
the new elements at phone width, and the browser's reported sampling
defaults (absent in the pane).

Disclosed: the frozen prompt has run once in the cloud, on the 8 synthetic
rows above, to test the loader. That is not LANL data and not an evaluation
run, and the prompt was not changed after it.

No labels applied, no model has seen LANL data.

### LANL evaluation: Nano runs, labels, baseline comparison (2026-11-12, 23:02 to 23:15 WAT)

Steps 4 to 7 of the owner's order. One Nano run per case, through the
case-file loader, cloud off, run by the owner in their Chrome. Both completed;
neither was repeated. Labels were applied only after both records were saved.

**Records.** Originals in the owner's Downloads folder; byte-identical
read-only copies in `~/Data/lanl-cyber1/runs/`.

| Case | Record SHA-256 | Where | Latency | Started (UTC) |
| --- | --- | --- | --- | --- |
| `lanl-c17693-h211` (43 events) | `1463b840…c5a` | on-device, `only_on_device`, no consent | 100.2 s | 22:02:28 |
| `lanl-c17693-h658` (7 events) | `dd6ead01…468b` | on-device, `only_on_device`, no consent | 42.4 s | 22:04:55 |

Both records pass `recordedRun`: the case hash is the file's on disk, and
the system and user prompts are byte-identical to what the case produces
(system `4439ce20…d6e7`, user `e6fb5306…` and `57f8471f…`). Verifying the
saved raw output again gives exactly the recorded verification.

**Prompt wording, checked.** The records hold `"denied_logon": an
authentication to a computer that was denied.` That is the wording the owner
approved at 21:20 UTC. A different sentence ("a logon to a computer that was
denied; it does not show that access was obtained") was proposed afterwards
at 21:23 UTC and never approved: the owner's next message set those proposals
aside. The approved text was frozen, pinned by test, and recorded here before
the runs. The verification rule covers logons only; both cases contain only
logons, so the narrower rule changes nothing here.

**Environment: a user-agent override, cause unknown.** Both records report
Chrome 156 with an Android 16 / Pixel 10 user agent, Nano `available`,
sampling defaults not reported. The owner ran them in desktop Chrome on the
Mac and did not knowingly enable device emulation; the string can only come
from an override (see "User agent (investigated 2026-11-13)" under the
synthetic demonstration case). Where inference ran is unaffected.

**What Nano proposed, as checked by code**

| | Evaluation (43) | Control (7) |
| --- | --- | --- |
| Findings | 8 | 6 |
| Pass every check | 1 (`denied_logon` on E01) | 6 (`logon`, one event each) |
| Failed a citation, time or account check | 5 | 0 |
| Type `other`, no detected problem (never passes) | 2 | 0 |
| Cited event IDs that do not exist | E48, E49, E50 | none |
| Events covered by a passing finding | 1 | 6 |
| Events cited by no finding | 31 | 1 (E05, the only denied event) |
| Classification (proposal, not checked) | Credential Compromise, Medium | Undetermined, Medium |

Evaluation-case problems, all caught by code: three invented event IDs;
accounts named that are not in the cited events (three findings); times not
in the cited events (two findings); a successful logon cited as a
`denied_logon` (contradicted).

**What code did not catch.** Finding 2 says an account with only denied logons
had "a successful logon"; it cites a successful logon by another account. It
is held back only because its type is `other`. The explanation says another
account had failed "then successful" logons, which no event shows: all of
that account's events are denied. That false statement leads into the
proposed classification, Credential Compromise. Code does not read the
explanation for claims of fact, and does not check the classification; both
are shown as the model's proposal. This is a known limit
(`Decisions` below) and now an observed one.

**Labels** (`npm run lanl -- label --rule either_user`, applied 23:11 WAT)

| Case | Labelled events | Of which successful / denied |
| --- | --- | --- |
| Evaluation | 21 of 43 | 21 / 0 (of 23 successful events) |
| Control | 3 of 7 | 3 / 0 (of 6 successful events) |

**The control is not a negative control.** It was chosen as the closest-sized
window with baseline score 0, by a rule that read no labels; 3 of its 7 events
are labelled. Not replaced (owner's rule: no post-hoc changes). Every labelled
event in both cases is a successful logon.

**Model and baseline against the labels**

| Case | Measure | Nano (passing findings) | Baseline (first-seen pair) |
| --- | --- | --- | --- |
| Evaluation | Labelled events covered | **0 of 21** | **10 of 21** |
| | Unlabelled events flagged | 1 (denied) | 20 (18 denied, 2 successful) |
| | On successful events only: labelled / unlabelled flagged | 0 / 0 | 10 / 2 |
| | Labelled events cited by any finding, passing or not | 3 | n/a |
| Control | Labelled events covered | 3 of 3 | 0 of 3 |
| | Unlabelled events flagged | 3 (successful) | 0 |

Reading, stated plainly:

- On the evaluation case the **deterministic baseline did better than the
  model.** Nano's findings went to the denied logons, all unlabelled; the
  labelled activity was 21 of the 23 successful logons, and no passing
  finding covers one.
- On the control, Nano's 3 of 3 comes from listing all six successful logons,
  one finding each, which the prompt asked it not to do ("leave out routine
  activity"). That is enumeration, not discrimination: half of what it
  listed is unlabelled.
- One run per case on one machine. Observations, not rates. The cases differ
  in size (43 against 7), so differences between them are not attributed to
  the model alone. The selector is label-informed in design and label-blind
  in execution; C17693 was known as the main red-team source.
- What the result supports: the verification layer stopped five of seven
  failing evaluation-case findings on concrete, checkable errors and showed
  none of them as supported. What it does not support: that Nano, with this
  prompt, finds red-team activity in LANL authentication data.

Files: `~/Data/lanl-cyber1/truth/`, `~/Data/lanl-cyber1/evaluation/`. Nothing
from LANL went to the cloud. The prompt, cases, selector and rules were not
changed after any output was seen.

### Investigation report and export (owner's approval, built 2026-11-12 to 23:35 WAT)

Goal, in the owner's words: "a report an analyst can trust even when the AI
is wrong." Nothing in the LANL prompt, cases, labels, selector or results was
changed, and no LANL case was run again.

- **One structure, two renderings.** `src/lib/report.ts` builds a `Report`
  from a completed run's record and the case's evidence. The page
  (`src/ReportView.tsx`) and the exported file (`reportHtml`) render it,
  section for section. Before, the page read the verification directly and
  there was no human-readable export.
- **Four verdicts**, decided by code from the existing checks (no check was
  changed):

  | Verdict | When |
  | --- | --- |
  | Verified | Passes every check |
  | Contradicted | A cited event records the opposite of what the type states; other failed checks are listed too |
  | Rejected | Any other failed check: an event that does not exist, a time or account not in the cited events, the wrong kind of event, a repeat. Includes type `other` when one of those also failed |
  | Unchecked | Type `other` with no failed check. Never counted as verified |

  Every finding that is not verified lists its reasons. This fixes a
  confusing line on the old page: a finding with a wrong time but the right
  kind of event read "Does not pass: supported by the cited events".
  Mapped by hand from the evaluation run's recorded verification (the report
  code was not run on LANL data), its eight findings would read: 1 verified,
  4 rejected, 1 contradicted, 2 unchecked.
- **Evidence under each finding.** The cited events with their original
  records, and the cited IDs that do not exist.
- **Uncited events in full**, not as a list of IDs. If the output does not
  parse, every event is uncited and the report says so.
- **The model's words are labelled as the model's.** The explanation,
  classification, confidence and recommended actions sit under "The model's
  proposal: not verified", with a note that code checks only the events,
  times and accounts they name, not what they claim. The first LANL run
  showed why: its explanation stated something no event shows.
- **Export.** One self-contained HTML file
  (`<case>.<where>.<time>.report.html`): no script, no external resource, and
  a Content-Security-Policy forbidding both. Every value from the evidence,
  the case file or the model is HTML-escaped. It holds the summary, the
  proposal, every finding, uncited events, actions, how it ran with hashes,
  all evidence with original records, the raw output and the limits of
  verification. It prints to PDF from the browser.

Evidence. 244 of 244 tests in 16 files; `tsc -b`, `eslint .` and
`npm run build` clean; test fixtures are not in the bundle. New:
`src/lib/report.test.ts` (29) and `src/ReportView.test.tsx` (5, the page
rendered to markup), on synthetic events (`src/lib/report.fixtures.ts`)
reproducing each failure kind of the LANL run. They cover: one verdict per
finding; no finding Verified when any check fails (missing event, time,
account, computer, wrong kind of event, no citation, repeat); contradicted
both ways; explanation problems kept apart from verdicts; every reason,
finding, uncited event and original record present on the page and in the
file; unreadable output; escaping of hostile evidence, original records,
case name and model text; no script; the proposal labelled as the model's;
the report's own wording never saying an attack occurred. In the browser pane, with
the 8-event synthetic case only:

| Check | Result |
| --- | --- |
| On-device run, cloud off, Nano not downloaded | Fails, nothing sent, no report, failure record offered |
| Cloud allowed, consent given | Ran in the cloud; report shows 1 verified finding (E06, `denied_logon`) and 7 uncited events in full |
| Export | `synthetic-sample.cloud.….report.html`, `text/html`, 19 KB: 1 verdict badge, the 7 uncited events, all 8 events in the appendix, 16 original records, no script, no external reference |
| A sample export with all four verdicts (synthetic events, written proposal) | Rendered in the pane: each verdict labelled in words and colour, every reason listed |
| Phone width (375 px) | No horizontal scroll |

Disclosed: that browser check sent the synthetic case to the cloud once more,
after consent, with the frozen prompt. Synthetic data, not LANL, and not an
evaluation run.

Final review before commit (owner's request), three issues found and fixed:
the page lacked the export's "All evidence", source, citation and limits
sections, so "section for section" was not yet true; on unreadable output
neither rendering listed the uncited events; and the page, identity
mismatches and repeats had no test. Re-checked: the four verdicts are
mutually exclusive (one function, fixed priority); Verified requires
`passes`, which requires supported events and no problem at the finding;
every interpolated value in the file from the evidence, case file, SDK or
model is escaped; no change to `verify.ts`, the prompts, `tools/lanl/`, the
LANL cases, labels, baseline or results (file times and hashes).

Known limits. Code still does not read a claim's wording, the explanation's
claims of fact, or the classification; the report says so in three places.
The report covers completed runs; a failed run has its run record only. The
report is in English only.

### Synthetic demonstration case (owner's request, built 2026-11-12 to 23:50 WAT)

A one-click demo case for a judge's first run: **Load demo case (synthetic)**
opens `src/data/demo-case.json` through the same loader and checks as any
case file. 18 authentication events at Goldshadow Finance, a fictional
organisation, with Windows-style original records (event IDs 4624, 4625,
4634, 4768, 4769, 4800, 4801). Labelled synthetic beside the case, at the top
of the report and in the exported file; a real case file never carries that
label. As synthetic data it allows the cloud, like the built-in case, and
every send still waits for consent. LANL data, prompts, cases, labels and
results were not touched.

**What the evidence offers, and what it cannot promise.** The evidence gives a
model the chance to be right and to be wrong, and the checks a way to tell:
three denied logons by `fin-clerk-04` from an unfamiliar workstation, then a
success from it a minute later (Verified if described as they are;
Contradicted if the success is called denied); Kerberos tickets and a logoff
by the same account (Rejected if called logons); a near-identical account,
`fin-clerk-14`, denied from the same workstation (Rejected if attributed to
`fin-clerk-04`); events minutes apart (Rejected on a misquoted time); a
pattern no type checks (Unchecked as `other`); and routine admin, HR and
backup activity (uncited). Which verdicts a run gets depends on the model's
answer, so the claim is only that the evidence lets the checks reach each
one: `src/data/demo-case.test.ts` shows it with written proposals (not model
output), 10 cases across all four verdicts.

Evidence. 258 of 258 tests in 17 files; `tsc -b`, `eslint .` and the build
clean. In the browser pane (no Nano), with the demo case only:

| Check | Result |
| --- | --- |
| One click | Case opened, synthetic notice shown, SHA-256 on the page equals the file's (`ed97a731…8112`) |
| Investigate on this device | Nano not downloaded, so the page asked before sending; "Keep on this device" sent nothing (no request to Google APIs) |
| Investigate in the cloud, consent given | `gemini-3.5-flash-lite`: 3 findings, **all Verified** (two `denied_logon`, one `logon`), 13 of 18 events uncited, classification Undetermined, Low |
| Export | Synthetic notice present; 3 verdict badges; 36 original records (5 cited, 13 uncited, 18 in the appendix); no script |
| Phone width (375 px) | No horizontal scroll |

So the one live run produced no Rejected, Contradicted or Unchecked finding:
the cloud model described the evidence correctly. Disclosed: one more cloud
call on synthetic data, not an evaluation run.

**On-device run (owner's Chrome, 2026-11-12 23:03 UTC).** Record
`demo-goldshadow-auth.on-device.20261112T230323Z.run.json` (SHA-256
`56ab307e…`), in the owner's Downloads folder. Gemini Nano, `only_on_device`,
no consent, 45.1 s. Case hash and both prompts match the demo case; verifying
the saved output again gives exactly the recorded result. Not repeated.

| | Result |
| --- | --- |
| Findings | 8: **5 Verified** (`denied_logon` on E06, E07, E08, E09, E16), **3 Unchecked** (`other` on E10, the success; E12 and E15, logoffs) |
| Rejected / Contradicted | 0 / 0 |
| Uncited | 10 of 18 (E01 to E05, E11, E13, E14, E17, E18) |
| Classification (proposal) | Credential Compromise, Medium |

What it shows. Nano copied each event's detail into its claims and named no
account, so no citation, time or account check had anything to catch. Its
findings hold up against their events, but its explanation goes beyond them:
it calls the failures "an attacker systematically testing passwords" and
counts the backup account's restricted logon (E16) as "further supporting
potential malicious activity", and proposes Credential Compromise. None of
that is checked by code; the report shows it under "The model's proposal:
not verified". It also listed two logoffs, against "leave out routine
activity". So across both live runs on this case (cloud and Nano), no finding
was Rejected or Contradicted; the gap this run shows is between verified
findings and an unverified conclusion.

**User agent (investigated 2026-11-13).** All three on-device records (both
LANL runs and this one) report
`Mozilla/5.0 (Linux; Android 16; Pixel 10) … Chrome/156.0.0.0 Mobile Safari/537.36`.
The owner reports running them in desktop Chrome on the Mac, without enabling
device emulation. Findings:

- The string cannot come from a real phone. Chrome on Android sends a reduced
  user agent with a fixed `Android 10; K`, never the model name; a named
  device with a `.0.0.0` version is what an emulation preset writes. A phone
  also could not reach this dev server, which listens on localhost only.
- It is not this app's browser pane: in phone mode that reports
  `Android 14; Pixel 8 … Chrome/152`, and has no Nano.
- So a user-agent override was active in the owner's Chrome tab during all
  three runs: DevTools device mode or its "Network conditions" user-agent
  setting (both act only while DevTools is open, and the device-mode toggle
  is remembered between sessions), or an extension. Which one is not known.
- What it does not change: the SDK reported `on_device` in `ONLY_ON_DEVICE`
  mode with no consent, so where inference ran is as recorded. What it does
  change: the records' `userAgent` describes the override, not the machine.

Recorded environment for the three runs: Mac (owner's statement); Chrome 156
(version from the user agent; the override template carries the real major
version, unconfirmed independently); device emulation not knowingly enabled,
but a user-agent override was active, cause unknown; Gemini Nano on-device;
cloud not used. To be resolved before the next recorded demonstration.

### Analyst-authored worked example and free-tier consent disclosure (owner's approval, built 2026-11-14)

Why: across both live runs on the demo case (cloud and Nano), no finding was
Rejected or Contradicted, so a judge might never see the checks catch a
claim. The worked example shows all four outcomes without pretending a model
produced them.

- **Analyst-authored worked example (no AI)**, its own button. It opens the
  demo case and checks a proposal the Project Studio team wrote
  (`src/data/worked-example.ts`), seven findings: two Verified (the denied
  logons; the success after them), one Contradicted (that success called
  denied), three Rejected (a Kerberos ticket called a logon; a denial of
  `fin-clerk-14` attributed to `fin-clerk-04`; an event, E21, not in the
  evidence) and one Unchecked (the overall pattern, as `other`). 12 of 18
  events stay uncited.
- **Same code.** `buildWorkedExample` runs `verifyProposal` and the same
  report assembly as `buildReport`; a test checks that its findings,
  verdicts, reasons, uncited events and proposal equal those of the same text
  in a model run record.
- **Never presented as a model result.** The report carries
  `author: 'analyst'` and no run. Page and export say "No model ran" at the
  top, label every claim and the proposal "written by the Project Studio
  team", show "How it was made" (no model, nothing sent) instead of "How it
  ran", and offer no run record. Export title "Worked example
  (analyst-authored, no model ran)", file name
  `demo-goldshadow-auth.analyst-authored-example.report.html`. A model run's
  report carries none of these labels. Starting a real run removes the
  example from the page. No run record is made, so it cannot reach the LANL
  evaluation tools.
- **Consent disclosure.** Before every send to the cloud the prompt now says:
  "This app uses the free tier of the Gemini Developer API. Under Google's
  terms for it, Google may use what you send to improve its products, and
  human reviewers may read it. Do not send sensitive, confidential or
  personal information: use synthetic data, such as the demo case.", with a
  link to the Gemini API terms (`CLOUD_DATA_TERMS` in `src/lib/hybrid.ts`;
  `docs/DEPLOYMENT_READINESS.md`).
- The synthetic note no longer says "this run", since the example is not one.

Evidence. 267 of 267 tests in 18 files before the review (9 new in
`src/data/worked-example.test.ts`, 1 in `src/lib/hybrid.test.ts`); `tsc -b`,
`eslint .` and the build clean. In the browser pane: the button opened the
example with the demo case; verdicts Verified, Verified, Contradicted,
Rejected, Rejected, Rejected, Unchecked, each with its reason; no run-record
button; no request to Google. Export: the analyst-authored file name and
title, "No model ran", seven verdict badges, none of the model labels, no
script. Pressing "Investigate on this device" removed the example and,
with Nano not downloaded, showed the consent prompt with the disclosure and
the terms link; "Keep on this device" sent nothing. 375 px: no horizontal
scroll. No model call was made while building it.

Final review before commit (owner's three requirements):

- **Separation.** In `src/App.tsx` a run record is built only after a model
  returns or fails (`finish`, `failed`); the worked-example path sets a result
  with no record, and the report view then offers none. The LANL evaluation
  reads only run records or a model's raw output for a LANL case. Labels come
  from each report's own `author`; nothing is shared between reports. Every
  run starts by clearing the result. Tests: no run and no record; a model
  report built right after the example carries none of its labels, on the
  page or in the file.
- **Causes.** Changing each failing finding in only the thing the check
  objects to makes it pass: E21 replaced by an existing denied logon of that
  account (E08); `fin-clerk-04` replaced by `fin-clerk-14`, the account E09
  records; `denied_logon` on E10 replaced by `logon`. So E21 fails because it
  is not in the evidence, and the misattribution because E09 is another
  account.
- **Consent every time.** The router keeps no memory of consent: every cloud
  request returns "needs consent", and the only send is the Send button's
  handler. Tests: after a consented send, the next request asks again and
  sends nothing. In the browser, on the demo case: asked and declined (0
  model requests); asked again and sent (1 request, report with model labels
  and a run-record button, no example labels); asked again after that send,
  declined (still 1). That was one more cloud call on synthetic data.

273 of 273 tests in 18 files after the review (6 added).

### LANL logons, logoffs and finding types (owner's decisions, built 2026-11-11)

Why: 80% of LANL logons are Network, 0.2% Interactive. Calling every LogOn a
"sign-in" claimed a person logged in. Renaming alone would have left no
finding type able to rest on a logon, so the evaluation could count nothing.

- Evidence: LogOn is named by its logon type ("network logon", "interactive
  logon", "remote interactive logon", "service logon", "batch logon",
  "unlock logon", "new-credentials logon", "network cleartext logon", "cached
  interactive logon"; "logon, type not recorded" when `?`). Every LANL event
  carries `logonType` (exact value, or "not recorded"). An unknown logon type
  is refused with its line. LogOff is "logoff". AuthMap, ScreenLock and
  ScreenUnlock are kept under their own names.
- Finding types are source-specific. GS-03 keeps exactly its nine; its model
  schema is pinned to the string sent before this change (test; mutation
  check: giving GS-03 the LANL list fails it). LANL adds `logon`: an account
  successfully authenticated to a computer, not a person signing in and not
  an attack. `parseProposal` and `verifyProposal` take the source's list;
  GS-03's is the default, so the page is unchanged. `lanlProposalSchema` exists for the
  LANL run step; nothing uses it yet.
- `logon` rule: any logon action with outcome success. A failed logon
  contradicts it. Logoffs, tickets, AuthMap and screen events are not logons.
  `sign_in` is unchanged and does not accept a LANL logon; `logon` does not
  accept a GS-03 sign-in. No ATT&CK technique for `logon`.
- Not done: a failed logon supports no finding type.
- Narrowed the same day (owner's decision): LANL's model-facing list is only
  `logon` and `other`, since no LANL event can satisfy a GS-03 type. Tests:
  the LANL schema's type enum is exactly those two and the rest of it equals
  GS-03's; a LANL answer using a GS-03 type is rejected; an `other` finding on
  LANL evidence gets the citation, identity, time and repeat checks and never
  passes. GS-03's pinned schema test still passes. 129 tests.

### LANL auth inventory (2026-11-11, 23:05 to 23:27 WAT)

`npm run lanl -- inventory`, unchanged code, one full streaming read (22 min).
Output: `~/Data/lanl-cyber1/auth.inventory.json` (outside the repository).

- File: `auth.txt.gz`, 7,626,505,167 bytes, sha256
  `eee54f2ee202756f25e403b7b896ec1d4c6152f1ab65fc1b5beb3a3187faf53d`. Read
  to the end with no gzip error.
- 1,051,430,459 records; 0 malformed; times 1 to 5,011,199 (58 days); times
  never decrease, so a case scan may stop at its window's end.
- `?` never occurs in users, computers, orientation or result. It occurs in
  authentication type (55.5%) and logon type (14.0%).
- Orientation, 7 values: LogOn 44.5%, LogOff 41.5%, TGS 9.4%, TGT 3.7%,
  AuthMap 0.91% (9,571,401), ScreenLock 99,556, ScreenUnlock 94,599. The last
  three were later added literally (see "LANL logons, logoffs and finding
  types").
- Result: Success 98.78%, Fail 1.22% (12,840,308). No other value.
- Logon type, 10 values: Network 80.4%, `?` 14.0%, Service 4.7%, Unlock
  0.38%, Interactive 0.20%, Batch 0.17%, NewCredentials 0.11%,
  NetworkCleartext 0.04%, RemoteInteractive 0.015%, CachedInteractive 0.010%.
- Authentication type, 29 values: `?`, Kerberos 34.5%, Negotiate 5.2%,
  NTLM 4.7%, MICROSOFT_AUTHENTICATION_PACKAGE_V1_0 0.07%, about 15 cut-short
  spellings of that name (truncated in the source data), and a few rare ones
  (NETWARE, Wave, Setuid, ACRONIS, CygwinLsa; 4 more with 11 records). Kept
  verbatim in the detail; never interpreted.

### LANL vocabulary and relative time (owner's decision, built 2026-11-11)

Vocabulary (`AUTH_VOCABULARY` in `tools/lanl/case.ts`; LogOn and LogOff
superseded, see "LANL logons, logoffs and finding types"): orientation LogOn
becomes sign-in, LogOff sign-out, TGT "ticket-granting ticket", TGS "service
ticket"; result Success becomes success, Fail denied. Ticket activity is its
own action, so no finding type's rule accepts it: a sign-in finding citing a
TGS event is "unsupported" (tested through the unchanged verifier). Any other
value, including any orientation the inventory finds beyond these four, a
different spelling or case, a missing value, or a name like `toString`, is
refused with its file and line; the case is not built. The original values stay in the
detail and the raw record. `EventAction` gained the two ticket actions; no
finding type was added.

The value strings "TGT" and "TGS" come from the decision, not yet from the
data: LANL's documentation shows only "LogOn". If the inventory spells them
otherwise, case building refuses them until the table is updated.

Time: each row reads `Day 9 · elapsed 02:24:00` (`date` "Day 9", `time`
"elapsed 02:24:00"), counting from second 1, and the detail repeats it with
the exact dataset seconds. Selected events are ordered by dataset seconds,
then file line. Each case file carries `modelNotes` with `LANL_TIME_NOTE`:
relative timestamps, not local clock times, cannot show night or working
hours, order by the numeric time. No LANL run path to the models exists yet;
when it is built, it must send these notes. They are not in the GS-03 prompt,
which is unchanged.

The time check, unchanged, compares hours and minutes: "00:04" and
"elapsed 00:04:59" both match an event at 00:04:59, "00:05" is flagged.
Limits: seconds and the day number are not checked, and a claim that reads
a relative time as a clock time ("at 2:24 am", "overnight") is not caught by
code; the model note is the only guard against that.

Tests: 118 in all; new ones cover every mapping, refusals (unknown value,
case, `?`, `toString`, unknown result), ordering, the time format, ticket
activity not supporting a sign-in, quoted times, and the note's content. CLI
run on the synthetic file: 8 events, Day 1 to Day 2, TGS as "service ticket".

### LANL identity check (2026-11-11)

The account check now also reads LANL identities, in the shapes the data
and LANL's documentation show: `U748@DOM1` and `U8777@C583` (red-team file:
722 and 27 lines), `C625$@DOM1` and `SYSTEM@C653` (documentation examples),
and bare `U748`, `C625$`, `C17693`. Matching ignores case, as for GS-03.

- Every identity a finding names must be in an event it cites; every identity
  in the explanation or actions must be in the evidence. Unknown ones are
  problems, so the finding does not pass ("mentions account u900999@dom1 …",
  "mentions computer c999999 …").
- A bare name is vouched for by a full one (`U748` by `U748@DOM1`); a full
  name must match in full (`U748@DOM2` is flagged). A local or SYSTEM
  account's domain is a computer and is checked as one.
- GS-03: no GS-03 text contains a LANL-shaped identity (tested), and all 48
  earlier verifier tests pass unchanged, messages included.
- Tests: 12 new (113 total), on synthetic identifiers in LANL's shapes, plus the
  former `known gap` test in `tools/lanl/evaluate.test.ts`, now asserting the
  invented user is caught on evidence built by the real converter. Mutation
  check: with LANL extraction removed, 6 tests fail.

Limits: other readable well-known accounts (LANL names "Local Service") are
not recognised until the inventory shows how they are written; a name with
spaces could not be read by these patterns. The check reads identities by
shape, so a user named in prose without its ID ("the administrator") is not
checked, as for GS-03. `?` fields become "not recorded" and name nothing.

### How to run the first cloud test (owner)

1. Copy `.env.example` to `.env.local`. Fill the six `VITE_FIREBASE_*` values
   from Firebase console > Project settings > Your apps > project studio web.
2. Firebase console > AI Services > AI Logic > Get started > Gemini Developer
   API, if not already done.
3. Restart `npm run dev`, open `http://localhost:5173` in Chrome, open the
   console. Copy the line `Firebase App Check debug token: …`.
4. Firebase console > Security > App Check > Apps > project studio web > Manage
   debug tokens: add it. Do not paste it into chat, a commit or `.env.local`.
5. Reload. Click **Propose in the cloud**. Record: inference requested,
   inference source, latency, schema validation, classification, both code
   checks, and the full error text if it fails.

## Decisions

**Superseded 2026-11-11 by consent-gated hybrid routing (above).** **Two explicit modes, no automatic fallback.** The page builds one hybrid model
configuration and uses it in `ONLY_ON_DEVICE` or `ONLY_IN_CLOUD`, whichever
button the analyst presses. `PREFER_ON_DEVICE` is not used: it would send log
events to the cloud whenever the local model is unavailable, without the analyst
having chosen that. Every result shows the mode requested and the source the SDK
reports, and is marked if they differ.

**Schema reaches the cloud model as `responseJsonSchema`.** The documentation's
examples use `responseSchema`. Ours is plain JSON Schema with
`additionalProperties: false`, which is what `responseJsonSchema` is for.
Untested. Either way `parseProposal` re-checks the shape and fails closed.

**Vite + React + TypeScript single-page app, not Next.js.** On-device inference
and offline use are entirely client-side; a server framework adds nothing here.

**Vite 6 and Vitest 3.** The build machine has Node 20.15.0. Vite 8 and Vitest 5
need Node 20.19+ / 22.12+. Upgrading Node is the owner's call.

**Superseded 2026-11-11 (above).** **`ONLY_ON_DEVICE` for the offline path.** `PREFER_ON_DEVICE` falls back to the
cloud silently, which would make an on-device claim unprovable.

**The page checks for the Prompt API itself.** In `firebase` 13.2.0, when the
browser has no `LanguageModel` global, `initializeDeviceModel` resolves without
error in `ONLY_ON_DEVICE` mode. The app refuses to proceed in that case.

**Placeholder Firebase config until a project exists.** The AI SDK will not
construct a model without `apiKey`, `projectId` and `appId`. The placeholder
lets the on-device path run now; a cloud request with it cannot succeed.

**Grounding rule: every finding cites events, and code checks the citations.**
A finding with no cited event, a cited event that is not in the evidence, or a
quoted time or account name that does not belong to a cited event is reported
as a problem. Known limits: am/pm is not read; dates are not checked; only
account names shaped like `adm-ops-01` are recognised; which account acted and
which was acted on is not checked.

**Support rule: every finding states a type, and code checks the cited events
against it.** Citations existing is not the same as the evidence supporting the
claim; the first two runs showed that. The model must give each finding one type
from a closed list (`FINDING_TYPES` in `src/lib/schema.ts`). Each type has a
rule in `src/lib/verify.ts`: the action, outcome and, for sign-ins, device that
a cited event must have. The result per finding is one of:

- supported: at least one event is cited, all exist, all meet the rule;
- unsupported: a cited event is missing, or is a different kind of event (a
  sign-out cited as a sign-in);
- contradicted: a cited event is the right kind but has a different outcome or
  device (the denied read E08 cited as a successful read);
- unchecked: the type is `other`, which has no rule. Never shown as supported.

The explanation is prose and is not read. Code only refuses to let it mention
an event that no supported finding cites.

Why a typed field and not matching words in the claim: matching prose is
guesswork that breaks on rewording, and a check that guesses is not a check.
Events gained two structured fields for this: `action` is a fixed list, and
sign-in and sign-out events record `device`.

Known limits. The wording of a claim is still not read: the model can pick the
right type and write a sentence that says more than the events do. Every cited
event must meet the rule, so a sound finding that also cites a context event is
reported as unsupported. The list of types is small and written for this
scenario. None of this judges the classification.

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
- Custom domain `project.phang.store`. Needs a Hosting deployment first.
- What the two models do together. Today they answer the same question
  separately. Candidates, none built: the device proposes and the analyst may
  send the same evidence to the cloud for a second proposal, shown side by side
  with both sets of code checks; the cloud model is offered when the device
  model fails or its findings fail the checks; `PREFER_ON_DEVICE` for visitors
  whose browser has no Prompt API, labelled as cloud. Owner's decision.
