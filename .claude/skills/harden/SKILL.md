---
name: harden
description: Security-audit an app/proxy/backend against the owner's checklist and report (or fix) gaps. Use for "is this secure", "harden X", "security review of the proxy", before launching, or before adding sensitive credentials (e.g. Tesla/payments).
---

# harden — security audit against the owner's standards

Audit the target, then produce a findings table (✅ solid / ⚠️ weak / ❌ broken) with a concrete fix for each gap.
Prefer to VERIFY live, not assume (e.g. probe an endpoint, attempt an unauthenticated read) — read-only checks only,
never destructive. After reporting, offer to apply the fixes.

## Checklist
1. **Secrets server-side only** — no API keys in client/browser code; proxy injects them.
2. **Auth-gating** — every `/api/*` (non-public) route requires a verified identity token (signature + iss/aud/exp +
   allowlist); privileged routes are admin-only.
3. **Client is never trusted** — any PIN/client gate is convenience, NOT the authorization boundary; the server validates.
4. **Database rules** — confirm the DB denies anonymous access (test with an unauthenticated read; expect 403/permission-denied).
5. **HTTPS/TLS** — no plain HTTP; force-redirect + HSTS; certs auto-renew.
6. **CORS** locked to the app origin, not `*`.
7. **Rate limiting** on the proxy (per-token/IP).
8. **Encryption at rest** for sensitive tokens (AES-256-GCM; key in a `0600` file or secrets store).
9. **SSRF guards** on any server-side fetch (host allowlist, block private IPs/localhost).
10. **Crown-jewel keys** (hardware command-signing, payment keys): server-only, encrypted, admin-gated, rate-limited,
    audit-logged, explicit confirm for actuating actions, minimum OAuth scopes, never logged.
11. **Secrets not in git** — `.env`/key files gitignored; check history isn't leaking keys.

## Output
A table of findings ordered by severity, each with: what's at risk, why, and the fix. Then ask whether to apply fixes.
