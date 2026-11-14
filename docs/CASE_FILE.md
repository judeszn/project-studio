# Case files

A case file is a JSON file of authentication events that an analyst opens
from disk in Project Studio. The page reads and checks it in the browser. It
is not uploaded when it is opened, and it reaches a cloud model only if the
analyst allows the cloud for that case and then consents to the send.

`npm run lanl -- case` writes this format from the LANL authentication data.
Any tool can write it. The reader is `src/lib/casefile.ts`. A complete
example is the synthetic demo case, `src/data/demo-case.json`, which the page
opens with **Load demo case (synthetic)**.

## Format

```json
{
  "spec": { "id": "synthetic-sample" },
  "source": {
    "dataset": "SYNTHETIC test fixture (not LANL data)",
    "citation": "Project Studio synthetic fixture",
    "file": "SYNTHETIC-auth.txt"
  },
  "modelNotes": [],
  "events": [
    {
      "evidence": {
        "id": "E01",
        "date": "Day 2",
        "time": "elapsed 00:00:59",
        "source": "identity",
        "actor": "U900002@SYN",
        "action": "network logon",
        "target": "C900005",
        "outcome": "denied",
        "logonType": "Network",
        "detail": "Source computer C900002; authentication type Kerberos; result Fail."
      },
      "provenance": {
        "file": "SYNTHETIC-auth.txt",
        "line": 6,
        "raw": "86460,U900002@SYN,U900002@SYN,C900002,C900005,Kerberos,Network,LogOn,Fail"
      }
    }
  ]
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `spec.id` | yes | The case's name. Shown on the page and used in run-record file names |
| `spec.start`, `end`, `computers`, `users`, `maxEvents` | no | How the case was selected. Kept in the file; not used by the page |
| `source.dataset`, `citation`, `file` | yes | Where the records came from, shown to the analyst |
| `source.sha256` | no | Hash of the source file the case was built from |
| `modelNotes` | yes, may be empty | Instructions added to the model's system prompt, in order: how times are written, for example. At most 5, each at most 1,000 characters |
| `events` | yes | 1 to 50 events |
| `events[].evidence` | yes | The row a model sees |
| `events[].provenance` | yes | The source file, line number and original record the row was derived from. Shown to the analyst; never sent to a model |

Evidence fields:

| Field | Value |
| --- | --- |
| `id` | `E` and digits (`E01`), unique in the file. Findings cite events by it |
| `date`, `time` | Text, as findings must quote them |
| `source` | `"identity"` |
| `actor` | The account |
| `action` | One of the event types below |
| `target` | The computer or service acted on |
| `outcome` | `"success"` or `"denied"` |
| `logonType` | Optional text |
| `detail` | Text: everything else the record says |

Event types: `network logon`, `interactive logon`, `remote interactive logon`,
`service logon`, `batch logon`, `unlock logon`, `new-credentials logon`,
`network cleartext logon`, `cached interactive logon`,
`logon, type not recorded`, `logoff`, `ticket-granting ticket`,
`service ticket`, `AuthMap`, `ScreenLock`, `ScreenUnlock`.

## Limits

- 2 MB, UTF-8.
- 50 events. Measured 2026-11-12: 50 events fit Gemini Nano's context window
  in Chrome 156 (`docs/SELECTOR_SPEC.md`).

## What is refused

The file is refused whole, with every reason listed, and nothing in it is
used, when:

- it is not UTF-8, not JSON, not an object, or too large;
- a required part is missing, empty or of the wrong kind;
- it has no events or more than 50;
- an event ID is malformed or used twice;
- an event type, source or outcome is not one named above;
- **any field is present that this page does not name**, at any level.

The last rule is deliberate. A field the format does not know (ground-truth
labels, say) is not silently ignored or passed on; the file does not open.
Nothing is repaired, guessed or dropped.

## What reaches a model

- The system prompt: the fixed instruction for authentication cases
  (`authSystemPrompt` in `src/lib/prompts.ts`) followed by the file's
  `modelNotes`.
- One line per event, in the file's order:
  `ID | date time | source | actor | action | target | outcome | detail`.

Nothing else. `spec`, `source` and `provenance` stay in the page.

`modelNotes` are instructions to the model, so a case file is trusted as far
as its notes go: the page shows them before a run ("Instructions this file
adds for the model"). Read them before running a file someone else wrote.

## Where a case file runs

- **On this device** (Gemini Nano through Firebase AI Logic) by default.
- **The cloud is off** for a case file until the analyst ticks "Allow the
  cloud for this case". Consent is still asked before each send.
- With the cloud off, a run that cannot happen on the device fails. Nothing
  is sent, and the failure can be saved as a run record.

## Findings and checks

A model must give each finding one type, and code checks the cited events
against it (`src/lib/verify.ts`):

| Type | Every cited event must be |
| --- | --- |
| `logon` | a logon with outcome `success` |
| `denied_logon` | a logon with outcome `denied` |
| `other` | No rule. Never shown as supported |

Quoted times and account names are also checked against the cited events. A
`denied_logon` finding shows that an attempt was refused. It does not show
that access was obtained, that an account is compromised, or an attack. Code
does not read a claim's wording, so it cannot check that a claim stays within
that.

## Run records

After a run, completed or failed, "Download run record" saves a JSON file
(`project-studio.run-record/1`, `src/lib/record.ts`) holding: the case's id,
file name and SHA-256; the system and user prompts with their SHA-256; whether
it ran on-device or in the cloud, as the SDK reported; the model; whether the
cloud was allowed and consented to; latency and times; the browser; the
model's raw output; and the full verification result.

A run record contains the evidence, inside the prompt. Treat it as you treat
the case.
