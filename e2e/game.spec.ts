import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { CONFIG } from '../src/config';
import type { RangeZone } from '../src/types';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    __HR__: any;
  }
}

const SHOTS = 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

type State = {
  phase: string;
  levelIndex: number;
  env: string;
  hearts: number;
  time: number;
  levelScore: number;
  totalScore: number;
  inventory: Record<string, number>;
  bests: { bestRunScore: number; furthestLevel: number };
  targets: Array<{ id: number; kind: string; alive: boolean }>;
  projectiles: number;
  shots: number;
  locked: boolean;
  mode: string;
  bagVisible: number;
  flights: number;
  yaw: number;
  pitch: number;
  runId: string;
  deviceId: string;
  outbox: number;
};

type Boards = {
  runs: Array<{ runId: string; name: string; score: number; level: number; shots: number; hits: number }>;
  levels: Array<{ level: number; map: string; name: string; score: number }>;
  maps: Array<{ map: string; name: string; score: number; level: number; shots: number; hits: number }>;
  career: Array<{ name: string; points: number; games: number; best: number; furthest: number; maps: Array<{ map: string; avg: number; plays: number }> }>;
};

// Every test starts with an empty household scores database (the e2e server keeps it in memory).
test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/test-reset')).status()).toBe(204);
});

/** The host's leaderboards once this page has delivered everything it recorded. */
async function hostBoards(page: Page): Promise<Boards> {
  await expect.poll(async () => (await state(page)).outbox, { timeout: 30_000 }).toBe(0);
  return (await page.request.get('/api/scores')).json();
}

const state = (page: Page): Promise<State> => page.evaluate(() => window.__HR__.state());

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));
  return errors;
}

async function open(page: Page, seed = 11): Promise<string[]> {
  const errors = watchErrors(page);
  await page.goto(`/?seed=${seed}`);
  await expect(page.locator('#screen-title')).toBeVisible();
  await page.waitForFunction(() => !!window.__HR__);
  return errors;
}

async function waitPhase(page: Page, phase: string, timeout = 20_000): Promise<void> {
  await page.waitForFunction((p) => window.__HR__.state().phase === p, phase, { timeout });
}

/** Skip the ready countdown using the deterministic fixture. */
async function skipCountdown(page: Page): Promise<void> {
  await waitPhase(page, 'countdown');
  await page.evaluate(() => window.__HR__.advance(3.05));
  await waitPhase(page, 'playing');
}

async function start(page: Page, tap = false): Promise<void> {
  if (tap) await page.tap('#btn-start');
  else await page.click('#btn-start');
  await skipCountdown(page);
}

type Hit = { kind: string; size: string; zone: RangeZone; points: number };

/**
 * Spawn a floating sucker with spawning otherwise off, aim at it, and fire with Space.
 * Returns the points scored: medium-size base plus the range bonus for how far away the
 * seeded candy spot put the hit, checked against the rules in CONFIG.
 */
async function shootSucker(page: Page): Promise<number> {
  const before = (await state(page)).levelScore;
  await page.evaluate(() => {
    window.__HR__.setSpawning(false);
    window.__HR__.clearTargets();
  });
  const id = await page.evaluate(() => window.__HR__.spawn('sucker', true));
  await page.evaluate(() => window.__HR__.advance(1.2));
  await page.evaluate((i) => window.__HR__.aimAt(i), id);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await state(page)).levelScore, { timeout: 15_000 }).toBeGreaterThan(before);
  const hit: Hit = await page.evaluate(() => window.__HR__.lastHit());
  expect(hit).toMatchObject({ kind: 'sucker', size: 'medium' });
  const points = CONFIG.points.medium + CONFIG.range.bonus[hit.zone];
  expect(hit.points).toBe(points);
  expect((await state(page)).levelScore).toBe(before + points);
  return points;
}

/**
 * pause() releases pointer lock, but the release is asynchronous; until it lands every
 * mouse event goes to the locked canvas, so a click on Resume would be swallowed.
 */
async function resumeFromPause(page: Page): Promise<void> {
  await expect.poll(async () => (await state(page)).locked).toBe(false);
  await page.click('#btn-resume');
  await waitPhase(page, 'playing');
}

async function finishLevel(page: Page): Promise<void> {
  await page.evaluate(() => window.__HR__.nearEnd());
  await waitPhase(page, 'levelComplete');
  await expect(page.locator('#screen-results')).toBeVisible();
}

test('title renders Halloween Rush over a populated 3D scene', async ({ page }) => {
  const errors = await open(page);
  await expect(page).toHaveTitle(/^Halloween Rush/);
  await expect(page.locator('h1')).toHaveText(/Halloween\s+Rush/);
  await expect(page.locator('body')).not.toContainText('Pumpkin Panic');
  const stats = await page.evaluate(() => window.__HR__.pixelStats());
  expect(stats.distinctColors).toBeGreaterThan(60);
  expect(stats.stdLuma).toBeGreaterThan(12);
  await page.screenshot({ path: `${SHOTS}/desktop-title.png` });
  expect(errors).toEqual([]);
});

test('level flow: shoot, candy into the bag, results, replay snapshot, next level', async ({ page }) => {
  const errors = await open(page);
  await start(page);
  let s = await state(page);
  expect(s.env).toBe('Haunted House');
  expect(s.hearts).toBe(3);
  expect(s.time).toBeGreaterThan(59);
  await page.screenshot({ path: `${SHOTS}/desktop-play.png` });

  // A real mouse press launches a pumpkin (pointer-locked click or drag-fallback click).
  await page.evaluate(() => {
    window.__HR__.setSpawning(false);
    window.__HR__.clearTargets();
  });
  await page.mouse.move(640, 360);
  await page.mouse.move(641, 360);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).shots).toBe(1);

  // Level 1: hit a sucker → 25 points plus its range bonus, and a sucker candy flies into the bag.
  await page.waitForTimeout(500); // fire cooldown
  const level1 = await shootSucker(page);
  s = await state(page);
  expect(s.inventory.sucker).toBe(1);
  await expect.poll(async () => (await state(page)).bagVisible, { timeout: 10_000 }).toBe(1);
  await expect(page.locator('#hud-total')).toHaveText(String(level1));
  await finishLevel(page);
  await expect(page.locator('#results-level')).toHaveText(String(level1));
  await expect(page.locator('#results-accuracy')).toHaveText('50% (1/2)'); // the first click missed
  await expect(page.locator('#results-total')).toHaveText(String(level1));
  // Nobody has finished level 1 yet, so this is a level best: a name is asked for before
  // Replay/Next come back.
  await expect(page.locator('#results-entry')).toBeVisible();
  await expect(page.locator('#results-actions')).toBeHidden();
  await expect(page.locator('#results-name')).toBeFocused();
  await page.screenshot({ path: `${SHOTS}/desktop-results.png` });
  await page.keyboard.type('Hudson');
  await page.keyboard.press('Enter');
  await expect(page.locator('#results-levelbest')).toHaveText('Best score ever on Level 1, Hudson!');
  await expect(page.locator('#btn-next')).toBeFocused();

  // Level 2 (Graveyard): score again, then replay twice → snapshot from the level start each time.
  await page.click('#btn-next');
  await skipCountdown(page);
  s = await state(page);
  expect(s.env).toBe('Graveyard');
  expect(s.levelIndex).toBe(1);
  expect(s.hearts).toBe(3);
  expect(s.totalScore).toBe(level1);
  const level2 = await shootSucker(page);
  expect((await state(page)).totalScore).toBe(level1 + level2);
  await finishLevel(page);
  await expect(page.locator('#results-total')).toHaveText(String(level1 + level2));
  // Another level best, but this run already has a name: no second question.
  await expect(page.locator('#results-levelbest')).toHaveText('Best score ever on Level 2, Hudson!');
  await expect(page.locator('#results-entry')).toBeHidden();

  for (let i = 0; i < 2; i++) {
    await page.click('#btn-replay');
    await skipCountdown(page);
    s = await state(page);
    expect(s.levelIndex).toBe(1);
    expect(s.env).toBe('Graveyard');
    expect(s.totalScore).toBe(level1);
    expect(s.inventory.sucker).toBe(1);
    expect(s.hearts).toBe(3);
    expect(s.time).toBeGreaterThan(59);
    await finishLevel(page);
    await expect(page.locator('#results-total')).toHaveText(String(level1));
    await expect(page.locator('#results-levelbest')).toBeHidden();
  }
  expect((await state(page)).bests.bestRunScore).toBe(level1 + level2);
  // The host recorded it the way the game counts it: the last replay of level 2 (0) replaced
  // the first attempt's score, while both level bests stand.
  const boards = await hostBoards(page);
  expect(boards.levels.map((l) => [l.level, l.map, l.name, l.score])).toEqual([
    [1, 'Haunted House', 'Hudson', level1],
    [2, 'Graveyard', 'Hudson', level2],
  ]);
  // Accuracy counts every shot of the run, replays included.
  expect(boards.runs).toEqual([{ runId: (await state(page)).runId, name: 'Hudson', score: level1, level: 2, shots: 3, hits: 2 }]);
  expect(boards.maps.map((m) => [m.map, m.score, m.shots, m.hits])).toEqual([
    ['Graveyard', level2, 1, 1],
    ['Haunted House', level1, 2, 1],
  ]);
  expect(errors).toEqual([]);
});

test('pause, blur, hidden tab and pointer-lock loss all pause without consuming time', async ({ page }) => {
  const errors = await open(page);
  await start(page);
  await page.evaluate(() => window.__HR__.advance(2));

  // P key pauses; waiting in real time does not consume level time.
  await page.keyboard.press('KeyP');
  await waitPhase(page, 'paused');
  await expect(page.locator('#screen-pause')).toBeVisible();
  const t0 = (await state(page)).time;
  await page.waitForTimeout(1500);
  expect((await state(page)).time).toBeCloseTo(t0, 5);
  await page.screenshot({ path: `${SHOTS}/desktop-pause.png` });
  await resumeFromPause(page);

  // Window blur while holding fire: pauses and clears the held input.
  await page.keyboard.down('Space');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await waitPhase(page, 'paused');
  await resumeFromPause(page);
  const p0 = (await state(page)).shots;
  await page.waitForTimeout(1200);
  const p1 = (await state(page)).shots;
  await page.keyboard.up('Space');
  expect(p1).toBe(p0); // no phantom auto-fire after resuming

  // Hidden tab pauses.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await waitPhase(page, 'paused');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  });
  await resumeFromPause(page);

  // Losing pointer lock (Esc in a real browser) pauses the game.
  const locked = (await state(page)).locked;
  test.info().annotations.push({ type: 'pointer-lock', description: locked ? 'granted in this browser' : 'not granted; fallback used' });
  if (locked) {
    await page.evaluate(() => document.exitPointerLock());
    await waitPhase(page, 'paused');
  }
  expect(errors).toEqual([]);
});

test('holding Space through the end of a level does not press the focused results button', async ({ page }) => {
  const errors = await open(page);
  await start(page);
  await page.keyboard.down('Space');
  await finishLevel(page);
  await expect(page.locator('#btn-next')).toBeFocused();
  await page.keyboard.down('Space'); // key auto-repeat now lands on the focused button
  await page.keyboard.up('Space');
  await page.waitForTimeout(500);
  expect((await state(page)).phase).toBe('levelComplete');
  await expect(page.locator('#screen-results')).toBeVisible();
  // A fresh Space press on the focused button still works for keyboard players.
  await page.keyboard.press('Space');
  await expect.poll(async () => (await state(page)).levelIndex).toBe(1);
  expect(errors).toEqual([]);
});

test('clicks as a level or run ends do not skip the results or game over screen', async ({ page }) => {
  const errors = await open(page);
  await start(page);
  // Scoring nothing means no name to ask for, so Next Level shows straight away.
  await finishLevel(page);
  const click = async (selector: string) => {
    const box = (await page.locator(selector).boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };
  // Still clicking to fire when the timer hit 0: the clicks land on Next Level but are ignored.
  await click('#btn-next');
  await page.waitForTimeout(300);
  await click('#btn-next');
  await page.waitForTimeout(200);
  expect((await state(page)).phase).toBe('levelComplete');
  // Once the screen has been up for a moment, Next Level works as usual.
  await page.waitForTimeout(1000);
  await click('#btn-next');
  await expect.poll(async () => (await state(page)).levelIndex).toBe(1);

  await skipCountdown(page);
  for (let i = 0; i < 3; i++) await page.evaluate(() => window.__HR__.hurt());
  await waitPhase(page, 'gameOver');
  await click('#btn-newrun');
  await page.waitForTimeout(200);
  expect((await state(page)).phase).toBe('gameOver');
  await page.waitForTimeout(1200);
  await click('#btn-newrun');
  await waitPhase(page, 'countdown');
  expect(errors).toEqual([]);
});

test('game over: name onto the scoreboard, career and level boards, new run resets, all saved', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.__HR__);
  await start(page);
  const scored = await shootSucker(page);
  await page.keyboard.down('Space'); // still holding fire when the run ends
  for (let i = 0; i < 3; i++) await page.evaluate(() => window.__HR__.hurt());
  await waitPhase(page, 'gameOver');
  await expect(page.locator('#screen-gameover')).toBeVisible();
  await expect(page.locator('#gameover-total')).toHaveText(String(scored));
  await expect(page.locator('#gameover-newbest')).toBeVisible();
  // First on the empty scoreboard: the name box replaces Title/New Run until a name is saved.
  await expect(page.locator('#gameover-entry')).toBeVisible();
  await expect(page.locator('#gameover-why')).toHaveText('#1 on the scoreboard');
  await expect(page.locator('#gameover-accuracy')).toContainText('(1/'); // held fire may add misses
  await expect(page.locator('#btn-newrun')).toBeHidden();
  await expect(page.locator('#gameover-name')).toBeFocused();
  await page.keyboard.down('Space'); // the held key auto-repeats...
  await page.keyboard.up('Space');
  await expect(page.locator('#gameover-name')).toHaveValue(''); // ...but types nothing
  // A name that can't go on the scoreboard is refused, saying why, and the box stays up.
  const runs = page.locator('#gameover-boards ol[aria-label="Scoreboard"]');
  await page.keyboard.type('Poop');
  await expect(runs.locator('li.you')).toContainText('Player'); // the row never shows it
  await page.keyboard.press('Enter');
  await expect(page.locator('#gameover-name-error')).toContainText("That name isn't allowed.");
  await expect(page.locator('#gameover-name')).toBeFocused();
  await expect(page.locator('#btn-newrun')).toBeHidden();
  await page.keyboard.type('Hudson69'); // replaces the selected text
  await page.keyboard.press('Enter');
  await expect(page.locator('#gameover-name-error')).toContainText("That number isn't allowed");
  await page.keyboard.type('Hudson');
  await expect(page.locator('#gameover-name-error')).toBeHidden();
  await expect(runs.locator('li.you')).toContainText('Hudson'); // the row follows the typing
  await page.screenshot({ path: `${SHOTS}/desktop-gameover-entry.png` });
  await page.keyboard.press('Enter');
  await expect(page.locator('#gameover-entry')).toBeHidden();
  await expect(page.locator('#gameover-rankbadge')).toHaveText('#1 on the scoreboard!');
  await expect(page.locator('#btn-newrun')).toBeFocused();
  await expect(runs.locator('li')).toHaveCount(1);
  await expect(runs.locator('li.you')).toContainText('Hudson');
  await expect(runs.locator('li.you')).toContainText(String(scored));
  await expect(page.locator('#gameover-boards .boards-note')).toContainText('everyone who plays here');
  await page.screenshot({ path: `${SHOTS}/desktop-gameover.png` });
  // Career (from the host): points over every game and the average per map.
  await page.click('#gameover-boards [role="tab"]:has-text("Career")');
  const career = page.locator('#gameover-boards ol[aria-label="Career"]');
  await expect(career).toContainText('Hudson');
  await expect(career).toContainText(`1 game · best ${scored} · Lv 1`);
  await expect(career).toContainText(`Avg/map: House ${scored}`);
  await page.click('#gameover-boards [role="tab"]:has-text("Maps")');
  await expect(page.locator('#gameover-boards [aria-label="Maps"]')).toContainText('No levels finished yet.');
  await page.click('#gameover-boards [role="tab"]:has-text("Level bests")');
  await expect(page.locator('#gameover-boards ol[aria-label="Level bests"]')).toContainText('No levels finished yet.');

  await page.click('#btn-newrun');
  await skipCountdown(page);
  const s = await state(page);
  expect(s.levelIndex).toBe(0);
  expect(s.totalScore).toBe(0);
  expect(Object.values(s.inventory).reduce((a, b) => a + b, 0)).toBe(0);
  expect(s.hearts).toBe(3);
  expect(s.bests.bestRunScore).toBe(scored);
  // A run that scores nothing doesn't ask for a name, but the scoreboard still shows.
  for (let i = 0; i < 3; i++) await page.evaluate(() => window.__HR__.hurt());
  await waitPhase(page, 'gameOver');
  await expect(page.locator('#gameover-entry')).toBeHidden();
  await expect(page.locator('#gameover-rankbadge')).toBeHidden();
  await expect(page.locator('#btn-newrun')).toBeFocused();
  await expect(runs).toContainText('Hudson');

  // After a reload: the best run, and the household boards from the title screen.
  await page.reload();
  await expect(page.locator('#title-bests')).toContainText(`Best run: ${scored}`);
  await page.click('#btn-boards');
  await expect(page.locator('#screen-boards')).toBeVisible();
  await expect(page.locator('#title-boards ol[aria-label="Scoreboard"] li').first()).toContainText('Hudson');
  await page.click('#title-boards [role="tab"]:has-text("Career")');
  await expect(page.locator('#title-boards ol[aria-label="Career"]')).toContainText(`2 games · best ${scored}`);
  await page.screenshot({ path: `${SHOTS}/desktop-leaderboards.png` });
  await page.click('#btn-boards-done');
  await expect(page.locator('#screen-title')).toBeVisible();
  expect(errors).toEqual([]);
});

test('storage that throws never blocks play', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
  });
  const errors = await open(page);
  await start(page);
  await shootSucker(page);
  await finishLevel(page);
  expect(errors).toEqual([]);
});

test('desktop drag fallback when pointer lock is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    // Simulate a browser without pointer lock support.
    (Element.prototype as any).requestPointerLock = undefined;
  });
  const errors = await open(page);
  await start(page);
  await expect(page.locator('#hud-hint')).toContainText('Drag to aim');
  const y0 = (await state(page)).yaw;
  await page.mouse.move(600, 360);
  await page.mouse.down();
  await page.mouse.move(700, 380, { steps: 5 });
  await page.mouse.up();
  const s1 = await state(page);
  expect(s1.yaw).toBeLessThan(y0 - 0.1); // dragged right → turned right
  expect(s1.shots).toBe(0); // a drag is not a shot
  await page.mouse.click(700, 380);
  await expect.poll(async () => (await state(page)).shots).toBe(1);
  await page.keyboard.press('Escape');
  await waitPhase(page, 'paused');
  expect(errors).toEqual([]);
});

test('Xbox controller: menus, right-stick aim (not inverted), trigger fire, Menu pauses; full screen', async ({ page }) => {
  // A fake standard-mapping controller that the test drives through window.__pad.
  await page.addInitScript(() => {
    const pad = {
      id: 'Xbox Wireless Controller (STANDARD GAMEPAD)',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    (window as any).__pad = pad;
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad, null, null, null] });
  });
  const setButton = (b: number, down: boolean) =>
    page.evaluate(([i, d]) => {
      const btn = (window as any).__pad.buttons[i as number];
      btn.pressed = d;
      btn.value = d ? 1 : 0;
    }, [b, down] as const);
  const setAxes = (axes: number[]) => page.evaluate((a) => ((window as any).__pad.axes = a), axes);
  /** Wait for `n` animation frames: the game reads the controller once per frame (slow in SwiftShader). */
  const frames = (n: number) =>
    page.evaluate(
      (k) =>
        new Promise<void>((done) => {
          let i = 0;
          const f = () => (++i >= k ? done() : requestAnimationFrame(f));
          requestAnimationFrame(f);
        }),
      n,
    );
  const press = async (b: number) => {
    await setButton(b, true);
    await frames(3);
    await setButton(b, false);
    await frames(3);
  };
  const A = 0;
  const RT = 7;
  const MENU = 9;
  const UP = 12;
  const DOWN = 13;

  const errors = await open(page);
  // Full screen from the title (a real click, as with the cursor in Edge on Xbox).
  await expect(page.locator('#btn-fullscreen-title')).toBeVisible();
  await page.click('#btn-fullscreen-title');
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  await expect(page.locator('#btn-fullscreen-title')).toHaveText('Exit full screen');
  await page.click('#btn-fullscreen-title');
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);

  // A presses the focused Start button; the controller never asks for the mouse.
  await page.locator('#btn-start').focus();
  await press(A);
  await skipCountdown(page);
  let s = await state(page);
  expect(s.mode).toBe('gamepad');
  expect(s.locked).toBe(false);
  await expect(page.locator('body')).toHaveClass(/\bpad\b/);
  await expect(page.locator('#hud-hint')).toBeHidden();
  await page.evaluate(() => {
    window.__HR__.setSpawning(false);
    window.__HR__.clearTargets();
  });

  // Right stick right turns right (yaw falls, as with the mouse); up looks up.
  const y0 = s.yaw;
  await setAxes([0, 0, 1, 0]);
  await frames(10);
  await setAxes([0, 0, 0, -1]);
  await frames(10);
  await setAxes([0, 0, 0, 0]);
  await frames(2);
  s = await state(page);
  expect(s.yaw).toBeLessThan(y0 - 0.1);
  expect(s.pitch).toBeGreaterThan(0.1);

  // RT fires; holding it repeats.
  await setButton(RT, true);
  await expect.poll(async () => (await state(page)).shots).toBeGreaterThanOrEqual(2);
  await setButton(RT, false);

  // Menu pauses; the D-pad moves between the pause buttons and A presses one.
  await press(MENU);
  await waitPhase(page, 'paused');
  await expect(page.locator('#btn-resume')).toBeFocused();
  await press(DOWN);
  await expect(page.locator('#btn-settings-pause')).toBeFocused();
  await press(UP);
  await expect(page.locator('#btn-resume')).toBeFocused();
  // Holding A through Resume must not fire as play restarts.
  const shots = (await state(page)).shots;
  await setButton(A, true);
  await waitPhase(page, 'playing');
  await page.waitForTimeout(600);
  expect((await state(page)).shots).toBe(shots);
  await setButton(A, false);
  await frames(3);
  await press(A);
  await expect.poll(async () => (await state(page)).shots).toBe(shots + 1);

  // Back on the mouse after a moment: it aims again.
  await page.waitForTimeout(1100);
  await page.mouse.click(640, 360);
  await expect.poll(async () => (await state(page)).mode).toBe('mouse');
  expect(errors).toEqual([]);
});

async function touchContext(browser: Browser, width = 844, height = 390): Promise<BrowserContext> {
  return browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
}

test('touch phone: simultaneous drag-aim and fire button, taps do not fire, portrait prompt pauses', async ({ browser }) => {
  const ctx = await touchContext(browser);
  const page = await ctx.newPage();
  const errors = await open(page);
  await expect(page.locator('body')).toHaveClass(/touch/);
  await page.screenshot({ path: `${SHOTS}/phone-title.png` });
  await start(page, true);
  await page.evaluate(() => {
    window.__HR__.setSpawning(false);
    window.__HR__.clearTargets();
  });
  await expect(page.locator('#btn-fire')).toBeVisible();
  const fire = (await page.locator('#btn-fire').boundingBox())!;
  const fx = fire.x + fire.width / 2;
  const fy = fire.y + fire.height / 2;
  const cdp = await ctx.newCDPSession(page);
  const touch = (type: string, points: Array<{ x: number; y: number; id: number }>) =>
    cdp.send('Input.dispatchTouchEvent', { type: type as 'touchStart', touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id })) });

  // A tap on the aim area never fires.
  await page.touchscreen.tap(300, 200);
  await page.waitForTimeout(300);
  expect((await state(page)).shots).toBe(0);

  // Aim finger down, fire finger down, drag aim while holding fire.
  const y0 = (await state(page)).yaw;
  await touch('touchStart', [{ x: 300, y: 200, id: 1 }]);
  await touch('touchStart', [{ x: 300, y: 200, id: 1 }, { x: fx, y: fy, id: 2 }]);
  const holdStart = Date.now();
  for (let i = 1; i <= 8; i++) {
    await touch('touchMove', [{ x: 300 + i * 12, y: 200 - i * 3, id: 1 }, { x: fx, y: fy, id: 2 }]);
    await page.waitForTimeout(60);
  }
  const yawAfterAim = (await state(page)).yaw;
  expect(yawAfterAim).toBeLessThan(y0 - 0.2);
  // Moving the fire finger does not rotate the camera.
  for (let i = 1; i <= 5; i++) {
    await touch('touchMove', [{ x: 396, y: 176, id: 1 }, { x: fx - i * 8, y: fy - i * 6, id: 2 }]);
    await page.waitForTimeout(40);
  }
  expect((await state(page)).yaw).toBeCloseTo(yawAfterAim, 5);
  await page.waitForTimeout(900);
  const fired = (await state(page)).shots;
  const heldSec = (Date.now() - holdStart) / 1000;
  await touch('touchEnd', []);
  // Holding fire: the first shot plus one every 0.4 s of play time, never faster.
  expect(fired).toBeGreaterThanOrEqual(2);
  expect(fired).toBeLessThanOrEqual(Math.floor(heldSec / 0.4) + 1);
  test.info().annotations.push({ type: 'touch-hold', description: `${fired} shots in ${heldSec.toFixed(2)} s held` });
  await page.screenshot({ path: `${SHOTS}/phone-play.png` });

  // Rotating to portrait shows the prompt and pauses without touching run state.
  const before = await state(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#rotate')).toBeVisible();
  await waitPhase(page, 'paused');
  await page.screenshot({ path: `${SHOTS}/phone-portrait.png` });
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('#rotate')).toBeHidden();
  await page.tap('#btn-resume');
  await waitPhase(page, 'playing');
  const after = await state(page);
  expect(after.levelIndex).toBe(before.levelIndex);
  expect(after.totalScore).toBe(before.totalScore);
  expect(after.hearts).toBe(before.hearts);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('resizing keeps the view rendering', async ({ page }) => {
  const errors = await open(page);
  await start(page);
  for (const [w, h] of [
    [900, 600],
    [1600, 900],
    [700, 900],
    [1280, 720],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(300);
    const stats = await page.evaluate(() => window.__HR__.pixelStats());
    expect(stats.distinctColors).toBeGreaterThan(40);
    const size = await page.evaluate(() => {
      const c = document.getElementById('game') as HTMLCanvasElement;
      return { cw: c.clientWidth, ch: c.clientHeight };
    });
    expect(size).toEqual({ cw: w, ch: h });
  }
  expect(errors).toEqual([]);
});

test('two browser contexts are independent sessions', async ({ browser }) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pa = await a.newPage();
  const pb = await b.newPage();
  await open(pa, 1);
  await open(pb, 2);
  await start(pa);
  await start(pb);
  const scored = await shootSucker(pa);
  expect((await state(pa)).totalScore).toBe(scored);
  expect((await state(pb)).totalScore).toBe(0);
  await pa.keyboard.press('KeyP');
  await waitPhase(pa, 'paused');
  expect((await state(pb)).phase).toBe('playing');
  await a.close();
  await b.close();
});

test('everything loads from this origin; play continues offline and the scores arrive once back online', async ({ page, context, baseURL }) => {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  const errors = await open(page);
  await start(page);
  await context.setOffline(true);
  const scored = await shootSucker(page);
  await finishLevel(page);
  await page.fill('#results-name', 'Ollie2');
  await page.click('#btn-save-level');
  await page.click('#btn-next');
  await skipCountdown(page);
  expect((await state(page)).env).toBe('Graveyard');
  expect((await state(page)).outbox).toBeGreaterThan(0); // waiting for the host
  await context.setOffline(false);
  const boards = await hostBoards(page);
  expect(boards.runs).toEqual([expect.objectContaining({ name: 'Ollie2', score: scored })]);
  const foreign = urls.filter((u) => !u.startsWith(baseURL!) && !u.startsWith('data:'));
  expect(foreign).toEqual([]);
  // The only failures allowed are score uploads attempted while the network was off.
  expect(errors.filter((e) => !/\/api\/sync|ERR_INTERNET_DISCONNECTED/.test(e))).toEqual([]);
});

test('can be added to a phone Home Screen: tags, manifest and icons are served', async ({ page, request }) => {
  const errors = await open(page);
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Halloween Rush');
  const manifestUrl = new URL((await page.locator('link[rel="manifest"]').getAttribute('href'))!, page.url());
  const manifest = await (await request.get(manifestUrl.href)).json();
  expect(manifest).toMatchObject({ name: 'Halloween Rush', display: 'fullscreen', orientation: 'landscape' });
  for (const icon of manifest.icons as Array<{ src: string; type: string }>) {
    const res = await request.get(new URL(icon.src, manifestUrl).href);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain(icon.type);
  }
  const touchIcon = await request.get(new URL((await page.locator('link[rel="apple-touch-icon"]').getAttribute('href'))!, page.url()).href);
  expect(touchIcon.headers()['content-type']).toContain('image/png');
  expect(errors).toEqual([]);
});

test('phone landscape: a full scoreboard and career fit the game-over screen; Save works by tap', async ({ browser, request }) => {
  // Ten earlier runs by the family on another device, over two maps: 15, 25, … 105.
  const events: object[] = [];
  const earlierRuns: number[] = [];
  const family = ['Hudson', 'Dad', 'Mom', 'Grandmother'];
  for (let i = 0; i < 10; i++) {
    const id = `seed-run-${String(i).padStart(4, '0')}`;
    events.push(
      { type: 'run', id, player: family[i % family.length] },
      { type: 'attempt', runId: id, attempt: 1, level: 1, map: 'Haunted House', score: (i + 1) * 10, completed: true },
      { type: 'attempt', runId: id, attempt: 2, level: 2, map: 'Graveyard', score: 5, completed: false },
    );
    earlierRuns.push((i + 1) * 10 + 5);
  }
  const seeded = await request.post('/api/sync', { data: { device: { id: 'seed-device-0001', fingerprint: 'seed', label: 'Windows · Chrome' }, events } });
  expect((await seeded.json()).accepted).toBe(30);

  const ctx = await touchContext(browser, 780, 360);
  const page = await ctx.newPage();
  const errors = await open(page);
  await start(page, true);
  const scored = await shootSucker(page);
  for (let i = 0; i < 3; i++) await page.evaluate(() => window.__HR__.hurt());
  await waitPhase(page, 'gameOver');
  // A sucker (25 plus range bonus) beats last place (15). It lands below every earlier run
  // that scored at least as much, since a tie goes below the older entry.
  const rank = earlierRuns.filter((score) => score >= scored).length + 1;
  expect(rank).toBeLessThanOrEqual(10);
  await expect(page.locator('#gameover-why')).toHaveText(`#${rank} on the scoreboard`);
  await expect(page.locator('#gameover-name')).not.toBeFocused(); // no surprise keyboard on touch
  const save = (await page.locator('#btn-save-score').boundingBox())!;
  expect(save.y + save.height).toBeLessThanOrEqual(360);
  const overflow = await page.evaluate(() => {
    const card = document.querySelector('#screen-gameover .card') as HTMLElement;
    return card.scrollWidth - card.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/phone-gameover.png` });
  await page.tap('#btn-save-score');
  await expect(page.locator('#gameover-rankbadge')).toHaveText(`#${rank} on the scoreboard!`);
  await expect(page.locator('#gameover-boards ol[aria-label="Scoreboard"] li')).toHaveCount(10);
  await expect(page.locator('#gameover-boards li.you')).toContainText(String(scored));
  await page.tap('#gameover-boards [role="tab"]:has-text("Career")');
  await expect(page.locator('#gameover-boards ol[aria-label="Career"]')).toContainText('Grandmother');
  await expect(page.locator('#gameover-boards ol[aria-label="Career"]')).toContainText('Avg/map: House');
  await page.screenshot({ path: `${SHOTS}/phone-gameover-career.png` });
  expect(errors).toEqual([]);
  await ctx.close();
});

test('making a Maps or Career top 10 asks for a name too', async ({ page, request }) => {
  // A full scoreboard (100–1,000 on Level 1) and one finished Graveyard level, by four family members.
  const events: object[] = [];
  const family = ['Hudson', 'Dad', 'Mom', 'Grandmother'];
  for (let i = 0; i < 10; i++) {
    const id = `seed-run-${String(i).padStart(4, '0')}`;
    events.push({ type: 'run', id, player: family[i % family.length] }, { type: 'attempt', runId: id, attempt: 1, level: 1, map: 'Haunted House', score: (i + 1) * 100, completed: true });
  }
  events.push({ type: 'attempt', runId: 'seed-run-0000', attempt: 2, level: 2, map: 'Graveyard', score: 500, completed: true });
  const seeded = await request.post('/api/sync', { data: { device: { id: 'seed-device-0001', fingerprint: 'seed', label: 'Windows · Chrome' }, events } });
  expect((await seeded.json()).accepted).toBe(21);

  const errors = await open(page);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.__HR__);
  await start(page);
  // Level 1: 25 makes no board (the Haunted House top 10 starts at 100).
  await shootSucker(page);
  await finishLevel(page);
  await expect(page.locator('#results-accuracy')).toHaveText('100% (1/1)');
  await expect(page.locator('#results-entry')).toBeHidden();
  await expect(page.locator('#results-levelbest')).toBeHidden();
  // Level 2: not the Level 2 record (500), but second best on the Graveyard.
  await page.click('#btn-next');
  await skipCountdown(page);
  await shootSucker(page);
  await finishLevel(page);
  await expect(page.locator('#results-entry')).toBeVisible();
  await expect(page.locator('#results-why')).toHaveText('#2 on the Graveyard board');
  await page.keyboard.type('Maya');
  await page.keyboard.press('Enter');
  await expect(page.locator('#results-levelbest')).toHaveText('#2 on the Graveyard board, Maya!');
  // Game over on level 3: 50 misses the scoreboard, but Maya is 5th of five players in career
  // points. The run already has her name, so there's only the badge.
  await page.click('#btn-next');
  await skipCountdown(page);
  for (let i = 0; i < 3; i++) await page.evaluate(() => window.__HR__.hurt());
  await waitPhase(page, 'gameOver');
  await expect(page.locator('#gameover-entry')).toBeHidden();
  await expect(page.locator('#gameover-rankbadge')).toHaveText('#5 in career points!');
  // A new run hasn't had its name confirmed yet, so making the career board asks again,
  // offering the last name used.
  await page.click('#btn-newrun');
  await skipCountdown(page);
  await shootSucker(page);
  for (let i = 0; i < 3; i++) await page.evaluate(() => window.__HR__.hurt());
  await waitPhase(page, 'gameOver');
  await expect(page.locator('#gameover-entry')).toBeVisible();
  await expect(page.locator('#gameover-why')).toHaveText('#5 in career points');
  await expect(page.locator('#gameover-name')).toHaveValue('Maya');
  await page.keyboard.press('Enter');
  await expect(page.locator('#gameover-rankbadge')).toHaveText('#5 in career points!');

  await page.click('#gameover-boards [role="tab"]:has-text("Career")');
  await expect(page.locator('#gameover-boards ol[aria-label="Career"] li').nth(4)).toContainText('Maya');
  await expect(page.locator('#gameover-boards ol[aria-label="Career"] li').nth(4)).toContainText('2 games · best 50 · Lv 3 · 100%');
  await page.click('#gameover-boards [role="tab"]:has-text("Maps")');
  const maps = page.locator('#gameover-boards [aria-label="Maps"]');
  await expect(maps.locator('ol[aria-label="Haunted House top 10"] li')).toHaveCount(10);
  await expect(maps.locator('ol[aria-label="Graveyard top 10"] li').nth(1)).toContainText('Maya');
  await expect(maps.locator('ol[aria-label="Graveyard top 10"] li').nth(1)).toContainText('Lv 2 · 100%');
  await page.screenshot({ path: `${SHOTS}/desktop-gameover-maps.png` });
  expect(errors).toEqual([]);
});

async function tour(page: Page, prefix: string): Promise<void> {
  await start(page, prefix.startsWith('phone'));
  for (let level = 0; level < 5; level++) {
    const s = await state(page);
    await page.evaluate(() => {
      window.__HR__.setSpawning(false);
      window.__HR__.clearTargets();
      for (const k of ['frankenstein', 'frankenstein', 'witch', 'spider', 'candyCorn', 'sucker']) window.__HR__.spawn(k);
      window.__HR__.advance(4.2);
    });
    await page.waitForTimeout(400);
    const stats = await page.evaluate(() => window.__HR__.pixelStats());
    expect(stats.distinctColors).toBeGreaterThan(60);
    await page.screenshot({ path: `${SHOTS}/${prefix}-level${level + 1}-${s.env.replace(/\s+/g, '-').toLowerCase()}.png` });
    await finishLevel(page);
    if (level < 4) {
      await page.click('#btn-next');
      await skipCountdown(page);
    }
  }
}

test('visual tour of all five environments (desktop)', async ({ page }) => {
  const errors = await open(page, 5);
  await tour(page, 'desktop');
  expect(errors).toEqual([]);
});

test('visual tour of all five environments (phone landscape)', async ({ browser }) => {
  const ctx = await touchContext(browser, 780, 360);
  const page = await ctx.newPage();
  const errors = await open(page, 5);
  await tour(page, 'phone');
  expect(errors).toEqual([]);
  await ctx.close();
});
