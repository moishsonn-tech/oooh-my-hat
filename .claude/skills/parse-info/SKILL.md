---
name: parse-info
description: Turn messy/unstructured information (logs, dumps, screenshots, API responses, documents, spreadsheets) into clean, structured, validated output. Use for "parse this", "extract X from Y", "make sense of this data", "pull the fields out".
---

# parse-info — extract clean structure from messy input

Convert raw input into a reliable structured form, flagging anything uncertain rather than inventing it.

## Process
1. **Identify the target shape** — what fields/records are actually wanted, and in what format (table, JSON, list).
   If unstated, infer the obvious schema and say what you assumed.
2. **Locate the real source** — read the actual data with the right tool (not a guess). For big/multi-file inputs,
   sweep broadly first, then extract.
3. **Extract field by field** — map each output field to where it came from. Keep units, IDs, and exact values intact.
4. **Validate** — check types/ranges/formats; cross-check related fields for consistency (e.g. totals, matching keys).
5. **Flag gaps & conflicts explicitly** — mark missing, ambiguous, or contradictory values as such; never fabricate to
   fill a hole. If the source is unreliable/inconsistent (common with third-party APIs), say so.
6. **Output** — the clean structure plus a short note of assumptions, gaps, and any data-quality caveats.

## Rules
- Faithfulness over completeness: an honest "missing/uncertain" beats a confident wrong value.
- Cite where each non-obvious value came from so it can be re-checked.
