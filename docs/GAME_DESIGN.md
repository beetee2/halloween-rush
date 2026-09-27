# Halloween Rush — Game Design

Stationary first-person Halloween shooting gallery in a real 3D world. The player aims a
pumpkin rocket launcher from a fixed spot, fires visible pumpkin projectiles, and teleports
to a new environment after surviving each 60-second level. Spooky-but-fun: bright colors,
silly monsters, pumpkin splats, candy sounds, no blood or gore.

_This document describes the delivered build. Every number below comes from `src/config.ts`._

## Confirmed rules

- Each level is **60 s of active play** and starts with **3 hearts**. Survive until the timer
  ends to complete it. Losing the last heart ends the run (game over).
- The player never moves. Aim is limited to a forward arc (yaw ±55°, pitch −12°…+38°), and
  every spawn lane and spider anchor lies inside it. Nothing attacks from behind.
- Unlimited pumpkins, no reload. A click/tap fires; holding repeats every **0.4 s** of
  simulation time on every input path and at any frame rate.
- Projectiles are real: they fly from the launcher muzzle toward the point under the crosshair
  (48 m/s). Each one hits the **first** thing along its swept path (target, solid scenery, or
  ground) and disappears. Sub-stepped swept-sphere collision prevents tunnelling at low frame
  rates. There is no splash damage; explosions are cosmetic.
- **Points are by explicit size class**, never by distance: small **50**, medium **25**,
  large **10**.

| Target | Size | Behaviour | Candy it drops |
| --- | --- | --- | --- |
| Frankenstein | large | walks left/right along ground lanes | Frankenstein gummy |
| Witch | medium | flies across the sky on a broom, cackles | witch chocolate |
| Spider | small (15% "big" medium) | descends on a web, swings, telegraphs, throws | spider gummy |
| Incoming jack-o'-lantern | medium | arcs from a spider toward the player | pumpkin cream |
| Candy corn | small | tossed up from the ground | candy corn |
| Sucker | medium | rises, hovers, sinks | sucker |

- Frankensteins and witches score but never attack. Candy targets score and add candy only.
- A hit awards points and one candy **exactly once**: a target stops being hittable the
  instant it is hit, and the award happens at that moment, not when the candy lands.

### Spiders and incoming pumpkins

Each spider runs a readable cycle: descend on a visible thread → swing/bob → **prepare** (glows,
front legs rear up, hiss, off-screen edge warning) → throw a jack-o'-lantern → move again.
One hit kills a spider; hit spheres are body-centred and forgiving (radius 0.46 m, or 0.64 m
for big spiders). Shooting a spider stops its future throws but not a pumpkin already in the air.
Shooting an incoming pumpkin cancels its damage and drops pumpkin candy. A pumpkin that arrives
removes one heart, followed by **1.2 s of damage immunity**. Level 1 allows one spider and one
incoming pumpkin at a time. Every spider anchor sits inside the aimable arc with a clear line
of sight (checked by tests for all five environments). A spider winding up, or a pumpkin
flying, outside the current view shows a pulsing edge marker pointing at it.

### Level sequence and difficulty

1. Haunted House — crooked porch, glowing windows, picket fence, roof/eave spiders
2. Graveyard — headstones, iron gates, mausoleum, low fog, bare trees
3. Spooky Forest — twisted trees, glowing mushrooms, sky gaps, fallen log
4. Pumpkin Patch — giant pumpkins, scarecrows, hay bales, crooked barn and silo, harvest arch
5. Haunted Carnival — striped tents, booths, string lights, turning Ferris wheel

After level 5 the cycle repeats as "Night 2", "Night 3", and so on. Difficulty goes linearly
from `difficulty.easy` (level 1) to `difficulty.hard` and is **capped from level 13** on. It
raises spawn rates, walk/fly speeds, simultaneous spiders and pumpkins (max 3), and throws per
spider, and shortens spider wind-up and pumpkin flight time (3.0 s → 2.0 s). Every level stays
60 s with 3 hearts.

## Run state and scoring semantics

```
title ──Start──▶ teleporting ──scene ready──▶ countdown (3 s) ──▶ playing
                     ▲                              │  ▲             │
                     │                          pause  resume    timer 0 / last heart
                     │                              ▼  │             ▼
  Next / Replay ─────┴──────────────── levelComplete ◀── paused   gameOver ──New Run──▶ teleporting
```

- Only `playing` accepts shots, spawns, damage and scoring. Presses during the countdown are dropped.
- **Final heart vs timeout:** within one simulation step the world applies hits and damage
  first. `RunModel.advance` then checks hearts **before** time, so a last heart lost in the same
  step the timer expires means **game over**.
- **Checkpoint model:** `checkpoint` = committed score + candy from earlier levels, captured
  when a level attempt begins. The attempt accumulates into `levelScore` / `levelInventory`.
  The HUD shows the level points and the running total (checkpoint + attempt).
- **Replay Level** discards the attempt and restores the checkpoint, timer and hearts. Replaying
  any number of times never stacks points or candy.
- **Next Level** folds the completed attempt into a new checkpoint, restores 3 hearts, and
  teleports on.
- **Game over** shows the run total including the failed level's partial score. **New Run**
  clears score and candy but keeps settings and personal bests.
- **Personal best** ("Best run on this device!") = highest total at a completed level or game
  over. It is committed once per attempt, so a replay can't inflate it. Best score and furthest
  level are saved locally.
- Pause (key, button, Esc/pointer-lock loss, window blur, hidden tab, page hide, portrait
  rotation, lost WebGL context) freezes the timer and clears all held input. Resuming never
  consumes hidden time. Frame deltas are clamped to 0.1 s and split into ≤1/60 s steps.

## Names and leaderboards

Each device reports to the host's SQLite database (`scripts/scores-api.mjs`): a `run` when a run
starts, an `attempt` when a level ends (completed, or failed at game over), and a `name` when
the player types one. Events wait in a `localStorage` outbox until the host confirms them. They
carry client-made ids, so resending is harmless. A device may only add to or name its own runs.

- **Run total** on the boards = the latest attempt per level of that run: the same replay
  semantics as the in-game score, so replays never stack.
- **Level best** = highest *completed* attempt for a level number (replayed attempts included).
  Beating it (or setting the first one) makes the results screen ask for a name.
- **Scoreboard** = top 10 run totals (ties: older first). It is always shown at game over. A run
  that makes it (beats 10th place strictly) asks for a name unless one was already typed during
  that run, in which case it's saved directly. With the host unreachable, a local top 10 is used.
- **Career** = per player: total of run totals, games, best run, furthest level, and average
  points per level attempt on each map (every attempt counts toward averages). Players are grouped
  by name (case-insensitive); unnamed runs are grouped per device as "Guest (label)".
- Names are cleaned the same way on both sides (whitespace collapsed, control characters
  removed, max 16 characters) and are always rendered as text.
- **Device identity:** a random id per browser (`localStorage`) plus a fingerprint hash
  (browser, screen, GPU, language, time zone) and a label like "iPhone · Safari". The id is the
  identity; the fingerprint is kept only to recognise the same hardware.

## Candy bag

A lathe-modelled cloth sack with a jack-o'-lantern face sits in the lower-left of the view
(camera space, so it never blocks the crosshair). Each hit launches the matching miniature
candy on a 0.6 s arc into the bag, which bounces and chimes. The inventory is exact and
unbounded. What you see is a representative pile of at most 26 meshes, split by kind in
proportion to the real counts. At most 12 candies fly at once. The bag carries over between levels.

## Adopted defaults

Beyond the brief: witch/Frankenstein/candy spawn intervals and caps in `config.difficulty`;
a 3 s countdown and 0.7 s + 0.7 s teleport swirl; a 1.2 s immunity window; 15% "big spider"
chance (medium, 25 pts); spawn delays of 0.6 s (Frankenstein) to 8 s (sucker) at level
start; caps of 16 targets, 12 projectiles, 260 particles and 8 score popups; pixel ratio capped
at 2 (desktop) / 1.5 (touch); no real-time shadow maps (baked blob shadows instead).

## Architecture

| Area | Files | Notes |
| --- | --- | --- |
| Config | `src/config.ts` | all tuning in one place |
| Rules | `src/core/run.ts`, `scoreboard.ts`, `fireControl.ts`, `difficulty.ts`, `collision.ts`, `inventory.ts`, `persistence.ts`, `rng.ts` | no DOM/WebGL; unit tested |
| Simulation | `src/sim/world.ts`, `targets.ts` | spawning, behaviours, projectiles, hits; runs headless in Node tests |
| Rendering | `src/render/stage.ts`, `builder.ts`, `materials.ts`, `textures.ts`, `effects.ts`, `hud3d.ts` | vertex-coloured merged geometry, shared materials, pooled meshes |
| Models / scenes | `src/render/models/`, `src/render/environments/` | procedural low-poly characters, candy and five environments; each environment disposes its GPU resources |
| Input | `src/input/input.ts` | pointer lock + drag fallback, multi-pointer touch, keyboard |
| Audio | `src/audio/audio.ts` | synthesized Web Audio (no files), unlocked by a gesture |
| UI | `index.html`, `src/ui/` | DOM screens, HUD, leaderboard tabs, name entry, safe areas, rotate prompt |
| Scores | `src/net/device.ts`, `scoreSync.ts`, `scripts/scores-api.mjs` | device id/fingerprint, outbox + sync; SQLite JSON API mounted by `serve-lan.mjs` and the Vite dev/preview servers |
| Home Screen | `public/` | manifest (fullscreen, landscape) and icons rendered from `icon.svg` by `scripts/make-icons.mjs` |
| Orchestration | `src/game.ts`, `src/main.ts` | one independent `Game` per browser tab; gameplay never shared |
| Test fixtures | `src/testHooks.ts` | only in `vite build --mode e2e`; absent from production builds |
