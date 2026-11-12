# LANL case selector: frozen specification

Status: **frozen 2026-11-12.** The rule was frozen on 2026-11-11 except
`MAX_EVENTS`, which was set to 50 on 2026-11-12 from the Nano measurement
below, before the scan ran. Nothing in this file may change after the scan
has run.

## What this is, and is not

- A deterministic baseline for this experiment: it ranks windows of LANL
  authentication data by one heuristic, first-seen account-to-computer pairs.
  It is not a general-purpose anomaly detector, and its results here do not
  show that it would work elsewhere.
- **Label-informed design, label-blind execution.** The rule was written after
  the red-team distribution had been seen (concentrated on days 9 and 13, one
  source computer on 701 of 749 lines). It takes no day, computer or user as
  input, reads only `auth.txt.gz`, and is not adjusted after its results are
  compared with the labels. It is not a fully blind experiment.

## Input

`~/Data/lanl-cyber1/auth.txt.gz`, sha256
`eee54f2ee202756f25e403b7b896ec1d4c6152f1ab65fc1b5beb3a3187faf53d`,
1,051,430,459 records, times non-decreasing (inventory, 2026-11-11). The scan
refuses to run if the inventory does not match the file.

## Definitions

- **Account:** the source user and the destination user of a record, each
  exactly as written (two accounts when they differ). Every account counts:
  user (`U…@…`), machine (`C…$@…`) and other (anything else, such as
  `SYSTEM@…`). The type is kept for reporting only.
- **Pair:** (account, destination computer).
- **First-seen pair:** a pair that no earlier record in the file has formed,
  counting from line 1. Within one window a pair counts once.
- **Dataset hour:** `floor((time - 1) / 3600)`; hour 0 is the first hour.
- **Window:** one computer X in one dataset hour h.
- **Window evidence:** every record in hour h that names X as source or
  destination computer. This is exactly what the case builder selects for
  `computers: [X]` over that hour, so the count is the case size.
- **Score:** the number of distinct first-seen pairs formed by records in hour
  h whose source computer is X.

## Rule

1. Excluded: hours 0 to 167 (days 1 to 7), where most pairs are first-seen.
   This also excludes the 49 red-team lines on days 2, 3, 6 and 7; the report
   says so.
2. Eligible: score at least 1, and window evidence from 5 to `MAX_EVENTS`
   records inclusive. Fewer than 5 records give too little to investigate.
3. Rank by score (higher first), then distinct destination computers of X's
   outgoing records in h (more first), then hour (earlier first), then
   computer name (string order).
4. **Evaluation case: rank 1.** It is never replaced, whatever its labels show.
5. **Control:** the same computer X, another hour h' ≥ 168 with score 0, whose
   window evidence size is closest to the evaluation case's (ties: earlier
   hour). If X has no such hour: any computer, hour ≥ 168, score 0, size
   closest, ties by earlier hour then computer name.
6. `MAX_EVENTS` = **50**: the largest tested size whose system prompt,
   evidence, schema and longest permitted answer fit within 90% of Nano's
   context window (measurement below).
7. If the evaluation case or the control does not fit or does not finish on
   Nano when it is run, that is recorded as Nano's result for that case. The
   case is not trimmed, replaced or re-selected.

## Evidence-size limit: the Nano measurement (2026-11-12)

Script: `tools/lanl/measure-nano-budget.js`, run once by the owner in Chrome
156 on the owner's Mac, Gemini Nano `available`, through the Prompt API
(`measureContextUsage`, `contextUsage`, `contextWindow`). Synthetic evidence
only: invented records in LANL's shapes and the inventory's mix of event
types, turned into rows by the real converter (`tools/lanl/case.ts`). System
prompt: GS-03's plus the LANL time note, as a stand-in for the LANL prompt.

| | Tokens |
| --- | --- |
| Context window | 9,216 |
| 90% of the window | 8,294 |
| System prompt (session usage after creation) | 311 |
| Output reserve: a stand-in answer with 8 findings of 4 citations and 5 actions | 766 |
| Evidence prompt, 20 / 45 / 50 / 55 events | 2,690 / 6,075 / 6,748 / 7,424 |
| Per event, 10 to 100 events | about 135 |

Sizes 10 to 100 were measured in steps of 5. System + evidence + reserve is
7,825 at 50 events (fits) and 8,501 at 55 (does not).

Real inference, one run each on a fresh session, with the response schema:

| Events | Finished | Seconds | Context used afterwards | Answer tokens | Findings | Schema valid | Overflow event |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 20 | yes | 41.9 | 3,652 | 462 | 8 | yes | no |
| 50 | yes | 53.9 | 7,706 | 457 | 8 | yes | no |

Limitations:

- **The schema's cost is not measured directly.** `measureContextUsage`
  returned the same count with and without the response schema. The real
  runs used 189 and 190 tokens more than system + evidence + answer, which
  is taken as the cost of the schema and turn framing. Counting 190 for it,
  50 events total 8,015 (87% of the window, still under the 90% line) and 55
  events total 8,691 (over it). The limit is 50 either way.
- **The answer has no hard size limit.** The schema bounds the number of
  findings, citations and actions, not the length of a sentence. The reserve
  is an estimate; at 50 events about 1,200 tokens remain beyond it.
- **Synthetic rows stand in for real ones.** Checked by length only: 40,000
  groups of 50 consecutive real records from day 8 (lines 130,000,001 to
  132,000,000) give prompts of 18,400 to 19,320 characters, against 18,851
  for the synthetic 50. Consecutive records are not a one-computer window,
  and characters are not tokens. A real 50-event case is expected to fit; it
  has not been run.
- **The LANL system prompt is not written yet.** A longer prompt takes from
  the margin.
- **One run per size, on one machine.** The timings show that 50 events
  finish in about a minute there. They are not a benchmark.
- A first attempt with an earlier version of the script measured nothing
  (it called `measureInputUsage`, which web pages no longer have) and its
  two inference runs overlapped; it is not used.

## Output (no labels)

Written to `~/Data/lanl-cyber1/candidates.json`, outside the repository:
the top 10 eligible windows, and for each: computer, day and elapsed hour,
evidence size, score in total and by account type, distinct destinations,
distinct accounts, and the mix of orientations, outcomes and logon types;
the control; the number of eligible windows and the score distribution.

## Deterministic baseline inside a case

Frozen with the rule: the baseline flags the case events that formed a
first-seen pair. The model's covered events are compared with these flags
and with the labels.

## After the cases are frozen

Labels are applied only after both case files exist. Reported separately:

- Selector: how many of the top 10 windows contain at least one labelled auth
  record; labelled records inside them out of all labelled records.
- Baseline and model, per case: labelled events covered and missed,
  unlabelled events flagged, verification pass rate, latency.
- Ground truth with no auth record (14 red-team lines) and ground truth in
  excluded days (49 lines), each counted on its own, never as misses.

A demonstration case chosen with the labels' help, if made, is labelled as
such and never contributes to these results.
