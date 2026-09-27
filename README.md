# Halloween Rush

A first-person 3D Halloween shooting gallery for the browser. You stand in one spot with a
pumpkin rocket launcher, splat silly monsters and candy targets for 60 seconds per level,
survive the spiders' jack-o'-lanterns, and teleport through five spooky places. Every hit
drops a miniature candy into the physical trick-or-treat bag beside you.

Built with TypeScript (strict), Three.js and Vite. All models, textures and sounds are
generated in code; the only image files are the icons and the link-preview card, rendered from
code by `scripts/make-icons.mjs`. The public site is https://halloweenrush.app/. Gameplay runs entirely in each
browser. The only thing sent over the network after loading is each finished level, which goes
to a small **household scores database** (SQLite) on the computer hosting the game. That feeds
the shared scoreboard, the career leaderboard and the level bests.

## Prerequisites

Tested with **Node.js 26.10.0 and npm 12.1.0** on Arch Linux. `package.json` asks for Node ≥ 22.13,
the first release with the built-in `node:sqlite` module unflagged (older 22.x releases print an
"experimental" warning, which is harmless). Only 26.10 was exercised. Players need a current browser with WebGL.

```bash
npm install
```

Browser tests also need Playwright's Chromium once: `npx playwright install chromium`.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server on this computer only: http://localhost:5173 (scores go to `data/dev-scores.sqlite`) |
| `npm run dev:lan` | Dev server on the LAN interface (`--host 0.0.0.0`), port 5173 (same dev scores file) |
| `npm run build` | Type-check, then production build into `dist/` |
| `npm run serve:lan` | Serve `dist/` and the scores database to the local network (default port 4173, scores in `data/halloween-rush.sqlite`) |
| `npm run preview` | Vite's own preview of `dist/` (this computer only, dev scores file) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit/simulation tests (Vitest) |
| `npm run test:e2e` | Browser smoke tests (Playwright + Chromium, builds `dist-e2e/` itself) |
| `npm run verify:serve` | Starts `serve:lan` against `dist/` and checks the page and assets over loopback and the LAN address |

## Controls

**Computer:** click **Start the Rush**, then move the mouse to aim (the pointer is captured).
Click or hold the left button to fire, or press **Space** / **F**. Holding fire repeats every
0.4 s. **Esc** releases the mouse and pauses; **P** also pauses. If the browser refuses pointer
capture, drag to aim instead and click (or press Space) to fire.

**Touch (phone/tablet):** play in landscape. Drag anywhere on the scene to aim and hold the
round **FIRE** button to shoot. You can aim and fire with two fingers at once. The ⏸ button
pauses. In portrait the game pauses and asks you to rotate. Fullscreen is never required.

**Settings** (title or pause screen): volume, mute, aim sensitivity, and this device's name and ID.
Settings and personal bests are saved in the browser.

## Names and leaderboards

- **Level best:** finish a level with more points than anyone has ever scored on that level
  number and the results screen asks for your name before Replay/Next come back.
- **Scoreboard:** when a run ends, the game-over screen always shows the top 10 runs. If yours
  made it, type your name (the last name used on that device is filled in; Enter or **Save**).
  A name typed at a level best counts for the whole run, so you're only asked once per run.
  Leave it blank and the run is listed as a guest of that device, e.g. "Guest (iPhone · Safari)".
- **Allowed names** (this is a game for kids): one name from the built-in list, optionally
  followed by a number so two Brads can be "Brad" and "Brad2". The list holds about 10,000
  first names (US Social Security baby-name data, minus any that read as rude words, slang or
  slurs), family names like Mom, Grandpa or Abuela, and spooky ones like Pumpkin. Numbers that
  are rude themselves (69, 420, 666, 88…) or that finish spelling a rude word as look-alike
  letters ("Ana1", "Bo08", "Josh17") are refused too, and the player is asked to try another.
  Nothing else gets through, however it's spelled. To allow a name that isn't listed, add it to
  `src/core/nameList.mjs`. Names saved before this check that aren't allowed show as "Player"
  on the device and as a guest on the host's boards.
- **Career:** most points over every game per player, with games played, best run, furthest
  level and the **average points per level on each map**.
- **Level bests:** the record for finishing each level number, and who holds it.
- The title screen's **Leaderboards** button shows all three. With the host reachable they cover
  everyone on the network; otherwise the scoreboard falls back to this device's own runs.

Scoring matches the game exactly: a replayed level replaces the earlier attempt in the run
total and career points (no farming by replaying), though a replayed attempt can still set a
level best and counts toward map averages.

## Play full screen on a phone (Home Screen)

iPhone browsers (Safari, and Chrome/Firefox, which use Safari's engine there) don't let web
pages go fullscreen. The closest thing is adding the game to the Home Screen:

- **iPhone/iPad:** open the game's LAN address in Safari → Share → **Add to Home Screen**, then
  start it from the new pumpkin icon. It opens without Safari's address bar and toolbars.
- **Android (Chrome):** menu ⋮ → **Add to Home screen** (or **Install app**). It opens fullscreen in landscape.
- Without adding it: turn the phone sideways, and in Safari use the page menu (**aA**) → **Hide Toolbar**.

A Home Screen copy keeps its own saved data, separate from the browser's. Its settings and
personal best start fresh, and it counts as a separate device ("iPhone · Home Screen"). The
shared leaderboards are unaffected because they live on the host. If you edit
`public/icon.svg`, regenerate the PNG icons, `favicon.ico` and the `og-image.png` link-preview
card with `node scripts/make-icons.mjs`.

## Play on the local network

One computer hosts the files and the scores database. Everyone else opens its address and plays
their own separate game. Gameplay is never shared and there is no gameplay server; each device
only reports finished levels and names.

```bash
npm run build
npm run serve:lan
```

The server prints the addresses to use, for example:

```
  This computer:  http://localhost:4173/
  Local network:  http://192.168.1.23:4173/
```

On other devices, open `http://<host-lan-ip>:4173/`.

- **Change the port:** `npm run serve:lan -- --port 8080`, or `PORT=8080 npm run serve:lan`.
  `--host` / `HOST` picks the interface (default `0.0.0.0`).
- **Find the host's LAN address** if it isn't printed: Linux `ip -4 addr` (or `hostname -I`),
  macOS `ipconfig getifaddr en0`, Windows `ipconfig` (IPv4 Address).
- **Requirements:** the other devices must be on the same network as the host. The chosen port
  must be allowed through the host's firewall for private networks. The host must keep
  `serve:lan` running. Guest Wi-Fi networks often isolate devices from each other ("client/AP
  isolation"), so use the main network. Nothing here opens ports or changes firewall/router
  settings for you.
- **Plain HTTP is fine.** The game uses nothing that needs HTTPS. Pointer lock, Web Audio and
  local storage all work on a LAN `http://` address, and the game falls back gracefully when a
  browser withholds any of them.
- **Offline:** once `npm install` is done, building, serving and playing need no internet. All
  code, models, sounds and fonts are local; the UI uses system fonts.
- `dev:lan` is for development. Vite only answers requests addressed to `localhost` or an IP
  address, so keep using IP URLs rather than custom hostnames.

## Saved data

**On the host:** `npm run serve:lan` keeps the household scores in `data/halloween-rush.sqlite`
(change it with `--db path` or `HR_DB=path`). Back that file up to keep the leaderboards. Stop the
server and delete it (plus any `-wal`/`-shm` files next to it) to start the boards over.
Development servers use `data/dev-scores.sqlite` so testing never lands on the family's board.
Tables: `devices`, `runs` and `attempts` (one row per finished level). For example:
`sqlite3 data/halloween-rush.sqlite "select label, name, datetime(last_seen/1000,'unixepoch') from devices"`.

**Device IDs:** each browser gets a random ID the first time it loads the game, kept in its
`localStorage`. The server also stores a **fingerprint** for it: a hash of the browser, screen,
GPU, language and time zone, plus a label such as "iPhone · Safari". The random ID is what identifies
a device. A fingerprint alone can't tell two identical phones apart, but it helps you spot the same
hardware twice, for example an iPhone's Safari and its Home Screen copy. Settings shows the
device's label and the start of its ID.

**In each browser** (`localStorage`): settings, personal bests (best run on this device, furthest
level), the device ID, the last name typed, this device's own top 10 (the fallback scoreboard),
and an outbox of levels not yet confirmed by the host. If the Wi-Fi drops or the host is off, results
wait there and are sent later. Saves belong to one browser **and one address**:
`http://localhost:4173` and `http://192.168.1.23:4173` are different origins with separate saves
(and separate device IDs), and changing the port changes the origin too. Private browsing, blocked
storage or a full quota never stops the game; it just won't remember anything.

## Search engines, AI assistants and link previews

- **Pages:** `/` is the game; `/about/` (`about/index.html`) is a plain-HTML guide with controls,
  points, levels and an FAQ. It needs no JavaScript, so every search engine and AI assistant can
  read it. Its FAQ structured data must match the visible FAQ word for word.
- **Metadata:** both pages carry a title, description, canonical URL, Open Graph/Twitter tags and
  schema.org JSON-LD (`VideoGame`, `WebSite`, `FAQPage`).
- **Crawler files** in `public/`: `robots.txt` (everyone welcome, AI crawlers named explicitly),
  `sitemap.xml`, `llms.txt` (a Markdown summary for AI tools) and `404.html`. Cloudflare serves
  unknown URLs with that page and a real 404 status (`not_found_handling` in `wrangler.jsonc`).
- **No WebGL:** search engines render pages without 3D graphics. The game then keeps its title
  card on screen with the error inside it, so the indexed page still describes the game.
- **Domain:** `https://halloweenrush.app` is written into both pages and the crawler files.
  `tests/seo.test.ts` fails if any of them disagree. Update `<lastmod>` in `sitemap.xml` when a
  page's content changes.

## Troubleshooting

- **"Halloween Rush needs 3D graphics (WebGL)"**: turn on hardware/graphics acceleration in the
  browser settings, update the browser, or try another one.
- **Other devices can't connect:** check they are on the same (non-guest) network, that you used
  the host's LAN IP rather than `localhost`, and that the host firewall allows the port for private
  networks. Try opening the URL on the host itself first.
- **`Port 4173 is already in use`:** pick another port with `-- --port 4174`.
- **No sound:** sound starts on the first tap/click; check the in-game mute/volume and the
  device's silent switch.
- **Leaderboards say they need the game host / only show this device:** the page was served
  without the scores API (e.g. copied to another static server) or the host is unreachable. Serve
  it with `npm run serve:lan`; queued results are sent once the host answers.
- **Mouse stuck / not captured:** press Esc, then Resume. If capture keeps failing, the game
  switches to drag-to-aim automatically.

## Project layout

```
src/config.ts          all gameplay tuning (timings, points, sizes, difficulty, caps)
src/core/              pure rules: run state machine, scoring/checkpoints, scoreboard, fire rate, collision, difficulty, saves
src/sim/               targets, spawning, projectiles and hits (runs headless in tests)
src/render/            renderer/stage, procedural models, five environments, launcher + candy bag, effects
src/input/ audio/ ui/  input (pointer lock, drag, touch), synthesized Web Audio, DOM screens/HUD/leaderboards
src/net/               device ID + fingerprint, score outbox/sync with the host
scripts/scores-api.mjs household scores database (node:sqlite) + JSON API, used by serve-lan and Vite
public/                icons, link-preview image, web app manifest, robots.txt, sitemap.xml, llms.txt, 404 page
about/index.html       the plain-HTML About / how-to-play / FAQ page
src/game.ts            ties it together for one player's session
tests/  e2e/  scripts/ unit tests, Playwright smoke tests, LAN server + verifier, icon renderer
docs/                  GAME_DESIGN.md, IMPLEMENTATION_PLAN.md, VERIFICATION.md
```

## Known limitations

- Only Chromium (headless, software-rendered) was exercised automatically. No real phone, tablet,
  Safari or Firefox has been tested, and no second household device has connected over the LAN.
  See [docs/VERIFICATION.md](docs/VERIFICATION.md).
- Performance on real devices has not been measured; the target is smooth desktop play and
  practical mobile play with capped pixel ratio, no real-time shadows and bounded effects.
- No fullscreen button. iPhones can't fullscreen web pages at all; use the Home Screen (above).
  Android's Home Screen version opens fullscreen. Neither was tried on a real phone.
- The scores API has no passwords: anyone on the home network can post scores or names to it
  (the host still refuses names that aren't allowed).
  That's fine for a household, but don't expose the port to the internet.
- Levels are sent as they finish, so a run still in progress (or one quit from the pause menu)
  shows on the host's boards with its finished levels. A quit run is never asked for a name; it
  appears under the last name used on that device, or as a guest.
- There are no third-party assets, so no asset-license record is needed.
