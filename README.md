# AEMAS

**AEMAS (AI Event Matching and Analysis System)** by PHANG Group: security
investigation and event matching. Built for #BuildHybridAI 2026 (Web/Chrome)
by Boluwatife Faturoti.

**Gemini Nano proposes. Deterministic engine verifies. The SOC decides.**

AEMAS investigates authentication events. Gemini Nano, running in Chrome on
the analyst's own machine, proposes findings, and every finding must cite the
events behind it. A deterministic engine checks each finding against those
events and gives it a verdict. The evidence stays on the device; Gemini in the
cloud is used only when the analyst consents, every time.

**Live app:** https://project.phang.store (no sign-in)

## Try it

In desktop Chrome:

1. Choose **Start an Investigation**, then **Use sample evidence
   (simulated)**: 18 authentication events.
2. **Evidence** shows each event with its original record.
3. **Analysis**: choose **On this device** (Gemini Nano) or **In the cloud**,
   then **Run analysis**. The cloud asks for consent before anything is sent.
4. Each finding shows its verdict and, if it failed, why.
5. **Report** exports an HTML report and a JSON run record.

**How verdicts work** shows all four verdicts on the same evidence, with no
AI involved. **Overview** explains the method; **Case Study** applies it to
the 2024 Change Healthcare attack, from the public record.

Gemini Nano needs a desktop Chrome and a device that supports Chrome's
built-in AI; the Analysis step shows its status. The cloud path and How
verdicts work run anywhere.

## How it works

```
Case file or sample  ->  checked in the browser; a bad file is refused whole
                     ->  Gemini Nano on this device
                         or, after consent, Gemini in the cloud
                     ->  findings that cite event IDs (fixed JSON schema)
                     ->  deterministic verification, finding by finding
                     ->  verdicts, HTML report, JSON run record
```

### Hybrid inference with Firebase AI Logic

All inference goes through Firebase AI Logic (`firebase` 13.2.0,
`src/lib/hybrid.ts`); the app never calls a Gemini API directly.

- One system instruction and one JSON schema serve both models:
  `onDeviceParams` for Gemini Nano through Chrome's Prompt API, and
  `inCloudParams` for `gemini-3.5-flash-lite`.
- **Before consent** the only mode is `ONLY_ON_DEVICE`, and the app refuses it
  when the browser has no Prompt API, because the SDK would otherwise send
  the request to the cloud.
- **After consent** the app uses `PREFER_ON_DEVICE` when Nano is unavailable,
  or `PREFER_IN_CLOUD` when Nano failed or the analyst chose the cloud.
- Every result records the mode and the SDK's `inferenceSource`, and the page
  and report say where the model ran.
- **App Check** with reCAPTCHA Enterprise protects the cloud path.

### Deterministic verification

`src/lib/verify.ts` checks every finding against the events it cites: the
events exist, have the kind and outcome the finding states, and the times
(to the second when quoted), accounts and computers it names belong to them.
It also catches repeated findings, and refuses malformed model output.

| Verdict | Meaning |
| --- | --- |
| Verified | Every check passes against the cited events |
| Rejected | A check failed; the reasons are listed |
| Contradicted | A cited event records the opposite of the finding |
| Unchecked | No rule covers this finding type; never counted as Verified |

Verification checks selected fields against the cited events. It does not
establish that a finding's full wording, interpretation or conclusion is
accurate. Every event keeps its source file, line and original record, so
each verdict traces back to the evidence. Events no finding cites are listed,
so nothing is left out silently. The model's explanation and classification
are shown as its proposal.

### Reports and run records

The HTML report opens without a network and prints to PDF. It names the run
it belongs to: the model, where it ran and when it started. The JSON run
record holds the case hash, the prompts with their SHA-256 hashes, the raw
model output, where the model ran and every check, so the verification can be
re-run from the record.

## Results

- **Offline, on the device.** On 23 November 2026, in desktop Chrome 157,
  Gemini Nano analysed the sample with the network switched off. The run
  record shows the browser offline when the 79-second run started and when it
  finished.
- **Both paths in production.** On 23 November 2026 at
  https://project.phang.store, the consented cloud run returned 3 findings,
  all Verified, in 3.5 s. Gemini Nano, on the device, returned 8: 1 Verified;
  2 Rejected, because they named a time or an account their cited events do
  not contain; 5 Unchecked, typed `other`, which no rule covers.
- **327 automated tests**, including the consent rules: nothing reaches the
  cloud before consent, and each send asks again.

### Evaluation on public data

One Gemini Nano run on each of two cases built from Los Alamos National
Laboratory's public authentication data. The cases were chosen by a frozen
rule, label-informed in design and label-blind in execution
(`docs/SELECTOR_SPEC.md`), and labelled only after both runs. On the
43-event evaluation case, a simple deterministic baseline covered 10 of 21
labelled red-team events; Nano's verified findings covered 0. Verification
showed none of Nano's seven failing findings as Verified. On the 7-event
control case, Nano's verified findings covered 3 of 3 labelled events and the
baseline 0, but Nano listed every successful logon, which the prompt asked it
not to do, and the control is not size-matched.

These are single runs. They show the verifier holding; they do not show that
Nano, with this prompt, finds red-team activity in this data. No LANL data is
in this repository or was sent to the cloud.

## Known limits

- Gemini Nano has been tested on one machine: an Apple M1 Mac (16 GB, macOS
  15.7.1) in desktop Chrome 156 and 157. Other hardware, operating systems
  and Chrome versions have not been tested, and Nano's availability depends
  on the device.
- Text inside event fields reaches the model as evidence, so a crafted field
  could steer what the model proposes. Resistance to prompt injection has not
  been tested.

## Run it locally

Requires Node.js 24.12 or later (`.nvmrc`) and desktop Chrome for on-device
inference.

```bash
npm ci
npm run dev
```

Open `http://localhost:5173` in Chrome.

**Cloud inference** needs a Firebase project with a web app and Firebase AI
Logic (Gemini Developer API). `.env.example` lists every variable:

| File (git-ignored) | Holds | Used by |
| --- | --- | --- |
| `.env.local` | The web app config (`VITE_FIREBASE_*`) | Every build |
| `.env.development.local` | `VITE_APPCHECK_DEBUG_TOKEN`, registered in App Check | `npm run dev` only |
| `.env.production.local` | `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`, registered in App Check | `npm run build` |

**Checks:**

```bash
npm test        # 327 tests
npm run lint
npm run build   # type check and production build
```

**Deploy:** `npx firebase-tools deploy --only hosting --project <your-project>`.

Case-file format: `docs/CASE_FILE.md`.

## Pre-existing work

The submission period opened on 11 November 2026 at 13:30 PT (22:30 WAT).
Two commits predate it:

- `01ee668`, 11 Nov, 13:55 WAT: the baseline. A Vite scaffold, Firebase AI
  Logic wiring, a first deterministic verifier with tests, and a
  proof-of-concept page for an earlier product direction. The code was
  written on 10 November.
- `85a5702`, 11 Nov, 14:21 WAT: GS-03, a synthetic credential-compromise case
  with its proof-of-concept page. It remains as a test fixture.

Everything else was built during the submission period: consent-gated hybrid
routing, the case-file loader and run records, the LANL tooling and
evaluation, the four-verdict report and export, the sample case and worked
example, App Check with reCAPTCHA Enterprise, and the AEMAS interface. The
commit history records what was done when.

## Repository

| Path | What |
| --- | --- |
| `src/lib/hybrid.ts` | Firebase AI Logic models, consent-gated routing |
| `src/lib/firebase.ts` | Firebase app and App Check |
| `src/lib/verify.ts` | Deterministic verification |
| `src/lib/casefile.ts` | Case-file loader |
| `src/lib/report.ts`, `src/lib/record.ts` | Report, export and run record |
| `src/App.tsx` | Pages, investigation steps, runs and consent |
| `src/data/` | Sample case, worked example, GS-03 fixture |
| `tools/lanl/` | LANL case building and evaluation (reads a local copy) |
| `docs/` | Case-file format; LANL case selector |

## Data and privacy

- Evidence stays in the browser unless the analyst consents to the cloud.
  AEMAS has no server of its own and saves no case data.
- The cloud path uses the free tier of the Gemini Developer API. Under
  Google's terms, Google may use what is sent and human reviewers may read
  it. Send only synthetic or non-sensitive data.
- The sample is simulated: InfoPro is PHANG Group's own product and has had
  no such incident.

## Licence

The project's original source code is licensed under the
[Apache License 2.0](LICENSE). Copyright and third-party attributions are in
[NOTICE](NOTICE). The licence does not cover third-party material: MITRE
ATT&CK content stays under MITRE's terms of use, the LANL dataset (not
included here) under LANL's terms, and dependencies under their own licences.
