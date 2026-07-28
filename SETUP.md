# Setup — hosting (HTTPS-first), git, naming

## The complete "accounts you need" list (to build a kit-style app from zero)
1. **GitHub account** (one PER company — see §3): code home + free HTTPS hosting via Pages.
2. **Google account** (the company's): Firebase/Firestore for data (see INTEGRATIONS.md §5
   recipe), Google sign-in for auth, Apps Script mail relay, Sheets/Drive.
3. **A server (droplet), ONLY if the app needs server-side secrets or device/webhook traffic** —
   many apps don't: static frontend on Pages + Firestore + Google auth = zero servers.
4. **A domain** for the company (subdomain per app, §1). Optional for pure-internal tools
   (`<user>.github.io/<repo>` works), required for anything client-facing.
That's the whole dependency list; everything else in INTEGRATIONS.md (Stripe, maps, email) is
added per-feature, not up front.

## 0. Installing this kit on a new computer (if you received it as a zip)
1. Unzip the whole folder anywhere (e.g. `C:\Users\<you>\app-starter-kit` or `~/app-starter-kit`).
   Keep the hidden `.claude` folder inside it — that's where the skills live.
2. The skills (`new-app`, `harden`, `breakdown`, `diagnose`, `parse-info`) work automatically in any
   Claude Code session opened INSIDE this folder. To make them available in EVERY session on the
   machine, copy the folders from `app-starter-kit/.claude/skills/` into `~/.claude/skills/`
   (`C:\Users\<you>\.claude\skills\` on Windows).
3. `CLAUDE.md` in this folder carries the owner's full build style (engineering priorities, security
   checklist, UI aesthetic) — a fresh Claude with no memory reads it and builds the same way. To apply
   the "explain big decisions in plain English" communication rule globally, copy that section into
   `~/.claude/CLAUDE.md`.
4. From there, follow section 4 below to start a project (or just say "/new-app").

## 1. Naming & URL conventions
- **Repo + host slug match.** Pick one short lowercase slug (e.g. `ops`, `installer`, `partners`)
  and use it for both the repo name and the subdomain. Human-friendly name lives in the UI only.
- **One subdomain per app:** `ops.<company>.com`, `installer.<company>.com`. Subdomains isolate
  blast radius and SSL per app — prefer them over stacking many apps under one domain's paths.
- **Separate prod from test:** `ops.<company>.com` (prod) vs `ops-test.<company>.com` or a
  separate static host. Never test on the prod host.

## 2. Hosting with HTTPS — pick one (all give automatic or easy TLS)

### A. Static host (recommended for no-build single-file apps) — HTTPS automatic, free
- **GitHub Pages:** push repo → Settings → Pages → deploy from branch. URL `https://<user>.github.io/<repo>/`.
- **Netlify / Cloudflare Pages / Vercel:** connect repo, auto-deploy on push, free TLS + a real
  domain you can point a custom subdomain at (CNAME). Best when you want `app.<company>.com`.
- Use these whenever the app needs no server-side secrets. If it needs APIs with secret keys,
  pair the static frontend with the proxy (below) on its own subdomain.

### B. Server (droplet) for the proxy/backend — HTTPS via nginx + Let's Encrypt
```
# one-time, on the server:
sudo apt install -y nginx certbot python3-certbot-nginx
# nginx site: proxy_pass http://127.0.0.1:3001;  server_name api.<company>.com;
sudo certbot --nginx -d api.<company>.com         # issues cert + adds 80->443 redirect
# certbot auto-renews via systemd timer; verify: sudo certbot renew --dry-run
```
- Add HSTS in the nginx server block: `add_header Strict-Transport-Security "max-age=31536000" always;`
- Run the proxy under a process manager (`pm2 start backend/proxy.js --name proxy`).
- **Never expose the raw HTTP port publicly** — nginx terminates TLS and proxies to localhost:3001.

### C. Sub-path of an EXISTING host (proven shortcut for small internal tools)
A new no-build app can ship as a subdirectory of an app you already host:
`https://ops.<company>.com/<newapp>/` — upload `index.html` (+ manifest) into a subfolder of the
existing nginx/static root. Zero DNS, zero TLS, zero nginx changes; live in minutes.
- Check the parent app's **service worker scope** first: a SW registered at `/` that intercepts
  fetches would capture the sub-app too (a push-only SW is harmless).
- Fine for tools with no server-side data (e.g. localStorage-only) even without an auth gate —
  there's nothing to protect. Anything with real data still needs the auth rules in CLAUDE.md.
- Graduate to its own subdomain (section 1) if it grows real users or a backend.

## 3. Using a DIFFERENT git account (e.g. a new company)
Per-repo identity so commits/keys don't cross companies:
```
# inside the new repo:
git config user.name  "Your Name"
git config user.email "you@<company>.com"
# dedicated SSH key for this account:
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_<company> -C "you@<company>.com"
# ~/.ssh/config:
#   Host github-<company>
#     HostName github.com
#     IdentityFile ~/.ssh/id_ed25519_<company>
# then clone/remote with the alias:
git remote add origin git@github-<company>:<org>/<repo>.git
```
Add the new public key to the new company's GitHub account.

## 4. Adopting this kit for a new project
1. Copy this folder, rename to the project slug.
2. Replace every `<PLACEHOLDER>` in `CLAUDE.md`, `.env.example`, and the skeletons.
3. `git init`, set per-repo identity (section 3), first commit, push to the new account's repo.
4. Choose a host (section 2) — **HTTPS from day one.**
5. Fill `.env` from `.env.example` (never commit it).
6. Open `CLAUDE.md` in Claude Code and describe the use case — it will build in the owner's style.
7. Adding email, payments, maps, scheduled jobs, browser automation, LLM calls, push, or PDF
   output? Read `INTEGRATIONS.md` for the proven option in each category before picking one.
