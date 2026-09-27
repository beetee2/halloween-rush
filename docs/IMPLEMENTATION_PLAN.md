# Halloween Rush — Implementation Plan

Ordered checklist. Items are ticked only when actually done.

1. [x] Foundation: npm + Vite + strict TypeScript + Three.js, configs, scripts, plan/design docs
2. [x] Pure rules: config, RNG, run state machine (timer, hearts, immunity, scoring, snapshot/replay/next/new run), difficulty, fire control, collision, persistence — with unit tests
3. [x] Haunted House vertical slice: renderer/stage, launcher, pumpkin projectiles, all six target types, spider attack loop, candy bag, HUD, mouse (pointer lock + drag fallback) and touch input
4. [x] Remaining environments (Graveyard, Spooky Forest, Pumpkin Patch, Haunted Carnival), teleport + countdown, replay checkpoints, capped repeating progression
5. [x] Polish: models, candy flight + bag pile, synthesized audio, responsive UI/safe areas/rotate prompt, pause/blur handling, bounded effects, disposal
6. [x] LAN delivery: `dev:lan`, `serve:lan` static server, verify script
7. [x] Verification: typecheck, unit tests, build, Playwright smoke tests (desktop + touch viewport + two contexts), screenshot review, docs updated
   - [x] Fixed during verification: ground vanished at zero pitch (every level start) under software WebGL
   - [x] Fixed: holding Space through the end of a level auto-pressed the focused Next Level button
   - [x] Fixed: a pointer-lock grant arriving after a pause left the mouse captured on the pause menu
   - [x] Fixed: off-screen threat markers covered the timer
8. [ ] Not done (needs hardware/people): real phone/tablet, Safari/Firefox, and a second household device over the LAN — see VERIFICATION.md
9. [x] Scoreboard: name entry on game over (top 10), local fallback board, legacy best carried over as "???"
10. [x] Household scores database: node:sqlite JSON API in serve-lan and Vite, device id + fingerprint, outbox sync, level-best names, career leaderboard with per-map averages, Leaderboards screen
11. [x] Home Screen: manifest, Apple web-app tags, icons
12. [ ] Pumpkin Patch: new ground and darker dusk lighting
