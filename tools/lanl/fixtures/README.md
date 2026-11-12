# Synthetic LANL-format fixtures

Every line in these files was written by hand for tests. None of it is from
the LANL dataset. The field order follows LANL's published format for
`auth.txt.gz` and `redteam.txt.gz` (csr.lanl.gov/data/cyber1/). The
identifiers (`U9000xx`, `C9000xx`, domain `SYN`) are invented and chosen to
be easy to tell apart from real ones.

The cases each line covers:

| auth line | covers |
| --- | --- |
| 1 | a machine account (`$`) as source user, a different destination user |
| 2, 3 | two identical lines, as the red-team file also repeats lines |
| 4 | `?` (missing) values and a `LogOff` |
| 5 | red-team user matches the destination user only |
| 6 | a `Fail` result, on day 2 |
| 7 | a Kerberos service ticket (`TGS`): ticket activity, not a sign-in |
| 8 | a record outside the windows the tests select |

Red-team lines 1–3 match auth lines 2–3, 5 and 6 on time and computers.

Raw LANL files never go in the repository. They live in `~/Data/lanl-cyber1/`.
