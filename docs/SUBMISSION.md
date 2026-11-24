# Submission package

Text for the #BuildHybridAI 2026 Devpost entry (Web/Chrome, individual), and
a checklist against the Official Rules. Every claim here is in the README or
`docs/DECISIONS.md` with its evidence. Submission period ends **30 November
2026, 2:00 PM PT (11:00 PM WAT)**; the internal target is 28 November.

## Title and tagline

**AEMAS: AI Event Matching and Analysis System**

Evidence-backed security investigations. Gemini Nano proposes. Deterministic
engine verifies. The SOC decides. Gemini Nano runs on the device; cloud
Gemini only after consent.

## Links

- Hosted app: https://project.phang.store (no sign-in)
- Repository: https://github.com/judeszn/project-studio (Apache-2.0)
- Video: _the YouTube link, once uploaded (public, at most 3 minutes)_

## Project description

### The problem

AI can read security events quickly. It can also be wrong: in our own
testing, a model cited event IDs that were not in the evidence and described a
successful logon as a denied one. In an investigation, an unsupported finding
sends responders in the wrong direction. And much security evidence cannot
simply be sent to a cloud model: client data, regulated environments,
internal incidents.

### Who it is for

Incident responders, SOC analysts and security consultancies who want AI help
with authentication evidence, without trusting the AI's word and without
sending evidence to the cloud by default.

### What it does

An analyst opens a case of authentication events (a JSON case file, or the
built-in simulated sample). AI proposes findings, and every finding must cite
the events behind it. Deterministic code then checks each finding against the
records it cites and gives it a verdict:

- **Verified:** every check passes: the cited events exist, are of the kind
  and outcome the finding's type states, and the times, accounts and computer
  names it quotes belong to them.
- **Rejected:** at least one check failed; the reasons are listed.
- **Contradicted:** a cited event records the opposite of what the finding
  states.
- **Unchecked:** a finding type with no rule. Never counted as verified.

The model's explanation and classification are shown as its proposal, never
as verified. The analyst reviews the findings beside the original records and
exports a self-contained HTML report and a JSON run record from which the
analysis can be checked again.

AEMAS analyses the records it is given. It does not monitor systems, raise
alerts or take action, and a verified finding does not by itself prove that
an attack happened.

### Case study

The Case Study page explains the problem through the 2024 Change Healthcare attack,
which began with compromised credentials used on a remote-access portal
without multi-factor authentication (from the UnitedHealth Group CEO's
congressional testimony of 1 May 2024). It separates the public record from a
hypothetical application of AEMAS, and states what AEMAS could not have done.
AEMAS was not used in that incident.

## How Firebase AI Logic hybrid inference is used

All inference goes through Firebase AI Logic (`firebase` 13.2.0); the app
never calls a Gemini API directly. One system instruction and one JSON
response schema serve both models.

- **On the device by default.** Gemini Nano runs in Chrome through
  `getGenerativeModel` with `onDeviceParams`. Before the analyst consents, the
  only mode used is `ONLY_ON_DEVICE`, and the app refuses it when the browser
  has no Prompt API, because the SDK would otherwise send the request to the
  cloud.
- **The cloud only after consent, every time.** `gemini-3.5-flash-lite`
  through `inCloudParams`. After consent the app uses `PREFER_ON_DEVICE` when
  Nano is unavailable, or `PREFER_IN_CLOUD` when Nano failed or the analyst
  asked for the cloud. The consent prompt shows Google's free-tier data terms
  before anything is sent. A case file the analyst opens has the cloud off
  until they allow it.
- **Where it ran is recorded.** Every result shows and records the SDK mode
  and `response.inferenceSource`.
- **On-device inference as a data control**, not a cost saving: evidence
  stays on the analyst's machine unless they choose otherwise.

## Firebase products and integrations

- **Firebase AI Logic** (Gemini Developer API backend), with hybrid on-device
  inference through Chrome's built-in Gemini Nano.
- **Firebase App Check** with **reCAPTCHA Enterprise**, protecting the cloud
  path.
- **Firebase Hosting**, with the custom domain `project.phang.store`.

Built with: TypeScript, React, Vite, Vitest, Firebase AI Logic, Gemini Nano,
Gemini (`gemini-3.5-flash-lite`), Firebase App Check, reCAPTCHA Enterprise,
Firebase Hosting, Chrome Prompt API.

## Results (single runs, not benchmarks)

- **Production, 23 November 2026, simulated sample:** cloud 3 of 3 findings
  verified (3.5 s, after consent); Gemini Nano on the device 1 of 8 verified,
  2 rejected, 5 unchecked (96.4 s, nothing sent).
- **LANL public authentication data, 12 November 2026:** one Nano run on each
  of two cases selected by a rule frozen before any run. On the evaluation
  case a simple deterministic baseline covered 10 of 21 labelled events and
  Nano's verified findings covered 0; verification stopped five of seven
  failing findings on concrete errors and showed none as verified. We report
  this as it came out: AEMAS's case rests on verification and local
  processing, not on the model winning.

## Value and impact

Analysts get AI speed without having to trust AI claims: every finding either
holds against the evidence or shows why it does not, and the report traces
each one to the original record. Evidence stays on the device by default,
which makes AI assistance usable where cloud processing is not acceptable.

## Work done during the submission period

The submission period opened on 11 November 2026 at 1:30 PM PT. Two commits
predate it, about eight hours earlier: `01ee668` (a Vite scaffold, Firebase AI
Logic wiring, a first deterministic verifier and a proof-of-concept page for
an earlier direction) and `85a5702` (a synthetic credential-compromise test
case). Everything else was built during the period: consent-gated hybrid
routing, the case-file loader and run records, the LANL tooling and
evaluation, the four-verdict report and export, the verifier's computer-name
and seconds checks, the sample case and worked example, App Check with
reCAPTCHA Enterprise, the production deployment, and the AEMAS interface. The
commit history and `docs/DECISIONS.md` record what was done when.

## What's next (planned, not built)

- **API-first integrations.** Browser-side connectors to sources such as
  Microsoft Entra ID and Google Workspace, so selected sign-in records can be
  fetched into a case without passing through an AEMAS server. Later, a
  versioned ingestion API (OpenAPI) for SIEMs and other systems, built only
  once authentication, tenant isolation, audit and retention are in place.
- **One evidence format.** Every connector maps into the existing case-file
  event format, so the same investigation engine and verification apply.
- **More formats and investigation types:** CSV and NDJSON; phishing,
  endpoint, network and cloud, each with its own verification rules.

AEMAS will stay downstream of monitoring: it investigates the cases a SIEM or
an analyst selects.

## Testing instructions for judges

1. Open https://project.phang.store in desktop Chrome. No sign-in.
2. **Start an Investigation**, then **Use sample evidence (simulated)**.
3. **Evidence**: each event with its original record.
4. **Analysis**: choose where the AI runs, then **Run analysis**.
   - **On this device (Gemini Nano)** needs a desktop Chrome and device that
     support Chrome's built-in AI; the card shows its status. A run takes one
     to two minutes on a laptop.
   - **In the cloud**: a consent prompt appears first; press **Send 18
     events to the cloud**. A run takes a few seconds.
   - Without Nano, choosing **On this device** asks for consent to use the
     cloud instead, and nothing is sent unless you agree.
5. Read the findings: each has a verdict and, where it failed, the reasons.
6. **Report**: export the HTML report or the JSON run record.
7. **How verdicts work** shows all four verdicts with no AI involved.

The sample data is simulated. Do not send sensitive data: the cloud path uses
the free tier of the Gemini Developer API.

## Checklist against the Official Rules

| Requirement | Status | Evidence |
| --- | --- | --- |
| Gen AI app using Firebase AI Logic, with App Check | Done | `src/lib/hybrid.ts` calls `getGenerativeModel(...).generateContent`; App Check with reCAPTCHA Enterprise; consented cloud run in production, 2026-11-23 |
| Web (Chrome): Gemini Nano through Firebase AI Logic | Done | Nano run in production, `inferenceSource: on_device`, 2026-11-23 |
| Installs and runs; works as the video and text describe | Done for the text | Fresh clone of `main` installs, passes 318 tests and builds; the README's steps match the live app. The video must show the same interface |
| Pre-existing work disclosed | Done | README "Pre-existing work"; this file |
| Authorised third-party data | Done | LANL data public (cited); not in the repository; sample data simulated |
| Free access for judges until judging ends (Dec 16) | Done; keep it up | Hosted app, no sign-in, Firebase Hosting |
| No production keys, live secrets, confidential data or PII in the repository | Done | Secret scans clean; `.env*` files ignored; the Firebase web config ships only in the built page, as Firebase intends |
| English | Done | App, README, this text |
| Text description: Firebase AI Logic use, features, value | Ready | This file |
| Public repository with source and run instructions | Done | `judeszn/project-studio`, `main` |
| Open-source licence visible in About | Done | Apache-2.0, `LICENSE` and `NOTICE`; GitHub shows Apache-2.0 |
| Video, at most 3 minutes, public on YouTube, English, app working on its platform | **To do (owner)** | Show a Nano run in Chrome; ideally the offline run |
| Devpost form completed and submitted | **To do (owner)** | Before 30 November, 11:00 PM WAT |
