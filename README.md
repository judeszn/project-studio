# Project Studio

Project Studio helps an analyst investigate a technical security incident from
the evidence they supply. An AI model proposes what happened; code checks
every proposed finding against the records it cites; the analyst decides.

**AI proposes. Code verifies. The analyst decides.**

- **What it does.** You open a case of security events. A model proposes
  findings, an explanation, a classification and recommended actions. Each
  finding must cite the events behind it.
- **How it works.** Deterministic code checks every finding against the cited
  records and gives it a verdict: Verified, Rejected, Contradicted or
  Unchecked. The model's explanation and classification are shown as its
  proposal, never as verified. The analyst reviews the result and exports a
  report.
- **Why hybrid AI.** By default the model is Gemini Nano, running in Chrome on
  the analyst's own machine, so the evidence stays there. A larger cloud model
  is available through Firebase AI Logic, but only when the analyst chooses
  it and consents, every time, before any evidence is sent.

Project Studio is not a chatbot, an autonomous security analyst or an
automated incident response system. It does not take actions, and a verified
finding does not prove that an attack happened.

Built for #BuildHybridAI 2026 (Web/Chrome) by Boluwatife Faturoti, PHANG Group.

## Try it

**Hosted app:** _link added at release._

No file is needed. In Chrome:

1. Open the app. The overview shows this session's investigations (none yet).
2. Choose **Try the sample investigation**: 18 simulated authentication
   events, built into the page.
3. **Evidence** shows each event with its original record.
4. **Run**: choose **On this device** (Gemini Nano) or **In the cloud**. The
   cloud asks for consent, and shows Google's data terms, before anything is
   sent.
5. **Findings** shows the overall result, the four verdict counts, evidence
   coverage, each finding with its verdict and reasons, then the model's
   explanation and classification.
6. **Report** exports a self-contained HTML report and, for a model run, a JSON
   run record.

**See how verification works** opens a worked example: a proposal written by
the Project Studio team, with no AI involved, that produces all four verdicts.

If your machine cannot run Gemini Nano, use the cloud path after consent. The
sample case is simulated: InfoPro and PHANG Group are the author's own
organisation and product, and InfoPro has had no such incident.

## How it works

```
Case file or sample  ->  checked in the browser (fail closed)
                     ->  Gemini Nano on this device
                         or, after consent, Gemini in the cloud (Firebase AI Logic)
                     ->  proposal: findings citing event IDs, explanation,
                         classification, actions (JSON, fixed schema)
                     ->  deterministic verification, per finding
                     ->  findings, report and run record
```

### Firebase AI Logic and hybrid inference

All inference goes through Firebase AI Logic (`firebase` 13.2.0,
`src/lib/hybrid.ts`); the app never calls a Gemini API directly.

- `getAI` with the Gemini Developer API backend. Each case gets models from
  `getGenerativeModel` with the same system instruction and the same JSON
  schema on both sides: `onDeviceParams` for Gemini Nano through Chrome's
  Prompt API, `inCloudParams` for `gemini-3.5-flash-lite`.
- **Before consent**, the only mode used is `ONLY_ON_DEVICE`, and it is refused
  when the browser has no Prompt API, because the SDK would otherwise send the
  request to the cloud.
- **After consent**, the app uses `PREFER_ON_DEVICE` when Nano is unavailable,
  or `PREFER_IN_CLOUD` when Nano failed or the analyst asked for the cloud.
- Every result records the mode used and the source the SDK reports
  (`response.inferenceSource`), and the page and report say where the model
  ran.
- **App Check** protects the cloud path: reCAPTCHA Enterprise on the hosted
  app, a registered debug token in local development only.
- The sample case can use the cloud after consent. A case file the analyst
  opens has the cloud off until they allow it, and still asks before sending.

### Deterministic verification

`src/lib/verify.ts` parses the model's output strictly and fails closed. For
each finding it checks that the cited events exist, are of the kind and
outcome the finding's type states, and that the times (to the second when the
finding quotes seconds), accounts and computers the finding names belong to
them. It also catches repeated findings.

| Verdict | Meaning |
| --- | --- |
| Verified | Every check passes. This checks the evidence for the finding, not the conclusion drawn from it |
| Rejected | At least one check failed; the reasons are listed |
| Contradicted | A cited event records the opposite of what the finding states |
| Unchecked | Type `other`, which has no rule. Never counted as verified |

Every event keeps its source file, line and original record, so each verdict
can be traced to the material supplied. The verifier checks cited event IDs
and selected details extracted from each finding, including times, accounts
and computer names, against the cited records. It does not assess the broader
meaning or truth of the claim, the explanation or the classification; these
remain the model's proposal. Events no finding cites are listed, so nothing is
left out silently.

### Reports and run records

The HTML report opens without a network and prints to PDF. It names the run
it belongs to: the model, where it ran and when it started. The JSON run
record holds the case hash, the prompts and their SHA-256 hashes, the raw
output, where it ran, latency and every check, so a run can be re-verified
later.

## Implemented, evaluated, planned

| Status | What |
| --- | --- |
| Implemented | JSON case files (`docs/CASE_FILE.md`) and the built-in sample; authentication events (logons and denied logons); on-device and consent-gated cloud inference; App Check; deterministic verification; overview of the current browser session's runs (kept in memory, not stored); HTML report and JSON run record |
| Evaluated | One Nano run on each of two cases from the public LANL dataset, against a deterministic baseline (below) |
| Planned, not built | Other intake (API, webhooks, a local collector, CSV, XLSX, PDF); other investigation types (phishing, endpoint, network, cloud); persistent investigation history |

Known limits: verification checks cited evidence and selected details
extracted from a finding; it does not establish that an attack occurred or
assess the broader meaning of a claim, the explanation or the classification.
Text inside event fields reaches the model as evidence; a crafted field could
steer what the model proposes, and checks on structured fields would not
detect a misleading sentence. This has not been tested with a
prompt-injection fixture.

Planned work follows `docs/PRODUCT_DIRECTION.md`: accept evidence broadly,
verify narrowly. Only system records can support a verified finding;
documents, screenshots and testimony frame the questions.

## Results so far

These are single runs on one machine: observations, not benchmarks.

**Sample case, 15 November 2026, one run each** (records re-checked against
the code; `docs/DECISIONS.md`):

| | Cloud, `gemini-3.5-flash-lite` | On device, Gemini Nano |
| --- | --- | --- |
| Findings | 3 | 8 |
| Verified / Rejected / Contradicted / Unchecked | 3 / 0 / 0 / 0 | 2 / 2 / 1 / 3 |
| Classification (proposal, not verified) | Undetermined, Low | Credential Compromise, Medium |
| Latency | 16.5 s | 63.2 s |

Nano cited event IDs that do not exist, repeated a finding and cited a
successful logon as a denied one; code caught each of these. Its
classification is not supported by its verified findings; code does not
check classifications, and the page shows it as the model's proposal.

**Correction (17 November 2026).** One of Nano's two verified findings above
was wrong: it says a logon to FINSRV1 was denied, but the event it cites, E16,
is a denied logon to FILESRV1. The verifier then checked times and accounts
but not computer names, so it marked the finding Verified. A production run
on 17 November showed the same kind of error, and the verifier now checks
every computer a finding names, and times to the second when a finding quotes
seconds. Re-checked with it, this Nano run has **1 / 3 / 1 / 3**; both cloud
runs remain 3 of 3. The table shows the run as it was recorded; the record is
unchanged. Details and every re-checked record: `docs/DECISIONS.md`
(2026-11-17).

**LANL evaluation, 12 November 2026** (`docs/DECISIONS.md`). One Nano run,
on-device, on each of two cases built from LANL's public authentication data
by a selection rule frozen before any run; labels applied only after both
runs; compared with a deterministic first-seen-pair baseline.

| Case | Measure | Nano (verified findings) | Baseline |
| --- | --- | --- | --- |
| Evaluation (43 events) | Labelled events covered | 0 of 21 | 10 of 21 |
| Control (7 events) | Labelled events covered | 3 of 3 | 0 of 3 |

On the evaluation case the baseline did better than the model. On the
control, Nano listed every successful logon, which the prompt asked it not to
do. What this supports: verification stopped five of the seven failing
evaluation-case findings on concrete errors and showed none as verified. What
it does not support: that Nano, with this prompt, finds red-team activity in
this data. The control is not size-matched; the selection rule was
label-informed in design and label-blind in execution. No LANL data was sent
to the cloud, and none is in this repository.

## Tested configuration

Gemini Nano has run on one machine: an Apple M1 Mac (16 GB, macOS 15.7.1) in
desktop Chrome 156 and 157, with no `chrome://flags` entries enabled. Other
hardware, operating systems and Chrome versions have not been tested, and
Nano's availability depends on the device. The cloud path has been tested in
the same browser.

## Run it locally

Requires Node.js 24.12 or later (see `.nvmrc`) and desktop Chrome for
on-device inference.

```bash
npm ci
npm run dev
```

Open `http://localhost:5173` in Chrome.

**Firebase, for cloud inference.** Create a Firebase project with a web app
and Firebase AI Logic (Gemini Developer API), then:

| File (git-ignored) | Holds | Used by |
| --- | --- | --- |
| `.env.local` | The web app config (`VITE_FIREBASE_*`) | Every build |
| `.env.development.local` | `VITE_APPCHECK_DEBUG_TOKEN`, an App Check debug token registered in the Firebase console | `npm run dev` only; never in a production build |
| `.env.production.local` | `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`, a score-based reCAPTCHA Enterprise key from the same Google Cloud project, registered for the web app in App Check, with your hosting domain allowed | `npm run build` |

`.env.example` lists every variable. Without a debug token set, the
development build asks the SDK to create one and print it to the browser
console; register it under App Check, then set it in
`.env.development.local`.

**Checks:**

```bash
npm test        # 293 tests
npm run lint
npm run build   # type check and production build
```

**Deploy** to your own project with the Firebase CLI, for example
`npx firebase-tools hosting:channel:deploy preview --project <your-project>`.

Case files: format and limits in `docs/CASE_FILE.md`.

## Pre-existing work

The Official Rules' submission period opened on 11 November 2026 at 13:30 PT
(22:30 WAT). Two commits predate it:

- `01ee668`, 11 Nov, 13:55 WAT: the baseline. A Vite scaffold, Firebase AI
  Logic wiring, a first deterministic verifier with tests, and a
  proof-of-concept page for an earlier product direction. The code was
  written on 10 November.
- `85a5702`, 11 Nov, 14:21 WAT: GS-03, a synthetic credential-compromise case
  with its proof-of-concept page. It remains as a test fixture.

Everything else was built during the submission period: consent-gated hybrid
routing, the case-file loader and run records, the LANL tooling and
evaluation, the four-verdict report and export, the sample case and worked
example, App Check with reCAPTCHA Enterprise, and the current interface. The commit history
and `docs/DECISIONS.md` record what was done when, with evidence.

## Repository

| Path | What |
| --- | --- |
| `src/lib/hybrid.ts` | Firebase AI Logic models, consent-gated routing |
| `src/lib/firebase.ts` | Firebase app and App Check |
| `src/lib/verify.ts` | Deterministic verification |
| `src/lib/casefile.ts` | Case-file loader |
| `src/lib/report.ts`, `src/lib/record.ts` | Report, export and run record |
| `src/App.tsx`, `src/Dashboard.tsx`, `src/ReportView.tsx` | The interface |
| `src/data/` | Sample case, worked example, GS-03 fixture |
| `tools/lanl/` | LANL case building and evaluation (reads a local copy; no LANL data here) |
| `docs/` | Decisions and evidence, product direction, case-file format, hackathon guide |

## Data and privacy

- Evidence stays in the browser unless the analyst consents to send it to the
  cloud model. Project Studio has no server of its own and stores nothing;
  closing the page clears the session.
- The cloud path uses the free tier of the Gemini Developer API. Under
  Google's terms Google may use what is sent, and human reviewers may read
  it. Send only synthetic or non-sensitive data.
- All incident data in this repository is synthetic and labelled as such.

## Licence

Project Studio's original source code is licensed under the
[Apache License 2.0](LICENSE). Copyright and third-party attributions are in
[NOTICE](NOTICE). The licence does not cover third-party material: MITRE
ATT&CK content stays under MITRE's terms of use, the LANL dataset (not
included here) under LANL's terms, and dependencies under their own licences.
