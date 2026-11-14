# Hackathon guide: scope, win criteria and guardrails

Scope locked 2026-11-11. Guide set 2026-11-12, after the Official Rules were
published. This is the one place that says where the hackathon work is going;
`docs/DECISIONS.md` records how each step was done.

Project Studio is a local-first, AI-assisted security investigation and
evidence-verification tool. It turns security telemetry into evidence-backed,
verifiable incident investigations.

**AI proposes. Deterministic verification checks. The analyst decides.**

Its differentiators are local evidence processing and deterministic
verification of every AI claim, not the use of AI as such.

## 1. What we are entering

#BuildHybridAI 2026, Web (Chrome) platform, individual entry. Source:
the Official Rules at firebasehybridaihackathon.devpost.com/rules, read
2026-11-12.

| Date | What |
| --- | --- |
| **Nov 28, 2026** | **Our submission date** (two days of margin) |
| Nov 30, 2:00 PM PT (23:00 WAT) | Submissions close; later commits are not evaluated |
| Dec 10 to Dec 16 | Judging; the hosted app must stay up and free until it ends |
| About Dec 21 | Winners announced |

Prizes we can win: Grand Prize ($10,000), 1st runner-up ($7,000), 2nd
runner-up ($4,000), and Best Web/Chrome ($3,000). One entry can win one grand
prize and one "Best of" prize. Multi-platform is "preferred"; we are web only,
by choice.

## 2. Stage One: pass/fail requirements

Judging starts with a pass/fail check that every requirement is met. Failing
any line ends the entry, so each is checked with evidence before submitting.

| Requirement (Official Rules) | How we meet it |
| --- | --- |
| A Gen AI app using Firebase AI Logic, with App Check (required; debug tokens accepted) | `@firebase/ai`, called at runtime in `src/lib/hybrid.ts`; App Check on the hosted app |
| Web (Chrome): Gemini Nano via Firebase AI Logic | On-device runs through the SDK's on-device mode. The rules name "Gemini Nano 4"; we state the Chrome version and never claim a model version we have not verified |
| Installs and runs consistently; works as the video and text describe | Hosted app and README steps tested on a clean machine before submitting |
| Pre-existing work disclosed, with a summary of what was built in the period | Two commits predate the start (11 Nov, 13:30 PT): `01ee668` (Vite app, Firebase AI Logic call, first verifier) and `85a5702` (GS-03 case). README and Devpost text list them and summarise everything since |
| Authorised use of third-party data | LANL cyber1: copyright waived by LANL, approved for public release (LA-UR-15-23810); cited as LANL asks |
| Free access for judges until judging ends | Hosted app at project.phang.store, no login, up until Dec 16 |
| No production API keys, live project secrets, confidential data or PII in the repo, form or testing instructions | `.env.local` never committed; secret scan of the repo before pushing; the Firebase web config ships in the built page only |
| English | App, video, text |
| Text description: how Firebase AI Logic is used, features, value proposition | Devpost text |
| Public GitHub repo with all source and run instructions; Firebase AI Logic imported and called, not only named | `judeszn/project-studio`, merged to the default branch |
| Open-source licence visible in the repo's About section (Apache preferred) | `LICENSE` (Apache-2.0) and `NOTICE` |
| Video of at most 3 minutes, public on YouTube, English, showing the app working on its platform | Recorded in Chrome with Nano |

## 3. Stage Two: how the entry is scored

Four criteria, **equally weighted**, each scored 1 to 5, averaged. Ties are
broken by the criteria in this order. Judges "may choose to judge based
solely on the text description, images, and video", and judging may use
"automated AI-driven analysis". So the video and the written description
carry most of the score, and every claim in them must be literally true and
easy to check in the repository.

| Criterion (rules' words) | What we show | Evidence that it is done |
| --- | --- | --- |
| **Technological Implementation**: how well it is built, how effectively it uses Firebase AI Logic hybrid inference | On-device by default; the cloud only after the analyst's consent; an on-device run with the network disconnected; App Check enforced; every AI claim checked by code; a reproducible evaluation | Tests passing; consent-gated routing tests; offline run on video; App Check enforcement on the hosted app; evaluation records |
| **Design**: a complete, coherent product, not a proof of concept | One flow: open a case file → run on this device → checked findings → report → download the run record. Where the model ran is shown everywhere. Clear states when Nano is missing or fails. Works at phone width | Walkthrough in the video; hosted app checked at 375 px and desktop |
| **Potential Impact**: a credible, specific case for a real problem and audience, judged on what is demonstrated | Incident responders who cannot send evidence to a cloud model: consultancies working on client data, regulated or isolated environments. Shown on real public telemetry (LANL), with results reported as they came out | LANL results in the README, including what the model missed and what failed checks |
| **Quality of the Idea**: a creative, non-obvious use of Firebase AI Logic, genuine understanding of the problem | On-device inference used as a data control, not a cost saving. Code checks each AI claim against the cited evidence. A label-blind evaluation against a deterministic baseline | Evaluation method and limitations stated; ATT&CK references validated |

## 4. Win criteria

Set by the owner, 2026-11-12. Stage One (section 2) comes first: failing any
line there ends the entry. Beyond it, the submission is ready when each of
these five is true and has evidence beside it in the checklist (section 9).

1. **Genuine hybrid AI.** Nano investigates on the device. Firebase AI Logic
   cloud inference works when the analyst chooses the cloud. Every result
   says where inference happened. The app and the text explain when local
   and when cloud is the right choice.
2. **A complete investigation workflow.** Load evidence → investigate →
   verify → review findings → export report. The case-file loader is what
   makes this a tool and not a fixed demo.
3. **A distinctive idea, demonstrated.** AI-assisted security investigations
   where evidence stays under the analyst's control and every finding is
   checked against its cited records. Shown working, not only described.
4. **A real audience and problem.** An incident-response analyst or security
   consultant who needs to investigate authentication evidence without
   automatically sending sensitive logs to a cloud model. This is a
   hypothesis until analysts have been interviewed, and is described as one.
5. **A demonstration that convinces on its own.** The video, under 3 minutes
   and public on YouTube, shows the actual app: a real case loaded, AI
   running locally, findings with citations, verification rejecting or
   flagging an unsupported claim, and a useful final report.

Also required, as before: the LANL evaluation is published as it came out,
good or bad, and nothing in the video, README or Devpost text claims more
than was demonstrated. A judge without Nano can still use the hosted app
through the cloud path, after consent.

**Order of work.** Verification is the product's differentiator; hybrid
inference is the competition's central technical challenge. Both must be
shown.

| Priority | Work |
| --- | --- |
| 1 | General case-file loader |
| 2 | Reliable Nano investigation |
| 3 | Working hybrid inference demonstration |
| 4 | Deterministic evidence verification |
| 5 | Clear investigation console and report |
| 6 | Honest evaluation and baseline comparison |
| 7 | Demo video and submission narrative |

**The message.** "Project Studio turns security event data into
evidence-backed investigations using AI that can run locally or in the
cloud. Every finding is checked against its underlying evidence, giving
analysts greater control over how sensitive security data is processed."

**Not in the remaining time:** SIEM integrations, or growing the product
into an endpoint monitoring platform.

We do not control the score. We control whether each criterion has strong,
visible evidence.

## 5. LANL evaluation protocol (fixed before any model output)

Owner's decisions, 2026-11-12. Selection is in `docs/SELECTOR_SPEC.md`.

- **Cases:** evaluation case `lanl-c17693-h211` (43 events) and control
  `lanl-c17693-h658` (7 events), built from the frozen selector. Not
  replaced, trimmed or re-selected.
- **Finding types:** `logon` (successful logon), `denied_logon` (a logon whose
  recorded outcome is Fail), `other` (never passes). Added `denied_logon`
  before any run, without labels.
- **Prompt:** the approved LANL system prompt, frozen with its exact text and
  SHA-256 before the first run. Classification definitions and the LANL time
  note unchanged. No language about first-seen pairs or lateral movement.
- **How it runs:** through the app's case-file loader and Firebase AI Logic,
  on-device only. No cloud fallback. If Nano fails, the failure is the
  result. One run per case, as the owner ordered; if another is ever made,
  it is kept and reported too.
- **LANL evidence and the cloud:** never, in this evaluation. The hybrid and
  cloud paths are demonstrated on synthetic evidence. The two LANL case
  files are not put in the repository.
- **Records:** every run's record is kept: case hash, prompt and its hash, raw
  output, where it ran, latency, verification. No run is discarded.
- **Labels:** applied only after every planned run has its record.
- **Measures, per run:** labelled events covered, labelled events missed,
  unlabelled events flagged (not called false positives), verification pass
  rate, latency; the baseline on the same cases, in full and on successful
  events only.
- **Disclosed with the results:** the selector is label-informed in design and
  label-blind in execution, and C17693 was known as the main red-team source;
  the control is not size-matched (7 against 43 events), so differences
  between the two cases are not attributed to the model alone; LANL includes
  failed authentications only for users with a success somewhere in the data;
  one machine, one Chrome version; a handful of runs are observations, not
  rates.
- **Not done:** prompt tuning, case replacement, selector changes, reruns to
  improve a result, or dropping a run, after any output has been seen.

## 6. Guardrails

**Evidence and data**
- Evidence never leaves the device without the analyst's consent. The run
  without consent is on-device only.
- The full LANL dataset is not uploaded anywhere. Raw files stay in
  `~/Data/lanl-cyber1/`.
- Labels never reach a model, prompt, evidence row, page or bundle.
- Source files, line numbers and original records are kept with derived
  evidence.

**Truthfulness**
- A capability is claimed only after it has been tested.
- Failures, misses and rejected claims are reported as found.
- The deterministic baseline is reported even when it does better than the
  model.
- Model versions, hardware and limits are stated, not implied.

**Security**
- No credentials, API keys or App Check debug tokens in code, repo or chat.
- No direct Gemini API calls; all inference through Firebase AI Logic.
- App Check is never disabled to make a demo work. Network disconnection is
  never faked.
- Deterministic checks are never delegated to a model, and never weakened.

**Process**
- Nothing is committed, pushed or deployed without the owner's approval.
- GS-03 stays unchanged as a regression fixture.
- The ADTC repository is never touched.

## 7. Plan to November 28

| Dates | Work | Done when |
| --- | --- | --- |
| Nov 12 to 14 | `denied_logon`; prompt frozen; case-file loader with run records; Nano runs on both cases (owner, in Chrome); labels; comparison | Run records kept; results in `docs/DECISIONS.md` |
| Nov 15 to 17 | Report view and export; prompt-injection fixture; results written for the README | A reader can follow the report without the app |
| Nov 18 to 21 | Production deployment with App Check; offline run recorded; repo merged to the default branch (with approval) | Hosted app passes the Stage One table |
| Nov 22 to 25 | README with disclosure of pre-existing work; video script, recording and upload | Video at most 3 minutes, public |
| Nov 26 to 28 | Devpost text; clean-machine test; submit | Submitted on Nov 28 |

**If time runs short, cut in this order:** prompt-injection fixture, then a
synthetic sample case for judges. Never cut: anything in the Stage One table,
the on-device demonstration, the consent step, the report and its export
(win criteria 2 and 5; changed 2026-11-12, it was second in the cut order),
the evaluation results.

## 8. Changing this guide

The guide can change. A change is written here first, dated, with its reason,
and must answer: does it materially improve the quality, credibility,
security or demonstrability of the entry? If not, it waits until after the
hackathon.

## In scope

1. LANL authentication dataset ingestion.
2. Streaming parser and bounded investigation case builder.
3. Ground-truth separation: red-team labels never reach the model, the
   prompt, the evidence JSON, the page or its bundle.
4. LANL-compatible identity, event and timestamp verification.
5. Evidence citation and finding verification.
6. Duplicate and less-specific repeat detection.
7. Uncited-event reporting.
8. Explicit Gemini Nano and Firebase cloud inference paths.
9. A deterministic, code-only baseline run on the same cases.
10. One red-team-labelled LANL case and one matched control.
11. A prompt-injection regression fixture, separate from GS-03.
12. Carefully validated MITRE ATT&CK references.
13. An evidence-backed investigation report.
14. Production deployment with App Check.
15. README, evaluation results, demo video and Devpost submission.
16. A JSON case-file loader: an analyst opens a documented case file from
    disk; the evidence stays in the browser. Added 2026-11-12: it is the run
    path for the LANL cases and the first way an analyst can use their own
    evidence.

## Framework alignment

- **SANS PICERL:** supports the Identification phase. Containment, eradication
  and recovery appear only as recommendations for a human.
- **NIST SP 800-61 Rev. 3 / CSF 2.0:** investigation and analysis within
  Detect and Respond.
- **MITRE ATT&CK:** technique references on verified findings, as references,
  not conclusions.

Project Studio does not claim to implement the incident response lifecycle.

## Out of scope

BRON, CICIDS2017, MITRE D3FEND, SIEM integrations, multi-tenancy, enterprise
RBAC, automated containment, eradication or recovery, a full chain-of-custody
implementation, enterprise asset and identity management, advanced threat
intelligence and other enterprise integrations.

## 9. Acceptance checklist

An item is ticked only with evidence, named beside it.

- [x] On-device and cloud inference both through Firebase AI Logic, source
      shown per result (runs D to J, `docs/DECISIONS.md`)
- [x] Hybrid routing as the requirement describes it: on-device when
      available, cloud when not, with the analyst's consent before evidence
      leaves the device (`src/lib/hybrid.ts`, 21 tests; runs K, L in the cloud
      after consent; run M on-device in the owner's Chrome)
- [x] Mobile-first layout with collapsible sections (checked at 375 px and
      1024 px; `docs/DECISIONS.md`)
- [x] Citation, time and account checks on GS-03 (`src/lib/verify.test.ts`)
- [x] Repeat detection, per-finding verdict, uncited events (runs G and I as
      regression tests)
- [x] ATT&CK references, validated against ATT&CK v20 (`src/lib/attack.ts`)
- [x] Streaming auth parser, case builder, label isolation, evaluation script,
      on synthetic fixtures (`tools/lanl/`, 29 tests)
- [x] LANL auth file downloaded, inventoried and hash recorded (1,051,430,459
      records, 0 malformed; `docs/DECISIONS.md`)
- [x] Red-team to auth match measured and rule locked (`either_user`; rules
      equivalent record by record; 702 labelled auth records, 14 lines
      unmatched; `docs/DECISIONS.md`)
- [x] Vocabulary and time representation for LANL: decided by the owner and
      built (`tools/lanl/case.ts`; tests; `docs/DECISIONS.md`)
- [x] Account check recognises LANL identities, including an unrecorded
      domain (`U…@?`) (`src/lib/verify.test.ts`; `docs/DECISIONS.md`)
- [x] Nano evidence limit measured (50 events fit within 90% of a 9,216-token
      window; 50 synthetic events ran in 53.9 s) and selector specification
      frozen (`docs/SELECTOR_SPEC.md`)
- [x] Candidate scan run; evaluation case and control fixed by the frozen rule
      (29,978 eligible windows; rank 1 has 43 records and score 30; the
      control has 7 records; `docs/DECISIONS.md`)
- [x] Evaluation case and control built and checked against an independent
      extraction (43 and 7 events; control not size-matched, disclosed;
      `docs/DECISIONS.md`). Labels not yet applied
- [x] Deterministic baseline run on both cases (30 of 43 and 0 of 7 flagged,
      equal to the scan's scores; `docs/DECISIONS.md`). Not yet compared
      with labels
- [x] Official Rules read (2026-11-12); requirements and judging in sections
      1 to 3
- [x] `denied_logon` finding type, with tests (`src/lib/verify.test.ts`;
      `docs/DECISIONS.md`)
- [x] LANL system prompt frozen, text and SHA-256 recorded (`4439ce20…d6e7`;
      pinned by `tools/lanl/prompt.test.ts`; `docs/DECISIONS.md`)
- [x] Case-file loader with schema validation and downloadable run records;
      on-device and cloud runs clearly distinguished (`src/lib/casefile.ts`,
      `src/lib/record.ts`, 210 tests; browser checks on a synthetic case,
      `docs/DECISIONS.md`). An on-device run of a case file is not yet
      tested: it is the next item
- [x] Nano run on both cases; every run record kept; results recorded with
      latency (100.2 s and 42.4 s, on-device, no consent; records in
      `~/Data/lanl-cyber1/runs/`; `docs/DECISIONS.md`). The records'
      Android user agent is an override, cause unknown; to resolve before the
      next recorded demonstration
- [x] Labels applied after the runs; model and baseline compared with them
      (evaluation case: Nano 0 of 21 labelled covered, baseline 10 of 21;
      the control holds 3 labelled events; `docs/DECISIONS.md`)
- [ ] Prompt-injection fixture: what is caught and what is not, documented
- [ ] Offline on-device run shown with the network disconnected
- [x] Investigation report a reader can follow without the app open, with
      export (four verdicts with reasons, cited and uncited evidence with
      original records, escaped self-contained HTML; `src/lib/report.ts`,
      34 tests; checked in the browser on the synthetic case;
      `docs/DECISIONS.md`)
- [x] A synthetic sample case file judges can open (the LANL cases are not
      published): **Load demo case (synthetic)**, 18 events, same loader
      (`src/data/demo-case.json`, 14 tests; one consented cloud run, all
      findings Verified; one on-device Nano run, 5 Verified and 3 Unchecked;
      `docs/DECISIONS.md`). Neither live run produced a Rejected or
      Contradicted finding
- [x] Analyst-authored worked example showing all four verdicts, labelled
      "No model ran" on the page, in the export and its file name; same
      checks as model runs; no run record (`src/data/worked-example.ts`,
      13 tests; `docs/DECISIONS.md`)
- [x] Consent prompt discloses the Gemini free-tier data terms before every
      send, including after an earlier consent (`CLOUD_DATA_TERMS`, 3 tests;
      browser check; `docs/DEPLOYMENT_READINESS.md`)
- [ ] Production deployment with App Check (reCAPTCHA Enterprise), up until
      Dec 16
- [ ] Repository checked for secrets before pushing
- [ ] Open-source licence: `LICENSE` (Apache-2.0) and `NOTICE` added; shows
      in GitHub's About only once pushed to the default branch
- [ ] Work merged to the public repository's default branch
- [ ] README with run instructions, value proposition, evaluation results and
      disclosure of pre-existing work
- [ ] Demo video (at most 3 minutes, public YouTube, English)
- [ ] Devpost text description and submission, on Nov 28

## Risks

- **Judges' hardware.** Many judges may be unable to run Gemini Nano, and
  may judge from the video and text alone. The cloud path must work for them
  after consent, and the video must show the on-device path.
- **One machine.** Nano has run only on the owner's Mac. Behaviour on other
  hardware is not known and is not claimed.
- **The evaluation may not favour the model.** That is a result, reported as
  such; the entry's case rests on verification and local processing, not on
  the model winning.
- **Pre-existing work.** Two commits predate the submission period by about
  eight hours; they must be disclosed, or the entry risks Stage One.

## After the hackathon

In rough order: production ingestion pipeline, SIEM integrations (JSON/CSV,
syslog, then Wazuh, Elastic, Sentinel, Splunk), identity and asset context,
chain of custody, multi-user workspace with RBAC and audit trails, incident
workflow beyond identification, D3FEND and BRON enrichment, network evidence
(LANL flows and DNS first, CICIDS2017 only after a review of its labels),
enterprise deployment and hardening.
