---
name: diagnose
description: Run a disciplined diagnostic to find the ROOT CAUSE of a bug, outage, or weird behavior (not just the symptom). Use for "why is X happening", "X is broken/offline", "this came back after I deleted it", connectivity/data issues.
---

# diagnose — root-cause a problem, don't patch the symptom

Work the problem like an investigator: gather evidence before theorizing, narrow by elimination, prove the cause,
then fix the cause (not the surface). Report findings in plain English with the technical term in parentheses.

## Process
1. **Define the symptom precisely** — what's observed vs. expected, when it started, how reproducible, scope (one item or all).
2. **Gather evidence first** — read the relevant code, logs, network requests, DB records, configs. Don't guess from memory.
   Prefer observing the REAL system (live request, real data) over assuming.
3. **Form hypotheses** — list plausible causes; rank by likelihood given the evidence.
4. **Narrow by elimination** — run cheap, read-only tests that each rule a hypothesis in or out (e.g. probe an endpoint,
   diff two records, check a timestamp, isolate one variable). One change at a time.
5. **Prove the root cause** — confirm the actual mechanism, not a correlation. State the chain: cause → effect → symptom.
6. **Fix the cause** — smallest change that removes the root cause; check for the same pattern elsewhere.
7. **Verify on the real thing** — reproduce the original trigger and confirm it's gone. Report faithfully if unverified.

## Notes
- Classic traps to check: soft-delete without a filter (deleted items reappear), caching/stale state, auth/permission
  (403s), connectivity at the wrong layer (SIM/cellular vs. device), last-write-wins sync clobbering.
- Escalate to the user only for genuinely risky/irreversible steps; otherwise investigate and act.
