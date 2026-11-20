# Product direction

Project Studio is an AI-assisted security investigation and evidence
verification platform. It collects security evidence, has AI propose what
happened, checks every proposed finding against the evidence in code, and
leaves the decision to the analyst.

**AI proposes. Code verifies. The analyst decides.**

The authentication investigation is the first working capability, not the
whole product. This document separates what exists in this build from what is
planned, so that no page, README, video or submission claims a capability the
code does not have.

## Scope and direction (agreed 16 November 2026)

Project Studio investigates **technical incidents**. It is not an HR
investigation, dispute or legal judgement platform: where the only evidence is
testimony, there is nothing for code to verify, and the product says so.

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
| Overview dashboard | Counts the model runs made in the current browser session: investigations, verified findings, findings needing review, events examined. Nothing is stored or uploaded; with no runs it says so. |
| Evidence intake | A JSON case file, read and checked in the browser (`docs/CASE_FILE.md`), and the simulated InfoPro sample case. |
| Investigation type | Authentication events: logons, denied logons, account use. |
| AI | Gemini Nano on the device by default; `gemini-3.5-flash-lite` through Firebase AI Logic only after the analyst consents, every time. App Check protects the cloud path. |
| Verification | Deterministic checks in `src/lib/verify.ts`: cited events exist, are of the kind and outcome the finding's type states, and match its times and accounts. |
| Output | Report on the page, exported HTML report and JSON run record, each naming its own run. |

The two models do not perform the same. On the sample case one cloud run
verified 3 of 3 findings and one Nano run verified 2 of 8 (2 rejected, 1
contradicted, 3 unchecked) and proposed a classification the evidence did not
support. One run each shows the difference; it does not measure it.

## Planned: how organisations connect (not built)

JSON stays the exchange format. What changes is how evidence arrives.

| Method | How it would work |
|---|---|
| File import | Exists today for JSON case files; CSV and other exports to follow. |
| API ingestion | An organisation's systems send events to a Project Studio endpoint. |
| Webhooks | Security tools push events when something happens. |
| Local collector | A small agent forwards approved logs from company systems. |

```
Company systems (Windows, Linux, cloud, security tools)
  -> collector, webhook or API client
  -> ingestion endpoint (authenticated, per organisation)
  -> normalisation and validation (fail closed, as the case-file loader does)
  -> investigation (one engine per evidence type)
  -> AI proposal
  -> deterministic verification
  -> analyst dashboard and reports
```

Anything server-side changes the privacy model: today evidence never leaves
the browser without consent. An ingestion service would hold evidence, so it
needs its own decisions on storage, retention, access control and tenancy
before it is built.

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

MITRE ATT&CK gives a shared vocabulary for tactics and techniques. Project
Studio shows an ATT&CK reference only beside a verified finding, as a
reference and not a conclusion; new types follow the same rule.

## Rules for describing the product

- Planned items are labelled "Planned" in every document. The app does not
  show them: it shows only what the product does (owner's decision,
  2026-11-20; previously they were listed in the app, labelled Planned).
- The sample case is simulated and is always labelled so.
- Verification checks the evidence for a finding; it does not show that an
  attack occurred or that a classification is right.
- No claim that Gemini Nano and the cloud model perform equally, and no
  performance ranking from single runs.
