---
name: new-app
description: Scaffold a new web app project from Moshe's portable app-starter-kit. Use when starting a brand-new tool/app, especially for a different company or git account ("start a new app", "spin up a new project", "scaffold X").
---

# new-app — scaffold a new project the owner's way

Goal: stand up a fresh project from the portable starter kit (the `app-starter-kit` folder — on the
owner's main PC that's `C:\Users\moshe\app-starter-kit`; on another machine, wherever the kit was
unpacked) so it matches the owner's stack, UI, and security defaults, then wire it to the right git
account on HTTPS.

## Steps
1. **Confirm the essentials** (ask only these, nothing more): project slug (lowercase, used for repo + subdomain),
   the use case in one sentence, the target git account/org, and the host (GitHub Pages / Netlify-Cloudflare / droplet).
2. **Copy the kit:** duplicate the `app-starter-kit` folder to a new folder named after the slug.
3. **Replace every `<PLACEHOLDER>`** in `CLAUDE.md`, `.env.example`, `frontend/index.html`,
   `frontend/manifest.json`, and `backend/proxy.js` with project-specific values. Pick ONE brand accent color.
4. **Git identity (per-repo, never global):** set `user.name`/`user.email` for this company; create a dedicated
   SSH key (`id_ed25519_<company>`) + a `~/.ssh/config` host alias; add the remote via that alias. (See kit SETUP.md §3.)
5. **HTTPS from day one** — choose the host per SETUP.md §2; never plain HTTP. Static host = automatic TLS;
   droplet = nginx + Let's Encrypt + force-redirect + HSTS.
6. **Secrets:** create `.env` from `.env.example` (confirm it's gitignored); keys go server-side only.
7. **First commit + push** to the new account's repo. Then build the real use case on top of the skeleton,
   following the kit's CLAUDE.md (Engineering Priorities + Security + UI aesthetic).
8. **Integrations:** for any third-party capability (email, payments, maps, browser automation,
   scheduled jobs, LLM, push, PDF), consult the kit's `INTEGRATIONS.md` and default to its
   ✓-proven pick for that category.

## Rules
- Keep the no-build single-file shape unless the use case crosses into untrusted-external-users / large-team /
  heavy-perf territory (then flag stepping up to a framework — see the kit's "When to abandon no build step").
- Run `/harden` before the project is considered launch-ready.
