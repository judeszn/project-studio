# Product direction

AEMAS (AI Event Matching and Analysis System), by PHANG Group, is an
AI-assisted security investigation and evidence verification product. It
takes security evidence, has AI propose what happened, checks every proposed
finding against the evidence in code, and leaves the decision to the SOC.
The repository and the Firebase project keep the working name Project Studio.

**Gemini Nano proposes. Deterministic engine verifies. The SOC decides.**

The authentication investigation is the first working capability, not the
whole product. This document separates what exists in this build from what is
planned, so that no page, README, video or submission claims a capability the
code does not have.

## Scope and direction (agreed 16 November 2026)

AEMAS investigates **technical incidents**. It is not an HR investigation,
dispute or legal judgement platform: where the only evidence is testimony,
there is nothing for code to verify, and the product says so.

**Option C: accept broadly, verify narrowly.** An organisation should not have
to reshape its evidence for us, so intake will accept the material it has. But
every item carries an evidence class, and the class limits what it can
support:

| Class | Examples | What it can support |
|---|---|---|
| System records | Logs, authentication exports, platform CSV or XLSX | The only class that can support a verified finding, after validation |
| Human documents | Incident reports, emails, PDFs | Allegations and context: their claims become questions checked against system records |
| Visual material | Screenshots of alerts | Extracted information that stays "needs review" until the analyst confirms it |
| Testimony | Complaints, typed descriptions | The investigation's scope and questions, never proof of a technical event |

A complaint that an employee's password was stolen is not evidence that an
account was compromised; it is a question that the system records answer.

**Conversion rules.** The verifier checks findings against the converted
evidence, not the original file, so a wrong conversion would let wrong data
pass its checks. Therefore:

1. Original material is kept unchanged, with its hash, source and the time it
   was received, apart from the converted evidence.
2. Every converted field points to the cell, line or region it came from, as
   each case-file event already points to its file, line and raw record.
3. Known exports are converted by deterministic templates (for example Windows
   Security, Azure AD sign-ins, Okta).
4. Anything AI extracts (a column mapping, a table from a PDF, text from a
   screenshot) is shown to the analyst and stays unconfirmed until accepted.
   Unconfirmed evidence never supports a verified finding.

**Local first.** Today evidence never leaves the browser without consent.
Most intake (CSV, XLSX, PDF text, basic OCR) can also run in the browser.
Storing evidence on a server is a separate, deliberate decision (see below),
not a side effect of accepting more formats.

None of this intake is built. The hackathon build accepts JSON case files and
the simulated sample only.

## What exists (hackathon build)

| Area | State |
|---|---|
| Interface | Overview (the problem, the workflow, current scope) with the Change Healthcare case study; Investigations, where a case is opened and this session's runs are listed; an open investigation in three steps: Evidence, Analysis, Report. Nothing is stored or uploaded; the list is kept in the browser tab only. |
| Evidence intake | A JSON case file, read and checked in the browser (`docs/CASE_FILE.md`), and the simulated InfoPro sample case. |
| Investigation type | Authentication events: logons, denied logons, account use. |
| AI | Gemini Nano on the device by default; `gemini-3.5-flash-lite` through Firebase AI Logic only after the analyst consents, every time. App Check protects the cloud path. |
| Verification | Deterministic checks in `src/lib/verify.ts`: cited events exist, are of the kind and outcome the finding's type states, and match its times (to the second when quoted), accounts and computer names. |
| Output | Findings on the page with their verdicts, an exported HTML report and a JSON run record, each naming its own run. "How verdicts work" shows all four verdicts on the sample, from a proposal written by the team, with no AI involved. |

The two models do not perform the same. On the sample case one cloud run
verified 3 of 3 findings. One Nano run, as recorded on 15 November, verified 2
of 8; re-checked with the verifier as it is now, it has 1 verified, 3
rejected, 1 contradicted and 3 unchecked (README, correction of 17 November),
and its classification was not supported by the evidence. One run each shows
the difference; it does not measure it.

## Planned: how organisations connect (not built)

**Everything in this section is Planned.** None of it exists in this build,
and the app does not show it (owner's decisions, 2026-11-20 and 2026-11-23).

### Where AEMAS sits

AEMAS investigates a bounded case: events that an analyst, a SIEM or another
security platform has already narrowed to one investigation. It is not a log
store, and it does not monitor systems. Two reasons:

- **Scale.** Gemini Nano takes about 50 events per run (measured 2026-11-12)
  and 42 to 100 seconds to answer. Raw authentication telemetry runs to
  millions of events a day. Selecting what to investigate is the job of the
  systems in front of AEMAS.
- **Privacy.** Evidence stays in the analyst's browser unless they consent to
  send it to the cloud model. A design that streams an organisation's logs to
  an AEMAS server would give that up.

Receiving events through an API is not monitoring either: an organisation
chooses which events to send for an investigation. AEMAS does not claim
continuous monitoring or live alerts.

### One evidence format, many sources

Integrations are **API-first**: connecting to the HTTP APIs of the systems an
organisation already uses comes before any new file format. Every source goes
through a connector into one evidence format, and the same engine:

```
Source systems (identity providers, SIEMs, endpoint platforms, other APIs)
  -> connector, one per source: maps the source's records
  -> evidence in the case-file event format, validated fail closed
  -> the existing investigation engine (AI proposal)
  -> the existing deterministic verification
  -> analyst review, report and run record
```

- **The case-file event structure (`docs/CASE_FILE.md`) is version 1 of the
  internal evidence schema.** Each event has an ID, date and time, source,
  actor, action, target, outcome, optional logon type and detail, and its
  provenance: the source, line or record ID, and the original record.
  Connectors translate into it; the investigation engine and the verifier do
  not change for each source.
- **Provenance is required.** A connector that cannot point each event back
  to its original record cannot feed verification (conversion rule 2 above).
- **The schema is versioned.** A new field or event type is a new version,
  with its own verification rules before any finding of that kind can be
  verified (see "more investigation types" below).

### Ingestion methods

| Method | How it would work | Status |
|---|---|---|
| Browser-side connectors | The analyst signs in to a source (for example Microsoft Entra ID sign-in logs, or Google Workspace login activity) from AEMAS, and the browser fetches selected records straight into the case. Evidence does not pass through an AEMAS server, so local-first processing and consent before any cloud send still hold. Needs: read-only, least-privilege scopes; tokens kept in memory for the session only, never stored or logged; admin consent and licences where the source requires them; a clear record of what was fetched, from where and when. | Planned |
| Ingestion API | A documented, versioned HTTP API, described in OpenAPI, through which an organisation's systems or SIEM send the events selected for an investigation. Needs everything in the next section first. | Planned |
| Webhooks | A security tool sends a selected case when an analyst or a rule opens one. Same requirements as the ingestion API. | Planned |
| File import | JSON case files exist today and stay: for offline investigations, testing, demonstrations and organisations without integrations. CSV and NDJSON to follow, through deterministic templates. | JSON exists; others Planned |
| Documents | PDFs and reports as supplementary evidence, in the "human documents" class above: they raise questions; they never support a verified finding. | Planned |

### Before any server-side ingestion is built

A server that receives security evidence changes the privacy model and
becomes a target. These are decided, recorded in `docs/DECISIONS.md` and
tested before it accepts real data:

- **Authentication** of every sender: per-organisation credentials, rotation
  and revocation.
- **Tenant isolation:** one organisation's evidence is never readable by
  another, with tests that try.
- **Audit trail:** who sent, viewed, analysed or exported which evidence, and
  when; append-only.
- **Storage and retention:** what is stored, where, how it is encrypted, for
  how long, and deletion on request.
- **Access control** for analysts within an organisation.
- **Input limits:** size and rate limits; validation that fails closed, as the
  case-file loader does.
- **Cloud AI on held evidence:** whether a cloud model may see it, and on
  whose consent.
- **A security review** of the ingestion endpoint.

### What does not change

The investigation engine, the deterministic verification, the four verdicts,
consent before evidence reaches a cloud model, and file import.

## Planned: more investigation types (not built)

| Area | Example evidence |
|---|---|
| Phishing | Email headers, sender domains, links, attachments |
| Endpoint | Process execution, file changes, persistence |
| Network | Connections, DNS, unusual traffic |
| Cloud | Identity and permission changes, API activity |
| Account security | Privilege changes, account creation, credential misuse |

Each type needs its own parser, finding types and verification rules. A
phishing file must not be run through the authentication engine: its claims
("this link points to a lookalike domain") need checks written for that
evidence. Until such checks exist, findings of that kind are "unchecked",
never "verified".

MITRE ATT&CK gives a shared vocabulary for tactics and techniques. AEMAS shows
an ATT&CK reference only beside a verified finding, as a reference and not a
conclusion; new types follow the same rule.

## Rules for describing the product

- Planned items are labelled "Planned" in every document. The app does not
  show them: it shows only what the product does (owner's decision,
  2026-11-20; previously they were listed in the app, labelled Planned).
- AEMAS is never described as monitoring, a SIEM, EDR, a firewall or an
  automated response system. Its full name uses "Matching" for that reason.
- The sample case is simulated and is always labelled so.
- The case study separates the public record from hypothetical use, and says
  AEMAS was not used in that incident.
- Verification checks the evidence for a finding; it does not show that an
  attack occurred or that a classification is right.
- No claim that Gemini Nano and the cloud model perform equally, and no
  performance ranking from single runs.
