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

Run `npm run typecheck` and `npm test` before finishing any change.

## Gotchas

- `serve:lan` (sirv) indexes `dist/` at startup. After `npm run build`, **restart it** or the
  new hashed bundle returns 404.
- Pushing to `main` triggers a Cloudflare deploy of `dist/` (`wrangler.jsonc`).
- Nothing is loaded from files: models, textures and sounds are all generated in code. Don't
  add asset files or third-party assets.
- Dev servers write scores to `data/dev-scores.sqlite`; `serve:lan` uses the real household
  file `data/halloween-rush.sqlite`. Never touch the real one in tests.
- Test hooks (`__HR__`, `installTestHooks`) must stay out of the production bundle.

## Where things live

- `src/config.ts` — all gameplay tuning (timings, points, sizes, difficulty, caps).
- `src/core/` — pure rules (run state, scoring, scoreboard, fire rate, collision, saves).
- `src/sim/` — targets, spawning, projectiles and hits; runs headless in tests.
  `World` reports events (`targetSpawned`, `spiderThrow`, …) that `src/game.ts` turns into
  sound and effects.
- `src/render/` — Three.js stage, procedural models, the five environments, HUD, effects.
- `src/audio/audio.ts` — Web Audio synth. Add a sound by extending the `Sfx` union and the
  `play()` switch; spawn sounds per target kind are mapped in `SPAWN_SFX` in `src/game.ts`.
- `src/ui/`, `src/input/`, `src/net/` — DOM screens, input, score sync with the host.
- `scripts/` — LAN server, scores API (`node:sqlite`), icon generator.

## Style

Match the surrounding code: strict TypeScript, small focused modules, short doc comments on
non-obvious behavior. Keep it simple (YAGNI).
