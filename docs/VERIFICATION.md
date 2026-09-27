# Halloween Rush — Verification

Last full run: 2026-09-26, on the final code in this folder.

## Environment actually used

- Arch Linux (kernel 7.2.6), Node.js 26.10.0, npm 12.1.0
- TypeScript 7.0.2, Vite 8.3.1, Vitest 5.0.2, Three.js 0.186.1, sirv 3.0.2
- Playwright 1.63.0 with its bundled **headless Chromium 153.0.8010.12**. WebGL runs on
  **SwiftShader (software)**, so frame rates there say nothing about real hardware.
- Network paths: loopback (`127.0.0.1`) and this machine's own LAN address (`192.168.254.116`).

## Automated checks (all executed, all passing)

| Command | Result |
| --- | --- |
| `npm run typecheck` | exit 0, no errors |
| `npm test` | **54 / 54 passed** (3 files) |
| `npm run build` | exit 0: `dist/index.html` 8.2 kB, CSS 11.0 kB, JS 699 kB (186 kB gzip) |
| `grep -c "__HR__\|installTestHooks\|nearEnd" dist/assets/*.js` | 0: test fixtures are absent from the production bundle |
| `npm run verify:serve` | **19 / 19 PASS**: entry page, JS and CSS with correct content types over 127.0.0.1 **and** 192.168.254.116, 404 for missing files, no path traversal outside `dist/`, no remote URLs in HTML/CSS |
| `npm run test:e2e` | **13 / 13 passed** (about 2.1 min) |

### Unit and simulation tests (`tests/`)

- **run.test.ts**: size-based points (small 50 / medium 25 / large 10; witch 75, candy corn 100) plus range bonus (near +0 / medium +5 / far +10);
  one score + one candy per hit, only while playing; 3 s countdown then exactly 60 s of play;
  pause/resume consumes no time; heart loss plus immunity against overlapping impacts; last
  heart ends the run; **final heart beats timeout in the same step**; no damage outside play;
  replay restores the level-start snapshot (repeated replays, no stacking); Next Level keeps
  score/bag, restores hearts, advances the environment; game over includes the partial level;
  new run clears score/candy but keeps bests; replay never inflates the best; illegal phase
  transitions rejected.
- **rules.test.ts**: 0.4 s fire cadence when held at 30/60/144/240 fps; rapid taps from several
  inputs never exceed the rate; buffered press; cancel on pause; segment–sphere entry,
  anti-tunnelling, boxes and ground; five-environment cycle, level-1 limits, monotonic capped
  difficulty; persistence round-trip, throwing storage, malformed/hostile JSON, quota exceeded.
- **world.test.ts** (the real `World`, models and all five environments, headless): a shot
  travels and hits once; two pumpkins on one target score once; scenery blocks shots; no
  tunnelling through a small spider at very low frame rates; projectile cap. The spider
  cycle (descend, telegraph, throw, heart lost on arrival); shooting a preparing spider
  prevents the throw; an already-thrown pumpkin survives its spider's death; shooting the
  pumpkin prevents damage and gives pumpkin candy; level 1 has at most one spider/pumpkin.
  Targets, projectiles and scene children stay bounded across many repeated levels. Every lane
  and spider anchor is aimable and unobstructed in each environment. **No solid vertex sits
  on the camera's vertical axis** (regression test, below). Environment disposal.

### Browser smoke tests (`e2e/game.spec.ts`, production-style `--mode e2e` build served by `serve:lan`)

The e2e build adds `window.__HR__` fixtures that fast-forward simulation time, toggle spawning,
spawn/aim at a target and apply a hit. Rules are unchanged, and the fixtures are not in `npm run build`.

1. Title shows "Halloween Rush" (never "Pumpkin Panic") over a populated 3D scene. Checked by
   sampling the WebGL buffer (> 60 distinct colours, luminance spread), not just by canvas existence.
2. Level flow: a real mouse click launches a pumpkin; hitting a sucker gives 25 points and a
   sucker in the 3D bag; results screen; Next Level → Graveyard with total carried; Replay twice
   restores the level-start total and candy each time; best stays 50.
3. Pause key, window blur while holding fire, hidden tab and pointer-lock loss all pause with no
   time consumed and no phantom auto-fire after resuming.
4. Holding Space through the end of a level does not press the focused Next Level button, but a
   fresh Space press still does (keyboard access).
5. Three hits → game over with the partial total; New Run resets to level 1 with an empty bag;
   best score survives a reload.
6. `localStorage` that throws on access never blocks play.
7. Desktop drag-to-aim fallback when pointer lock is unsupported: a drag turns without firing, a click fires.
8. Touch phone context (844×390, `hasTouch`, `isMobile`, DPR 2): taps on the scene never fire;
   two-finger aim + hold-fire at once; the fire finger doesn't rotate the camera; held fire
   never exceeds 1 shot per 0.4 s; portrait shows the rotate prompt and pauses without
   changing level, score or hearts.
9. Resizing through 900×600, 1600×900, 700×900 and 1280×720 keeps the canvas sized and rendering.
10. **Two browser contexts are independent sessions** (score and pause in one don't affect the other).
11. Every request is same-origin (or `data:`), and play continues with the context **offline**
    through a level completion and teleport.
12–13. Visual tour of all five environments with Frankensteins, a witch, a spider, candy corn and a
    sucker spawned (incoming pumpkins appear when spiders throw), at desktop 1280×720 and
    phone-landscape 780×360, with screenshots.

## Screenshot review

Screenshots in `e2e/screenshots/` (regenerated by each e2e run) were inspected by eye:
title, play, pause, results, game over, phone title/play/portrait, and the desktop and phone
tours of all five levels. Each environment is recognisably different in geometry. Frankensteins,
a broom-riding witch, web-hanging spiders, a thrown jack-o'-lantern, swirl suckers, the
launcher (lower right), the candy bag (lower left) and the touch FIRE button all render.

## Defects found and fixed during this verification

- **Ground and foreground vanished at every level start.** The ground was a triangle fan whose
  centre vertex sat directly below the camera. At pitch exactly 0 (the reset aim at every level
  start) that vertex has clip-space w = 0, and SwiftShader smeared the fan over the lower half of
  the screen, hiding the fence, path, launcher and bag until the player moved the mouse. The
  ground fan is now offset, and a unit test checks all five environments for vertices on the
  camera axis. Whether hardware GPUs showed this is untested; players on software WebGL
  (machines without usable GPU acceleration) would have. The fix removes the degenerate
  geometry either way.
- **Holding Space as a level ended skipped the results.** Key auto-repeat landed on the focused
  Next Level button and its keyup clicked it. A fire-key press that starts in play is now
  swallowed until released.
- **Mouse stayed captured on the pause menu.** A pointer-lock grant arriving just after a pause
  (for example, clicking Resume then immediately switching windows) was kept. The input layer
  now releases any grant the game no longer wants.
- **Off-screen threat markers covered the timer.** Markers are now kept below the HUD's top rows.
- Test-only: the pause test clicked Resume before the asynchronous pointer-lock release had
  landed, so the click went to the locked canvas. The test now waits for the release.

## Not verified (be explicit)

- **No real phone or tablet** was used. Touch coverage is Chromium mobile emulation plus CDP touch
  events, which is not proof of iOS Safari or Android Chrome behaviour (safe areas, audio unlock,
  touch latency, performance).
- **No Firefox, Safari/WebKit or hardware-GPU Chromium** runs. All automated rendering was software (SwiftShader).
- **No second household device connected** over the LAN. The LAN address was only exercised from
  the host itself (`verify:serve`), so firewall and Wi-Fi isolation on a real network are untested.
- **Performance was not measured** on any real device. Headless SwiftShader ran at roughly 20 fps
  at 1280×720, which reflects software rendering, not the game.
- **Audio** was not listened to. Only that the synthesized-audio code runs without errors (no page or
  console errors in any e2e test).

## Manual acceptance steps (for a person with the devices)

1. `npm run build && npm run serve:lan` on the host; note the printed `Local network` URL.
2. On a desktop browser: Start, confirm the mouse is captured, and shoot a Frankenstein (10), witch
   (75), spider (50), candy corn (100) and sucker (25), each +5 at medium range or +10 far. Watch each matching candy fly into the bag.
3. Let a spider throw; shoot one jack-o'-lantern (pumpkin candy) and let one hit (a heart is lost
   and the screen shakes). Press Esc: it pauses and the timer holds. Resume.
4. Finish the level: check the results totals, Replay (the total returns to the level-start value), then Next Level.
5. On a phone on the same Wi-Fi, open the URL in landscape. Drag to aim while holding FIRE; rotate
   to portrait (prompt + pause); rotate back and Resume. Confirm sound after the first tap.
6. Play on two devices at once and confirm the scores are independent.
