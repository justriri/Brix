# Deploying WeekendGuard

This document is the result of an explicit deployment-readiness pass. It does
**not** pick a hosting platform — none is configured in this repository (no
`vercel.json`, `Dockerfile`, `Procfile`, `netlify.toml`, or CI cron job exists
here) — so nothing below assumes one. It documents exactly what the app
needs, what it's compatible with, and what you need to decide once you pick
somewhere to run it.

## 1. What this app actually is, at runtime

WeekendGuard is a plain Next.js app with **no platform-specific config**. In
production it runs as:

```
npm run build   # next build
npm run start   # next start — a single long-lived Node.js HTTP server
```

That single detail drives everything else below:

- Every API route that touches a Protection Monitoring Session declares
  `export const runtime = "nodejs"` — none of them can run on an Edge runtime
  (`node:sqlite`, used for persistence, does not exist outside Node.js).
- The app is **not** built as a set of independent serverless functions. It
  is one process. `next start` keeps that one process alive to serve every
  request.
- There is currently **no cron, no queue, no background worker** anywhere in
  this codebase, and the brief for this project explicitly forbids adding
  any of those. Scheduling is handled by an external HTTP trigger hitting
  `/api/protection-scheduler` — see section 4.

## 2. Node.js version requirement

Persistence (`src/lib/protection/db.ts`) uses Node's **built-in** `node:sqlite`
module (`DatabaseSync`) — deliberately, so this project adds **zero** new
npm database dependencies.

- `node:sqlite` first shipped in Node **22.5.0**, but only behind an
  `--experimental-sqlite` CLI flag.
- As of Node **22.13.0** (LTS) and **23.4.0**, that flag requirement was
  dropped — `node:sqlite` works with no flags at all (still marked
  experimental in the docs, but functionally complete for what this app
  uses: `DatabaseSync`, `.exec()`, `.prepare()`, `.run()/.get()/.all()`,
  transactions, `ON CONFLICT`).
- Node **24** is what this project was built and tested against
  (`node --version` → v24.18.0 during development) and is the recommended
  version — see `.nvmrc`.

**Pinned in this repo:**
- `package.json` → `"engines": { "node": ">=22.13.0" }` — the floor below
  which `node:sqlite` would need the now-unnecessary experimental flag (this
  project does not pass that flag anywhere, so anything older than 22.13.0
  will fail to start).
- `.nvmrc` → `24` — the recommended/tested version for `nvm use` / `fnm use`
  / most platforms' "Node version" build setting.

**Action for you:** whatever platform you choose, set its Node version to
24.x (or at minimum 22.13+) explicitly. Most platforms read `.nvmrc` or
`engines` automatically; some (see below) require you to set it in a
dashboard instead.

## 3. SQLite persistence: where it works and where it doesn't

The current architecture is:

```
node:sqlite (DatabaseSync)
    -> ./data/weekendguard.sqlite (one file, WAL mode)
    -> one long-lived Node process
    -> persistent local disk
```

This is **kept as-is** — no new database was introduced, per the explicit
instruction not to add one unless deployment genuinely requires it. Whether
it's compatible depends entirely on where you deploy:

| Deployment shape | SQLite file persists? | Compatible as-is? |
|---|---|---|
| VPS / dedicated server (systemd, pm2, screen, etc.) | Yes — real local disk | **Yes** |
| Docker container **with a mounted volume** at the DB path | Yes — volume survives container restarts | **Yes** |
| Docker container **without** a volume | No — filesystem resets on every redeploy | No |
| Platform-as-a-service with a persistent volume/disk add-on (e.g. a Railway volume, a Fly.io volume, a Render persistent disk) | Yes, if the volume is mounted at `WEEKENDGUARD_DB_PATH` | **Yes** |
| Platform-as-a-service running your app as a single always-on service, no serverless functions, no persistent disk configured | No — most "ephemeral filesystem" PaaS instances reset on redeploy/restart | No, until a volume is added |
| Serverless functions (Vercel serverless/Edge functions, Netlify Functions, AWS Lambda) | **No** — each invocation can be a different, short-lived container; the filesystem is ephemeral and not shared across invocations or instances | **No** — this architecture fundamentally does not fit a serverless invocation model, regardless of the SQLite file's path |
| Cloudflare Workers / any Edge-only runtime | N/A — `node:sqlite` doesn't exist there (not Node.js) | **No** |

**Be precise about why**, since "serverless" and "no persistent disk" are two
distinct problems that are easy to conflate:
- A **persistent-disk-but-serverless** platform would still break this
  architecture, because `next start`'s single-process assumption (one
  `DatabaseSync` connection, in-process WAL) doesn't hold when your own code
  can be cold-started into a fresh container per request.
- A **single-process-but-ephemeral-disk** platform would break it for the
  opposite reason: the process model is fine, but the file itself vanishes.

**If you deploy to a serverless/ephemeral-filesystem platform**, the
honest answer is: this SQLite architecture does not survive there, and a
real network database (Postgres, etc.) would be required. That change is
**not made in this task** — it's out of scope unless you tell us the actual
target and confirm it's serverless, per the explicit instruction not to
introduce a new database speculatively.

**Set `WEEKENDGUARD_DB_PATH`** to point at your mounted volume's path if
your platform's default writable directory isn't where you want the file
(e.g. a Railway volume mounted at `/data` → `WEEKENDGUARD_DB_PATH=/data/weekendguard.sqlite`).

## 4. Scheduling: external cron, not `setInterval()`

There is no native cron facility in this repository, and none is invented
here. **Do not treat a `setInterval()` loop inside the Next.js process as a
production scheduler** — it only runs while that one process instance stays
up, provides no guarantee across restarts/redeploys, and silently stops
working the moment the process is replaced. This codebase contains no
`setInterval()`-based scheduler anywhere, by design.

Instead, trigger monitoring from **outside** the app, on a schedule, over
HTTP:

```
POST https://your-deployed-host/api/protection-scheduler
Authorization: Bearer <SCHEDULER_TRIGGER_SECRET>
```

(or `GET .../api/protection-scheduler?secret=<SCHEDULER_TRIGGER_SECRET>` —
both work identically; `GET` exists specifically for simple HTTP-ping cron
services that can't set custom headers.)

### What triggers this in practice

Any of these work — none are configured here, because none should be
invented without knowing the real target:
- A platform's own native cron/scheduled-task feature, if your chosen
  platform has one (many do, as an add-on separate from the web service).
- A free external HTTP cron service (e.g. cron-job.org, EasyCron, GitHub
  Actions on a `schedule:` trigger running `curl`).
- Any existing infra you already operate that can make an HTTP request on a
  timer.

### Recommended interval

**Every 1–6 hours** is a reasonable, practical interval. You do **not** need
to hit the exact Saturday/Sunday/Monday timestamp:
- The scheduler (`protectionScheduler.ts`, unmodified by this task) already
  asks the existing schedule module "what's due right now?" on every call —
  it doesn't matter how long it's been since the last trigger.
- **Idempotent**: triggering it twice, or a hundred times, for the same due
  checkpoint records it once — enforced by the existing SQL `UNIQUE
  (sessionId, checkpoint)` constraint, re-verified against the production
  build in section 7 below.
- **Catches up after downtime**: if the cron (or the whole app) was offline
  across multiple due checkpoints, the next trigger discovers all of them
  and applies the existing missed-checkpoint logic (`missedCheckpoint.ts`,
  unmodified) to whichever ones were never captured — it does not silently
  skip them.
- A shorter interval (e.g. hourly) only means less time between a checkpoint
  becoming due and it actually being recorded — it does not change
  correctness either way. A very long interval (e.g. once a day) risks more
  checkpoints being recorded as "missed" than you'd like, since
  `monitoringSchedule.ts`'s default spacing is 24h per checkpoint — hourly
  to every-few-hours is the practical sweet spot. `monitoringSchedule.ts`
  itself was **not** changed for this task.

### What happens if...

| Situation | Behavior |
|---|---|
| Cron runs twice in a row for the same due checkpoint | Second call sees it `ALREADY_RECORDED_SKIPPED`; exactly one checkpoint persists. |
| The server (or just the cron) was offline across 2+ due checkpoints | Next trigger records all of them in one call — real ones where data was fetched fresh, or synthetic `FAIL` "missed checkpoint" snapshots for windows that passed entirely uncaptured — then evaluates settlement if Monday was among them. |
| `SCHEDULER_TRIGGER_SECRET` isn't set, in production | The endpoint returns `503` and does nothing — see section 5. |
| One session's live data fetch fails (e.g. a Binance/Pyth outage) | That session is reported as `"failed"` in the response; every other due session in the same run is still processed normally. |

### Expected response shape

```json
{ "processed": 1, "skipped": 2, "failed": 0, "results": [ { "sessionId": "...", "outcome": "processed", "actions": [...] } ] }
```

Safe to call on any interval, from any number of overlapping triggers — see
section 6.

## 5. Scheduler authentication

`SCHEDULER_TRIGGER_SECRET` (optional env var):

| `SCHEDULER_TRIGGER_SECRET` set? | `NODE_ENV` | Behavior |
|---|---|---|
| No | `development` (`next dev`) | Open — no secret required. Local/demo convenience. |
| No | `production` (`next start`) | **Fails closed**: every request gets `503` and the scheduler never runs. Prevents an accidentally-public, unauthenticated trigger that anyone could hit repeatedly to spam live Binance/Pyth calls and mutate session state. |
| Yes | either | Request must supply the exact secret via `Authorization: Bearer <secret>` or `?secret=<secret>`; wrong or missing → `401`; correct → runs normally. |

`NODE_ENV` is set automatically by Next.js (`development` under `next dev`,
`production` under `next build`/`next start`) — nothing extra to configure
for that part. **You must set `SCHEDULER_TRIGGER_SECRET` yourself** before a
real deployment; generate any sufficiently random string (e.g.
`openssl rand -hex 32`) and store it with your host's secret manager.

## 6. Environment variables

All variables are server-only — **none use the `NEXT_PUBLIC_` prefix**, so
Next.js never inlines any of them into client-side JavaScript. Verified: no
client component (`"use client"` file under `src/components/`) imports
`chain.ts`, `providers/pyth.ts`, `providers/binanceRwa.ts`, or
`protection/db.ts` — the only files that read these secrets.

| Variable | Required? | Purpose |
|---|---|---|
| `PYTH_API_KEY` | Recommended | Live independent reference prices (Pyth Hermes). Without it, reference-price checks report "unavailable," never a fabricated number. |
| `BINANCE_WEB3_API_KEY` / `BINANCE_WEB3_SECRET` | Recommended | Binance Web3 RWA Data API (live bStocks/Ondo data). |
| `BSC_RPC_URL` | Optional | Your own BSC RPC endpoint; defaults to the public `bsc-dataseed.binance.org`. |
| `WEEKENDGUARD_DB_PATH` | Optional | Where the SQLite file lives; defaults to `./data/weekendguard.sqlite`. Point this at a mounted persistent volume in production (section 3). |
| `SCHEDULER_TRIGGER_SECRET` | **Required before any public deployment** | Guards `/api/protection-scheduler` (section 5). |

See `.env.example` for the same list with full inline explanations. Never
commit `.env.local`; it's already gitignored. Nothing in this codebase logs
a secret's value — the scheduler's own logging (section 8) deliberately logs
only counts, session ids, and durations.

## 7. Health check

`GET /api/health` → `{ "status": "ok", "timestamp": "..." }`. Added for this
task since none existed. Deliberately does nothing else — no DB read, no
Binance/Pyth call, no scheduler trigger — so a platform's health probe (or
you, right after deploying) gets an instant, side-effect-free answer.

## 8. Scheduler observability

`protectionScheduler.ts` logs (via `console.log`/`console.error`, no new
logging platform) on every run:
- run start: timestamp used, number of active sessions found
- run end: processed/skipped/failed counts, duration in ms
- any individual session failure: session id + error message only

**Never logged**: API keys, the scheduler secret, Authorization headers,
wallet keys, or raw provider responses. The HTTP response itself also
includes the full per-session breakdown (`results[]`) for the same run.

## 9. Production verification performed

Run as part of this task, using the repository's actual production
commands (`npm run build` then `npm run start` — not `npm run dev`):

- `npm run build` — succeeded.
- `npm run start` — the production server started and served requests.
- `GET /api/health` — returned `{"status":"ok",...}` against the production
  server.
- `/api/protection-scheduler` auth matrix — verified against the production
  server with `NODE_ENV=production` in effect: no secret configured → `503`;
  wrong secret → `401`; correct secret → runs.
- Full session lifecycle (start → persist → external-style HTTP scheduler
  trigger → Saturday → Sunday → Monday → settlement), a hard-kill-and-restart
  of the production server mid-weekend, a duplicate-trigger check, a
  missed-checkpoint scenario, and a broken-trust scenario — all against the
  production server/build, not the dev server. See the final report for
  exact results.

## 10. What's still out of scope

Unchanged from every prior milestone: no real USDT settlement, no reserve
pool, no premium collection, no wallet signing, no payout transactions —
`lib/protection/policy.ts` remains fully disabled. This task only makes the
existing (simulated) monitoring pipeline safe and correct to deploy and
trigger; it does not make WeekendGuard move real funds.
