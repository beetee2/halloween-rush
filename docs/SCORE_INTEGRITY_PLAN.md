# Halloween Rush — Score Integrity Plan

Status: proposed (not implemented). Scope: the deployed game's online leaderboards
(`worker/index.mjs` on Cloudflare D1). The same code serves the LAN host, which gets the same
protection for free.

## The problem today

`POST /api/sync` trusts whatever a device says. One command puts a fake score on every board:

```bash
curl -X POST https://<game>/api/sync -H 'Content-Type: application/json' \
  -d '{"device":{"id":"any-device-1234"},"events":[{"type":"run","id":"run-fake-0001","player":"Anyone"},
       {"type":"attempt","runId":"run-fake-0001","attempt":1,"level":1,"map":"Haunted House","score":999999,"completed":true}]}'
```

The server checks only shapes and ranges (score ≤ 1,000,000, level ≤ 10,000, a device may only
touch its own runs). Nothing ties a score to having played.

## Goals and limits

| Attacker | Goal |
| --- | --- |
| Casual: devtools or `curl`, a made-up score | **Blocked outright.** A forged number must fail validation. |
| Scripted spam: thousands of runs or names | **Throttled.** It also has a cost here: spam can drain the free D1 budget and fill its storage (see the note at the end). |
| Determined: forges complete, consistent shot logs, or bots the real client | **Bounded and visible.** It can't beat what a flawless human could score. It costs real playing time per level. Flags and moderation clean it up. Phase 5 is what closes most of the remaining gap. |

Not a goal: a secret key in the client, or obfuscation. Anything shipped to the browser can be
read, so the server must never rely on the client keeping a secret. Names aren't accounts:
anyone can still type "Hudson". Name ownership is a separate feature.

## What makes this tractable

Every attempt now carries its **shot log**: the time, aim, target, range and points of each
shot. The rules that produce a score are pure code (`src/core/run.ts`, `difficulty.ts`,
`config.ts`). The server can therefore re-derive and bound a level's score from the log
instead of trusting the number.

## Phase 1 — Validate every attempt against the game rules (~1 day)

Move the server code to TypeScript so it can import the real rules instead of copying them:

- `scripts/scores-core.mjs` → `src/server/scores.ts`; `worker/index.mjs` → `src/server/worker.ts`
  (wrangler bundles TS itself; `main` in `wrangler.jsonc` changes).
- The Node host (`serve-lan.mjs`, Vite plugin) imports a bundle built by `vite build --ssr` into
  `dist-server/` as part of `npm run build`. The Vite config can import TS directly.
- Move the five map names out of `src/render/environments/index.ts` (which pulls in Three.js)
  into a pure `src/core/maps.ts`.
- New `src/core/verify.ts`: `verifyAttempt(attempt) → { ok: true } | { ok: false, reason }`. It is
  used by the server and unit-tested directly.

Checks, all exact or conservative, so an honest game never fails them:

| Check | Rule |
| --- | --- |
| Map matches level | `map === MAPS[levelParams(level − 1).environmentIndex]` |
| Score is earned | `score === sum(points of hits in the shot log)` |
| Points are legal | Each hit's points ∈ `pointsFor(target, size, zone)` over the sizes that target can have (spiders: small or the rare medium) |
| Fire rate | Shot times strictly increase, and each gap ≥ 400 ms − 1 sim step (~17 ms, from the fire control's overshoot carry) − 1 ms rounding |
| Level length | 0 ≤ ms ≤ 60,000 for every shot; at most ⌈60 / 0.4⌉ + 1 = 151 shots |
| Aim | yaw within ±55°, pitch within −12°…38° (`CONFIG.aim`; today the server allows ±10 rad) |
| Hit caps | Hits per target type ≤ 1 + ⌊(60 − firstSpawnSec) / (0.75 × interval)⌋ from `levelParams(level)` (spawn timers never run faster than 0.75 × interval); incoming pumpkins ≤ spider cap × throws |
| Order in a run | Level *n* only after the run has a completed level *n − 1*; attempt numbers increase |
| Game over is real | Add the heart-loss times to the attempt; a failed attempt needs 3 of them, at least 1.2 s apart (damage immunity), a completed one fewer than 3 |

A forged `score: 999999` now fails the score check: with no shot log, its hits add up to 0.
The ceiling for a fully forged, consistent log is roughly what hitting every target that
could possibly spawn would score, and the caps enforce it.

## Phase 2 — Server-issued runs with real-time pacing (~1 day)

Today the client invents run ids, so a script can post a whole 50-level run in one request.

- New `POST /api/runs {device}` → the server creates the run, and returns an unguessable
  `runId`, a `seed` and its own `startedAt`. Attempts are only accepted for runs the server
  issued to that device. The client stops calling `newId()` for runs.
- **Pacing:** an attempt is accepted only once enough server time has passed since
  `startedAt` to have played every attempt so far: Σ(3 s countdown + 60 s, or the time of the
  last heart lost for a game over) − 2 s tolerance each. Real play is always slower, with
  teleports and results screens on top. A delayed outbox only makes attempts later, so
  honest offline stretches still pass.
- **Offline starts:** a run started while the server is unreachable is played as normal but
  shown as *"Offline run — not on the online boards"*. It stays on this device's local
  scoreboard. A run started online still keeps levels finished offline: they wait in the
  outbox as they do today. That is the existing e2e offline test, and it stays green.
- The client seeds the World RNG with the server `seed`. That does nothing yet, but Phase 5
  needs it.
- Old cached clients (still sending their own run ids) are refused. They pick up the new code
  on the next load, because `index.html` is never cached.

A forger now needs a real minute of wall time per level, per run.

## Phase 3 — Abuse limits (~½ day)

- Cloudflare **Rate Limiting binding** (`ratelimits` in `wrangler.jsonc`). No plan restriction
  is listed in the docs, but confirm it in the dashboard.
  - Per client IP (`CF-Connecting-IP`): `POST /api/runs` 5 per minute; `POST /api/sync` 60 per
    minute.
  - Per device id: the same limits, so one IP behind a school NAT isn't a single bucket.
  - The limiter is per Cloudflare location and approximate. That's fine for stopping floods,
    but it isn't an accounting system.
- **Names:** reject names matching a small normalized blocklist (lowercase, common
  letter/number swaps) kept in code. The server stores the run as a guest and answers
  `nameRejected`; the client says "Try another name".
- Keep the existing size caps (1 MB body, 200 events, 1,000 shots).

## Phase 4 — Moderation and detection (~½ day)

- New columns: `runs.hidden`, `devices.banned`, `attempts.flags`. All boards exclude hidden
  runs and banned devices.
- **Automatic flags** on accepted attempts, for review rather than rejection:
  - accuracy ≥ 95 % over ≥ 40 shots;
  - a score within 10 % of the level's theoretical cap;
  - shot spacing at exactly the fire-rate floor for a whole level (a bot's signature).
- **Forensics:** store `sha256(ip + salt)` and `request.cf.country` per device, never the raw IP,
  so repeat abusers can be banned in bulk.
- No admin endpoint to secure: moderation goes through `wrangler d1 execute --remote`, with the
  commands documented in the README (list flagged, hide run, ban device, rename). Add a tiny
  `scripts/moderate.mjs` wrapper only if that proves tedious.

## Phase 5 (optional) — Replay verification (3–5 days, probably Workers Paid)

The only way to reject a well-forged but *impossible* log is to replay it:

- Make the simulation deterministic: fixed 1/60 s steps with an accumulator, instead of the
  current variable tail step. Log fire events by step index plus aim.
- Split environment *layouts* (lanes, anchors, spots, blockers) from their Three.js meshes, so
  the server can build a `World` without rendering.
- The server replays each attempt with the issued seed and inputs, and compares the score.
- Cost: about 3,600 steps per level. That is unlikely to fit the free plan's 10 ms CPU per
  request, so it needs Workers Paid ($5/month, 30 s CPU) or background verification.
- Even this doesn't stop an aimbot driving the real client. Its output is a genuine, if
  superhuman, game, and only Phase 4's flags catch that.

Recommendation: do Phases 1–4. Revisit Phase 5 only if flagged forgeries actually show up.

## Testing

- **Honest logs always pass:** run the real `World` + `RunModel` headless, as `world.test.ts`
  does, with a simple aim-and-fire bot. Cover full levels on every map and several difficulty
  levels and seeds, and require 100 % acceptance. This is the guard against false rejections.
- **Forgeries fail:** a wrong score sum, too-fast shots, impossible points, over-cap hits,
  out-of-range aim, a wrong map for the level, level skipping, and pacing violations (inject a
  clock into `createScores`).
- **e2e:** real play still reaches every board. A `curl`-style forged post is rejected. A run
  started offline shows "not on the online boards".
- **Rollout:** ship Phases 1–2 in report-only mode first. Log each would-be rejection and its
  reason (Workers Logs are already enabled) for about a week of real play, then switch to
  enforcing.

## Related: D1 cost and limits

**Read cost (fixed).** Leaderboard refreshes used to recompute all four boards from the full
history: 9.9k rows read at 100 stored runs, 142k at 1,000 and 1.76M at 10,000, so four players at
30 minutes a day would have run out of the free 5M rows/day within about two weeks. Triggers
now keep small summary tables current (`DERIVED` in `scripts/scores-core.mjs`), and a refresh
reads about 385 rows at every one of those sizes. A saved level now costs about 45 rows read and
12 written (it was 4 and 4). Honest play is therefore limited by the free 100k writes a day,
about 8,000 levels. Phase 1 moves this module to TypeScript, and the summary SQL moves with it
unchanged.

**What spam can still do (Phase 3 fixes it).** Nothing limits requests today, so a small script
can:

- use up the day's writes with about 45 requests of 200 events each (about 2,200 rows each;
  before the summary tables it took about 170);
- use up the day's reads with about 13,000 `GET /api/scores` requests;
- fill the free plan's 500 MB of storage with about 500 requests carrying maximum-size shot logs
  (1 MB each). Unlike the daily limits this never resets, and would need a manual cleanup.

Until the limits exist, a burst like that stops scores from saving for the rest of the day (UTC)
or, for storage, until someone deletes the junk. The game itself keeps working, and results wait
in each device's outbox.
