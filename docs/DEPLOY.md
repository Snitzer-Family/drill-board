# Getting Coach.Vision online, and the day-to-day workflow

Two apps, two Vercel projects, one repo, one lockfile. Everything is
git-connected: a branch gets a preview URL, `main` is production.

The steps below marked **(you)** need your accounts and can't be done from here.

---

## The loop, once it's set up

```
edit  →  npm test / npm run typecheck  →  look at it locally
      →  push a branch  →  Vercel comments a preview URL  →  check it on your phone
      →  merge to main  →  production, ~60–90s
```

Local:

```bash
npm install                # root, once — links the workspaces
npm run dev                # website → http://localhost:3000
npm run dev:board          # board   → http://localhost:5173
npm test                   # every tests/*.mjs, from the repo root
npm run typecheck
npm run build              # website (production build)
npm run build:board        # board
```

> Don't run `next dev` and `next build` against `apps/web` at the same time —
> they share `.next` and the build clobbers the dev server's assets. The symptom
> is a page that loads with no CSS at all.

To reach either from a phone on the same wifi, bind to all interfaces:
`npm run dev -w @coachvision/web -- -H 0.0.0.0 -p 3000` and open
`http://<your-mac's-lan-ip>:3000/`.

---

## One-time setup

### 1. Push the repo **(you)**

The repo is currently `snitzer-family/drill-board`. Renaming it to
`coach-vision` is tidier and GitHub redirects the old URL; nothing in the build
depends on the name any more. Optional, and safe to do later.

### 2. Turn off GitHub Pages **(you)**

Settings → Pages → Source: **None**. The `deploy.yml` workflow that published
there is already deleted; this just stops the old URL serving a stale build.
`.github/workflows/ci.yml` replaces it as a pure gate (tests + both builds on
every push and PR).

Also worth doing: Settings → Branches → protect `main`, require `ci` to pass.
A push to `main` now deploys **two** production sites, one of which is the app
you use at the rink.

### 3. Create two Vercel projects **(you)**

Both import the *same* repo. The only difference is the Root Directory.

| Setting | Website | Board |
|---|---|---|
| Project name | `coach-vision-web` | `coach-vision-board` |
| Framework Preset | Next.js | Vite |
| **Root Directory** | `apps/web` | `apps/board` |
| **Include source files outside the Root Directory** | **ON** | **ON** |
| Build Command | `cd ../.. && npm test && cd apps/web && next build` | `cd ../.. && npm test && cd apps/board && npm run build` |
| Output Directory | *(default)* | `dist` |
| Install Command | *(default)* | *(default)* |
| Node.js Version | 22.x | 22.x |
| Production Branch | `main` | `main` |

Two settings matter more than they look:

- **Include source files outside the Root Directory** must be ON, or
  `packages/drill-core` isn't in the build context and the very first deploy
  fails at `Module not found: @coachvision/drill-core`.
- The `npm test` prefix in the Build Command is deliberate. Vercel replaces
  GitHub Actions as the deployer, and "a red suite blocks the deploy" has to
  survive that move. Non-zero exit → no deploy.

If Vercel doesn't detect the workspace root and installs `apps/web` alone, set
the Install Command to `cd ../.. && npm ci`.

Optionally set each project's **Ignored Build Step** to
`git diff --quiet HEAD^ HEAD -- . ../../packages/drill-core ../../package-lock.json`
so a website-only change doesn't rebuild the board and vice versa.

### 4. Environment variables **(you)**

On the **website** project, for Production *and* Preview:

```
NEXT_PUBLIC_SITE_URL   = https://coach.vision
NEXT_PUBLIC_BOARD_URL  = https://board.coach.vision
AUTH_PROVIDER          = mock
BILLING_PROVIDER       = mock
AUTH_SECRET            = <run: openssl rand -hex 32>
```

`NEXT_PUBLIC_BOARD_URL` is the single place the site points at the board — every
"Open in the board" link and drill deep-link goes through `lib/config.ts`. Until
DNS is live you can point it at the board's `*.vercel.app` URL.

The board project needs no env vars.

### 5. Deploy once with no custom domain **(you)**

Push a branch, open the preview URL Vercel comments on the PR, and check both
apps work. Do this *before* touching DNS — it separates "did the build work"
from "did DNS propagate".

For the board specifically, check on the actual iPhone: add to home screen,
confirm the safe-area layout, and open a long `#d=` share link.

### 6. DNS **(you)**

Add `coach.vision` and `www.coach.vision` to the **website** project (set the
apex as primary — Vercel then issues the www→apex redirect for free), and
`board.coach.vision` to the **board** project. Then at your registrar:

| Type | Name | Value |
|---|---|---|
| `A` | `@` | `76.76.21.21` |
| `CNAME` | `www` | `cname.vercel-dns.com` |
| `CNAME` | `board` | `cname.vercel-dns.com` |
| `TXT` | `_vercel` | *(the challenge Vercel shows you)* |

Use TTL 300 while cutting over, then raise it to 3600. If your registrar
supports `ALIAS`/`ANAME`, prefer `ALIAS @ → cname.vercel-dns.com` over the A
record — it follows Vercel's anycast changes automatically.

**Read the A record off Vercel's domain screen rather than trusting the number
above** — they have changed it before.

SSL is automatic once the records resolve; give it a few minutes.

---

## After it's live

- The version watermark answers "did my change ship?" at a glance: the board's
  is in its bottom bar, the site's is in the footer. Bump `APP_VERSION`
  (`packages/drill-core/src/constants.js`) and `SITE_VERSION`
  (`apps/web/lib/version.ts`) on behavioural changes — they ship independently.
- `coach.vision` and `board.coach.vision` are separate localStorage origins.
  The theme preference crosses via a `cv_theme` cookie on `.coach.vision`
  (`BOOT_SCRIPT` reads localStorage first, then the cookie). Auth cookies will
  need the same domain when auth is wired.
- Auth and billing are stubs behind `lib/auth` and `lib/billing`. Swapping in a
  real provider means adding one file that implements the interface plus env
  vars — no call sites change. The mock refuses to load in production.
