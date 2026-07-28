---
name: breakdown
description: Decompose a project/system into its component parts and analyze each part for security AND optimization. Use for "break this down", "analyze the architecture", "review each part", "where are the risks and inefficiencies", planning a refactor or audit.
---

# breakdown — decompose a system and analyze each part

Map the system into discrete parts, then evaluate each one for security and optimization, ending with a prioritized
action list. Investigate the real code/infra first — don't analyze from assumption.

## Process
1. **Map the parts** — identify each component and where it lives: frontend, backend/proxy, database, auth, third-party
   integrations, deploy/host, data sync. For each, note its single responsibility and the data flowing in/out.
2. **Per-part security pass** — apply the `/harden` checklist to each component (secrets, auth boundary, trust,
   encryption, CORS, rate limits, SSRF, HTTPS, crown-jewel keys). Rate ✅/⚠️/❌.
3. **Per-part optimization pass** — for each: performance (load size, redundant work, full re-renders, N+1 fetches,
   missing caching), correctness/robustness (error handling, edge cases), and maintainability (duplication, single
   source of truth, dead code, coupling). Note concrete improvements.
4. **Cross-cutting check** — duplicated sources of truth, inconsistent patterns, things that should be shared.
5. **Output a table per part** (responsibility · data flow · security findings · optimization findings · risk level),
   then a **prioritized action list** ordered by impact-vs-effort, separating quick wins from larger refactors.

## Rules
- Prefer strangler-fig migrations over big-bang rewrites when recommending changes.
- Flag, don't silently fix, high-blast-radius changes — surface them for a decision.
- Explain findings in plain English with the technical term in parentheses.
