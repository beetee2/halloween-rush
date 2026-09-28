# AGENTS.md

Guidance for coding agents working on Halloween Rush, a first-person Halloween shooting
gallery built with TypeScript (strict), Three.js and Vite. See `README.md` for player-facing
docs and `docs/` for the design, plan and verification notes.

## Commands

| Task | Command |
| --- | --- |
| Type-check | `npm run typecheck` |
| Unit/simulation tests | `npm test` |
| Browser smoke tests | `npm run test:e2e` (needs `npx playwright install chromium` once) |
| Dev server (hot reload) | `npm run dev` → http://localhost:5173 |
| Production build | `npm run build` → `dist/` |
| Serve build on the LAN | `npm run serve:lan` → port 4173 |
| Deployed setup locally (Worker + local D1) | `npm run build && npx wrangler dev` → port 8787 |

Run `npm run typecheck` and `npm test` before finishing any change.

## Gotchas

- `serve:lan` (sirv) indexes `dist/` at startup. After `npm run build`, **restart it** or the
  new hashed bundle returns 404.
- Pushing to `main` triggers a Cloudflare deploy (`wrangler.jsonc`): `dist/` as static assets plus
  `worker/index.mjs` for `/api/*`, with the shared leaderboards in the D1 database
  `halloween-rush-scores` (auto-provisioned; no `database_id` in the config). That database is
  live player data: never reset or rewrite it from tests or scripts.
- `scripts/scores-core.mjs` runs in the Worker, so it must not import `node:*` modules; Node-only
  code goes in `scripts/scores-api.mjs`. Schema changes must upgrade existing databases (new
  `attempts` columns go in `ADDED_COLUMNS`), and each request should stay at a few D1 calls
  (use `batch()`): the free plan allows 50 queries per request.
- D1 bills every row a query reads (free plan: 5M a day). The boards read small summary tables
  that SQLite triggers keep up to date (`DERIVED` in `scores-core.mjs`), about 400 rows per
  refresh however long the history is. Never make a board query scan `attempts` or `runs`.
  Editing `DERIVED` rebuilds it from the full history on the next request: that's a one-time
  cost of about 50 rows read and 7 written per stored run. Trigger bodies must use uppercase
  `BEGIN`/`END`, no comments and no other `END` (use `iif`, not `CASE`), or remote D1 splits them.
  The "leaderboard summaries" test checks them against boards recomputed from the history.
- Nothing is loaded from files: models, textures and sounds are all generated in code. Don't
  add asset files or third-party assets.
- Dev servers write scores to `data/dev-scores.sqlite`; `serve:lan` uses the real household
  file `data/halloween-rush.sqlite`. Never touch the real one in tests.
- Test hooks (`__HR__`, `installTestHooks`) must stay out of the production bundle.
- Scoreboard names are an allowlist (`src/core/names.mjs`), enforced by the game and the scores
  API. Test data needs listed names such as `Hudson`, `Dad` or `Brad2`, not `P1` or two words.
  Plain `Player` is stored as no name (`runName`): unnamed runs count per device and show as Player.
- Search engines render without WebGL. The no-WebGL path (`UI.showError`) must keep the title
  card visible; don't turn it back into a separate error screen.
- The production origin `https://halloweenrush.app` is hardcoded in `index.html`,
  `about/index.html` and `public/{robots.txt,sitemap.xml,llms.txt}`; `tests/seo.test.ts` checks
  they agree. A new indexable page needs a Vite input, a sitemap entry and a `PAGES` entry there.

## Where things live

- `src/config.ts` — all gameplay tuning (timings, points, sizes, difficulty, caps).
- `src/core/` — pure rules (run state, scoring, scoreboard, fire rate, collision, saves).
  `names.mjs` + `nameList.mjs` (the allowed scoreboard names) are plain JavaScript so
  `scripts/scores-core.mjs` (LAN host and Worker) can import them too.
- `src/sim/` — targets, spawning, projectiles and hits; runs headless in tests.
  `World` reports events (`targetSpawned`, `spiderThrow`, …) that `src/game.ts` turns into
  sound and effects.
- `src/render/` — Three.js stage, procedural models, the five environments, HUD, effects.
- `src/audio/audio.ts` — Web Audio synth. Add a sound by extending the `Sfx` union and the
  `play()` switch; spawn sounds per target kind are mapped in `SPAWN_SFX` in `src/game.ts`.
- `src/ui/`, `src/input/`, `src/net/` — DOM screens, input, score sync with the host.
- `scripts/` — LAN server, scores API (`scores-core.mjs` rules/SQL/HTTP shared with the Worker;
  `scores-api.mjs` wraps `node:sqlite` in the D1-style interface), icon + link-preview image generator.
- `worker/` — Cloudflare Worker entry for the deployed game's `/api/*`.
- `about/index.html`, `src/ui/about.css` — plain-HTML About / how-to-play / FAQ page for search
  engines and AI assistants; crawler files live in `public/`.

## Style

Match the surrounding code: strict TypeScript, small focused modules, short doc comments on
non-obvious behavior. Keep it simple (YAGNI).
