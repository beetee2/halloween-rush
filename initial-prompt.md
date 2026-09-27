# Build Halloween Rush

You are the lead developer responsible for designing, implementing, testing, and documenting **Halloween Rush**, a complete, playable 3D browser game.

**Do the work, not just the planning.** Inspect the workspace, create the small set of useful planning documents, then immediately implement and verify the game in this same task. Do not stop after scaffolding, a design document, a task list, or the first prototype. Build the complete scope below. Make reasonable implementation decisions, document them, and continue without asking routine design questions.

## 1. Workspace and working rules

- Read applicable repository instructions and inspect existing files, package scripts, and git status before editing. Preserve unrelated work. Use the current repository/directory; do not create a nested repository or modify unrelated projects.
- If this is an empty project, initialize it. If it already contains a suitable app, extend it rather than replacing it blindly.
- Use TypeScript in strict mode, Three.js, and Vite unless the repository already has an equivalent suitable foundation. Prefer a small, understandable application over unnecessary frameworks or infrastructure.
- Use the existing package manager and lockfile. For a new project, use npm and commit-ready lockfile output. Select compatible versions, consult official documentation when necessary, and record the toolchain actually used rather than guessing versions.
- No accounts, payments, analytics, cloud services, multiplayer infrastructure, database, or secrets are needed. Do not deploy publicly, change router/firewall settings, commit, or push without separate authorization.
- Keep progress reports brief. If a tool or environment limitation blocks verification, explain exactly what was blocked and complete everything else possible. Never report an unexecuted test as passing.

## 2. Product and nonnegotiable requirements

The title is **Halloween Rush** everywhere: title screen, browser title, README, and game documentation. Do not use the old working title, Pumpkin Panic.

This is a colorful, spooky-but-fun, stationary first-person Halloween shooting gallery in a **real 3D world**. The player sees a pumpkin rocket launcher and fires visible pumpkin projectiles. Use perspective, depth, geometry, lighting, and recognizable 3D characters—not a flat canvas shooter, screenshot, or collection of 2D enemy sprites.

The player never walks. They aim from a fixed position and teleport to another environment after completing a level. Keep gameplay within a readable forward-facing aiming area; no threats behind the player.

Support both mouse-and-keyboard computers and touch phones/tablets. One computer hosts the files on the local network. Anyone with the local URL can load the game and play an independent single-player session. Multiple simultaneous players must not share gameplay state.

Style: bright Halloween colors, silly monsters, cackling witches, satisfying pumpkin splats, candy collection sounds, and no blood or gore. Prioritize readable silhouettes, responsive controls, and satisfying feedback.

### Confirmed gameplay

- Each level lasts **60 seconds of active play** and starts with **three hearts**.
- Survive until time expires to complete the level.
- Results show level score and running total, with **Next Level** and **Replay Level** buttons.
- Next Level teleports to the next environment and restores three hearts.
- Losing all three hearts before completion ends the run.
- Smaller targets score more: use explicit small, medium, and large categories. Do not derive points from apparent screen size or distance.
- Frankensteins walk left and right. Witches fly through the sky on brooms.
- Difficult-to-hit spiders descend on webs and throw jack-o'-lanterns at the player. Both spiders and their incoming jack-o'-lanterns are shootable.
- Candy corn and suckers appear **out in the world as shootable targets**, not merely as decorations beside the player.
- A physical **3D candy bag** sits visibly near the player. Every successfully shot target contributes a miniature candy item. A Frankenstein becomes Frankenstein-shaped candy, a witch becomes witch-shaped candy, and a spider becomes spider-shaped candy. Candy corn and suckers enter as miniature versions of themselves. A destroyed incoming jack-o'-lantern contributes pumpkin-shaped candy.

## 3. Adopt these starting settings

These resolve remaining implementation details. Treat them as tunable defaults, not reasons to pause for clarification. Centralize gameplay configuration so tuning does not require editing unrelated code.

### Weapon, targets, and scoring

- Unlimited pumpkin ammunition; no reload mechanic.
- Click/tap to fire; holding fire repeats approximately every **0.4 seconds**. Rate limiting must work across frame rates and input methods.
- Visible projectiles with responsive travel speed, one direct hit per target, and convincing splat effects. Explosions are cosmetic initially: **no splash damage**, since it would trivialize small spiders.
- Large targets: **10 points**. Medium: **25 points**. Small: **50 points**. Use the same size-to-score rule across target types, with most spiders assigned small.
- Frankensteins and witches are scoring targets, not attackers in this version. Candy targets award points and collection items, not health or power-ups.
- Each successful hit awards points and collection credit exactly once. A projectile hits the first valid collision along its path, then disappears. A shot must not register through blocking scenery or tunnel through a target at low frame rates.
- Make the crosshair, muzzle, and projectile trajectory agree well enough that accurate aiming feels fair. Do not secretly implement hitscan damage while showing unrelated projectile animation.

### Spider challenge

Use a readable behavior sequence: descend on a visible web, swing/bob, visibly prepare a throw, launch a jack-o'-lantern, then move again.

Spiders should be difficult because of their small bodies, movement, and timing—not invisible hitboxes, microscopic touch targets, or excessive health. One accurate shot defeats a spider. Body-centered hit areas should be forgiving enough for touch while still rewarding precision. The brief preparation phase creates a deliberate shooting opportunity.

Shooting a spider prevents future throws but does not remove a pumpkin it already launched. Shooting an incoming pumpkin prevents its damage. An incoming pumpkin that reaches the player removes one heart. Use a brief damage-immunity interval to prevent overlapping impacts from instantly consuming all three hearts.

Introduce one active spider at a time in the first level. Later levels increase pressure with capped spawn rates, speeds, and simultaneous attacks. Provide visible warnings and enough flight time to defend. Do not launch unavoidable attacks from hidden or offscreen spiders.

### Level sequence

Build all five environments:

1. **Haunted House:** crooked porch, glowing windows, fences, roof-descending spiders.
2. **Graveyard:** headstones, iron gates, low fog, bare trees.
3. **Spooky Forest:** twisted trees, glowing mushrooms, visible sky gaps.
4. **Pumpkin Patch:** oversized pumpkins, scarecrows, hay bales, crooked barn.
5. **Haunted Carnival:** striped tents, abandoned booths, overhead lights, distant Ferris wheel.

The first two locations were specifically chosen by the user; the last three are our adopted defaults. Each must be recognizably different in geometry and composition, not just palette changes. Reuse shared systems and assets where sensible.

After Level 5, cycle back through the environments at a gradually harder difficulty, with an eventual cap. Keep every level at 60 seconds and three starting hearts. Use a brief teleport swirl/fade and a ready countdown; gameplay timing starts only when the scene is ready and the countdown ends.

### Run state, replay, and collection

Maintain a clear state machine covering title/ready, countdown, playing, paused, level complete, teleport/loading, and game over. Only the playing state accepts combat, damage, spawns, and scoring. Define and test deterministic ordering at the timeout/final-heart boundary; zero hearts takes priority if both occur in the same simulation update.

At each level's start, save a snapshot of the committed score and candy inventory from earlier levels. During play, show current-level points and the combined running total. Completion commits the attempt once.

**Replay Level restores that level-start snapshot**, resets the timer and hearts, and replaces the previous attempt. It must not stack duplicate points or candy. Multiple replays must work correctly. Next Level retains the completed score/inventory and creates the next checkpoint.

Game over displays the points earned across the run, including the failed level's partial score, and offers a new run from Level 1. A new run clears the current collection and score, but not saved settings/personal bests.

Candy collection is credited at the successful hit, not at the end of an animation. Brief flight/bounce animations send recognizable miniature candy shapes into the bag. The 3D bag should remain visible near a lower side of the play view without obstructing aiming. It must look like a physical bag, not just a HUD icon or count.

Keep the underlying collection accurate but cap the number of visible candy meshes and active effects. Use representative piles or summarized contents when full. Do not create unbounded objects as levels repeat. The bag has no gameplay capacity limit and carries forward between levels.

Save settings and personal bests locally when browser storage is available. A best-run score is the highest valid total reached at a completed level or game over; replaying must never inflate it through duplicate accounting. Saving failure must never prevent play. No household-wide leaderboard is required.

## 4. Controls, presentation, and compatibility

### Desktop

Mouse aiming with a visible crosshair, click/hold to shoot, Escape to pause/release capture. Use pointer lock when supported and successfully requested through a user gesture, but provide drag-to-aim fallback. Losing pointer lock must not leave the game running unexpectedly or the fire input stuck.

### Touch

Landscape-first layout, drag-to-aim area, large separate fire button, and an accessible pause button. Support simultaneous aiming and firing with proper pointer tracking. Avoid browser scrolling/selection within the active game controls. Do not let firing-button gestures rotate the camera or menu taps fire a projectile.

Respect safe areas and small screens. Show a helpful rotation prompt in portrait without corrupting run state; do not require fullscreen or orientation-lock APIs to succeed. Fullscreen may be optional, never mandatory.

### Shared behavior

- Provide a polished title/start screen, brief controls, countdown, HUD, pause/resume, level results, game over, mute/volume, and aim sensitivity.
- HUD clearly shows time, hearts, current-level score, running total, and level/environment name.
- Tab hiding, focus loss, or interruption automatically pauses play. Returning shows a resume action rather than consuming hidden elapsed time. Clear held inputs on pause/cancel/blur.
- Start/resume audio from a user gesture; handle blocked or unavailable audio gracefully.
- Package all models, sounds, textures, and fonts locally. No runtime CDN, remote font, analytics, or asset-fetch requirement. Initial dependency installation may require internet, but installed LAN play should not.
- Prefer original procedural low-poly models and synthesized/local effects. Any third-party assets must permit this use, be stored locally, and have required license/attribution records. Do not hotlink or copy recognizable franchise assets.
- Create recognizable modeled enemies: Frankenstein features, witch hat/broom, eight-legged spider and web, carved/ridged pumpkin, striped candy corn, and suckers. Do not leave gameplay as placeholder cubes.
- Show an actionable error screen if required rendering support is absent. Handle resizing and storage/audio failures without a blank screen.
- Aim for smooth desktop play and practical mobile performance using bounded effects, capped pixel ratio, restrained shadows, and reused geometry/materials. These are targets, not benchmark claims until measured. Dispose environment resources and clear stale entities/listeners/timers during transitions and restart.

## 5. Implementation and documents

Keep logic testable and reasonably separated: state/rules, configuration, target spawning and behaviors, aiming/input, projectiles/collision, scoring/inventory, environments/rendering, audio, UI, and persistence. Use deterministic randomness where useful for tests. Do not build a large custom engine or full physics stack when lightweight game-specific systems suffice.

Create only useful, concise documentation:

- **README.md:** setup, prerequisites actually tested, all scripts, controls, desktop/touch notes, local hosting, offline operation, troubleshooting, and known limitations.
- **docs/GAME_DESIGN.md:** confirmed rules, adopted defaults, level sequence, scoring/replay semantics, state transitions, and a short architecture/configuration overview.
- **docs/IMPLEMENTATION_PLAN.md:** a small ordered checklist that is updated as work is actually completed.
- **docs/VERIFICATION.md:** commands executed and results, browser/device coverage actually tested, manual acceptance steps, remaining limitations, and incomplete work if any.
- Add an asset-license record only when applicable. Do not spend the task producing elaborate planning bureaucracy.

Implement in this order, without stopping between stages:

1. Create the concise plan/design and runnable foundation.
2. Complete the haunted-house vertical slice with **all core mechanics and both input modes**.
3. Add all remaining environments, teleporting, replay checkpoints, and capped repeating progression.
4. Polish models, candy collection, audio, responsive UI, performance, and edge cases.
5. Run verification, fix defects, update the docs, and deliver the playable project.

## 6. Local-network delivery

For a new npm project, provide scripts for `dev`, `dev:lan`, `build`, `serve:lan`, `typecheck`, `test`, and browser tests if implemented. Adapt to an existing package manager without introducing a second lockfile.

`dev:lan` must listen on the LAN interface. `serve:lan` must serve the built static game using a small suitable static server, with a documented/configurable port and normal correct asset paths. Do not add a gameplay backend. Provide exact build-and-serve commands and a URL pattern such as `http://<host-lan-ip>:<port>`.

Explain how to find the hosting computer's LAN address and that other devices need a reachable local network, the chosen port allowed through the host's private-network firewall, and the host running. Mention guest-Wi-Fi isolation where relevant. Do not open ports or weaken host protections automatically. Keep development-server host checks appropriately restricted.

The deployed build must work over ordinary **local HTTP**, not silently depend on HTTPS-only APIs. Feature-detect optional browser capabilities and test fallbacks. Document that local saved scores belong to a browser and origin, so changing address/port can change which save is visible.

## 7. Verification and acceptance

Use the repository's existing testing approach or a lightweight unit runner plus browser automation. Do not overengineer a new test platform.

Unit/integration coverage must include size-based points; one score/candy award per hit; projectile collision and damage; firing cooldown; countdown/60-second timing; pause/resume; heart loss and immunity; final-heart/timeout ordering; replay snapshot restoration; Next Level progression; new-run reset; capped difficulty; bounded collections/effects; and unavailable or malformed browser storage.

Run browser smoke tests where supported: start a real rendered level, shoot, exercise pause/resume and results/replay, resize, load a touch-oriented viewport, and check console/runtime/asset failures. Use two separate browser contexts to confirm independent sessions. Browser automation may use test-only deterministic fixtures to reach results or game over quickly; do not expose a player-facing test/cheat mode or alter production rules.

Inspect actual rendered screenshots at desktop and mobile dimensions where tooling permits. Verify visual content, not merely that a canvas element exists. Mobile viewport emulation is **not** proof of real phone compatibility. State exactly which real devices, browser engines, headless/software-rendered environments, and network paths were or were not exercised.

Also verify the built static server starts and serves the entry point and assets. Test offline/runtime network behavior where feasible. Do not claim another household device connected unless that was actually tested.

### Completion checklist

- The game is titled Halloween Rush and renders a populated, recognizable 3D Halloween world.
- All six target/projectile categories work: Frankensteins, witches, spiders, incoming jack-o'-lanterns, candy corn, and suckers.
- Pumpkin shots, size-based points, spider attacks, three hearts, and 60-second levels work together.
- A physical 3D bag receives the correct miniature candy shapes.
- Next Level, Replay Level, game over, pause, and restart have correct state and score/inventory semantics.
- All five distinct environments and the harder repeating sequence are implemented.
- Desktop and touch input paths are implemented, with their actual test coverage reported.
- Local-network hosting is configured; sessions are independent and runtime assets are local.
- Type checking, tests, and production build have been executed, with failures fixed or explicitly disclosed.
- Documentation reflects the delivered implementation, not merely the intended design.

## 8. Final handoff

Finish with a concise summary of what was built, key files, exact install/build/run/LAN commands, controls, verification actually performed, and specific remaining limitations. Separate automated checks from manual observations and untested claims.

**Begin by inspecting the workspace. Then create the plan documents and build Halloween Rush end to end.**
