import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { segmentAabb, segmentGround, segmentSphere } from '../src/core/collision';
import { levelParams } from '../src/core/difficulty';
import { FireControl } from '../src/core/fireControl';
import { DEFAULT_SETTINGS, LEGACY_NAME, SaveStore, sanitize } from '../src/core/persistence';
import { addScore, cleanName, DEFAULT_NAME, rankFor } from '../src/core/scoreboard';
import type { ScoreEntry } from '../src/types';

describe('fire control', () => {
  const interval = CONFIG.weapon.fireIntervalSec;

  function holdFor(seconds: number, fps: number): number[] {
    const fc = new FireControl(interval);
    const dt = 1 / fps;
    const shots: number[] = [];
    fc.press();
    for (let i = 0; i * dt < seconds - 1e-9; i++) if (fc.update(dt, true)) shots.push(i * dt);
    return shots;
  }

  it.each([30, 60, 144, 240])('holding fire repeats every 0.4 s at %i fps', (fps) => {
    const shots = holdFor(2.0, fps);
    expect(shots.length).toBe(5);
    for (let i = 1; i < shots.length; i++) {
      expect(shots[i]! - shots[i - 1]!).toBeGreaterThanOrEqual(interval - 1 / fps - 1e-9);
      expect(shots[i]! - shots[i - 1]!).toBeLessThanOrEqual(interval + 1 / fps + 1e-9);
    }
  });

  it('never exceeds the rate with rapid taps from several input methods', () => {
    const fc = new FireControl(interval);
    const dt = 1 / 120;
    let shots = 0;
    for (let i = 0; i < 240; i++) {
      if (i % 3 === 0) fc.press(); // mouse
      if (i % 5 === 0) fc.press(); // touch
      if (fc.update(dt, false)) shots++;
    }
    expect(shots).toBeLessThanOrEqual(Math.ceil(2 / interval));
    expect(shots).toBeGreaterThanOrEqual(4);
  });

  it('fires immediately on a fresh press and buffers a press during cooldown', () => {
    const fc = new FireControl(interval);
    expect(fc.update(1 / 60, false)).toBe(false);
    fc.press();
    expect(fc.update(1 / 60, false)).toBe(true);
    fc.press();
    let firedAt = -1;
    for (let i = 1; i < 60 && firedAt < 0; i++) if (fc.update(1 / 60, false)) firedAt = i;
    expect(firedAt).toBe(Math.round(interval * 60));
  });

  it('cancel drops a buffered press (pause/blur clears held input)', () => {
    const fc = new FireControl(interval);
    fc.press();
    fc.update(1 / 60, false);
    fc.press();
    fc.cancel();
    let fired = false;
    for (let i = 0; i < 60; i++) fired ||= fc.update(1 / 60, false);
    expect(fired).toBe(false);
  });
});

describe('collision', () => {
  const O = { x: 0, y: 0, z: 0 };
  it('finds the entry point of a segment into a sphere', () => {
    const t = segmentSphere(O, { x: 0, y: 0, z: -10 }, { x: 0, y: 0, z: -5 }, 1);
    expect(t).toBeCloseTo(0.4, 6);
  });

  it('catches a fast projectile that would tunnel through a thin target between frames', () => {
    // 48 m/s at 5 fps = 9.6 m per step; a 0.46 m spider sits in the middle of that span.
    const p0 = { x: 0, y: 2, z: -2 };
    const p1 = { x: 0, y: 2, z: -11.6 };
    expect(segmentSphere(p0, p1, { x: 0.3, y: 2, z: -7 }, 0.46)).not.toBeNull();
    expect(segmentSphere(p0, p1, { x: 2, y: 2, z: -7 }, 0.46)).toBeNull();
  });

  it('handles boxes and the ground plane', () => {
    const box = { min: { x: -1, y: 0, z: -6 }, max: { x: 1, y: 3, z: -5 } };
    expect(segmentAabb({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: -10 }, box)).toBeCloseTo(0.5, 6);
    expect(segmentAabb({ x: 5, y: 1, z: 0 }, { x: 5, y: 1, z: -10 }, box)).toBeNull();
    expect(segmentGround({ x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: -2 }, 0)).toBeCloseTo(0.5, 6);
    expect(segmentGround({ x: 0, y: 1, z: 0 }, { x: 0, y: 0.5, z: -2 }, 0)).toBeNull();
  });
});

describe('difficulty progression', () => {
  it('cycles through five environments and counts nights', () => {
    expect([0, 1, 2, 3, 4, 5, 9, 10].map((i) => levelParams(i).environmentIndex)).toEqual([0, 1, 2, 3, 4, 0, 4, 0]);
    expect(levelParams(4).night).toBe(1);
    expect(levelParams(5).night).toBe(2);
  });

  it('starts with one spider and one incoming pumpkin at a time', () => {
    const p = levelParams(0);
    expect(p.spider.max).toBe(1);
    expect(p.incoming.max).toBe(1);
    expect(p.difficulty).toBe(0);
  });

  it('ramps up monotonically and caps', () => {
    let prev = levelParams(0);
    for (let i = 1; i <= 40; i++) {
      const p = levelParams(i);
      expect(p.spider.interval).toBeLessThanOrEqual(prev.spider.interval);
      expect(p.spider.max).toBeGreaterThanOrEqual(prev.spider.max);
      expect(p.incoming.flightSec).toBeLessThanOrEqual(prev.incoming.flightSec);
      expect(p.frank.speed).toBeGreaterThanOrEqual(prev.frank.speed);
      prev = p;
    }
    const cap = levelParams(CONFIG.difficulty.capLevelIndex);
    const far = levelParams(500);
    expect({ ...far, levelIndex: 0, environmentIndex: 0, night: 0 }).toEqual({ ...cap, levelIndex: 0, environmentIndex: 0, night: 0 });
    expect(far.spider.max).toBe(3);
    expect(far.incoming.max).toBe(3);
    // Players always get at least two seconds to defend.
    expect(far.incoming.flightSec).toBeGreaterThanOrEqual(2);
    expect(far.spider.prepSec).toBeGreaterThanOrEqual(0.7);
  });
});

describe('scoreboard', () => {
  const run = (name: string, score: number): ScoreEntry => ({ name, score, level: 1 });

  it('puts higher scores first; a tie goes below the older run', () => {
    const a = addScore([], run('A', 100));
    expect(a.rank).toBe(0);
    const b = addScore(a.board, run('B', 200));
    expect(b.rank).toBe(0);
    const c = addScore(b.board, run('C', 100));
    expect(c.rank).toBe(2);
    expect(c.board.map((e) => e.name)).toEqual(['B', 'A', 'C']);
  });

  it('keeps the top ten; a run must beat last place to get on a full board', () => {
    let board: ScoreEntry[] = [];
    for (let i = 1; i <= CONFIG.scoreboard.size; i++) board = addScore(board, run(`P${i}`, i * 10)).board;
    expect(board).toHaveLength(CONFIG.scoreboard.size);
    expect(rankFor(board, 10)).toBeNull();
    const r = addScore(board, run('New', 11));
    expect(r.rank).toBe(CONFIG.scoreboard.size - 1);
    expect(r.board).toHaveLength(CONFIG.scoreboard.size);
    expect(r.board.at(-1)!.name).toBe('New');
    expect(r.board.some((e) => e.name === 'P1')).toBe(false);
    expect(board).toHaveLength(CONFIG.scoreboard.size); // the old board is untouched
  });

  it('never lists a run that scored nothing', () => {
    expect(rankFor([], 0)).toBeNull();
    expect(addScore([], run('Zero', 0))).toEqual({ board: [], rank: null });
  });

  it('cleans names: whitespace, control characters, length counted in characters', () => {
    expect(cleanName('  Hud\u0000son \n  Jr  ')).toBe('Hud son Jr');
    expect(cleanName('   ')).toBe('');
    expect(cleanName('abcdefghijklmnopqrstuvwxyz')).toBe('abcdefghijklmnop');
    expect(cleanName('🎃'.repeat(20))).toBe('🎃'.repeat(CONFIG.scoreboard.nameMaxChars));
  });
});

describe('persistence', () => {
  const memory = () => {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      data,
    };
  };

  it('round-trips settings, bests and the scoreboard', () => {
    const mem = memory();
    const store = new SaveStore(() => mem, 'k');
    const data = {
      settings: { volume: 0.3, muted: true, aimSensitivity: 1.7 },
      bests: { bestRunScore: 1234, furthestLevel: 6 },
      scoreboard: [
        { name: 'Hudson', score: 1234, level: 7 },
        { name: 'Dad 🎃', score: 900, level: 5 },
      ],
      playerName: 'Hudson',
      levelBests: [300, 0, 450],
    };
    expect(store.save(data)).toBe(true);
    expect(new SaveStore(() => mem, 'k').load()).toEqual(data);
  });

  it('keeps a best run saved before the scoreboard existed, without a name', () => {
    const old = sanitize({ settings: {}, bests: { bestRunScore: 3000, furthestLevel: 4 } });
    expect(old.scoreboard).toEqual([{ name: LEGACY_NAME, score: 3000, level: 0 }]);
    expect(old.playerName).toBe('');
    expect(sanitize({ bests: { bestRunScore: 0 } }).scoreboard).toEqual([]);
    // Once the board exists it is never re-seeded.
    expect(sanitize({ bests: { bestRunScore: 3000 }, scoreboard: [] }).scoreboard).toEqual([]);
  });

  it('cleans a tampered scoreboard: bad entries dropped, names fixed, sorted and capped', () => {
    const d = sanitize({
      scoreboard: [
        { name: 'Low', score: 5, level: 1 },
        { name: 42, score: 70, level: 'x' },
        { name: 'x'.repeat(50), score: 60, level: 3 },
        { name: 'Neg', score: -10 },
        { name: 'NaN', score: 'lots' },
        null,
        'junk',
        ...Array.from({ length: 12 }, (_, i) => ({ name: `P${i}`, score: 20 + i, level: 2 })),
      ],
      playerName: { evil: true },
    });
    expect(d.scoreboard).toHaveLength(10);
    expect(d.scoreboard[0]).toEqual({ name: DEFAULT_NAME, score: 70, level: 0 });
    expect(d.scoreboard[1]!.name).toBe('x'.repeat(16));
    for (let i = 1; i < d.scoreboard.length; i++) expect(d.scoreboard[i - 1]!.score).toBeGreaterThanOrEqual(d.scoreboard[i]!.score);
    expect(d.scoreboard.some((e) => e.name === 'Low' || e.name === 'Neg' || e.name === 'NaN')).toBe(false);
    expect(d.playerName).toBe('');
    expect(sanitize({ scoreboard: { not: 'a list' } }).scoreboard).toEqual([]);
    expect(sanitize({ levelBests: [120, 'x', -4, null, 1e12] }).levelBests).toEqual([120, 0, 0, 0, 1e9]);
    expect(sanitize({ scoreboard: [{ name: 'A', score: 5, runId: 'r1' }, { name: 'B', score: 4, runId: 'run-ok-12345' }] }).scoreboard).toEqual([
      { name: 'A', score: 5, level: 0 },
      { name: 'B', score: 4, level: 0, runId: 'run-ok-12345' },
    ]);
  });

  it('survives unavailable storage (throwing accessor)', () => {
    const store = new SaveStore(() => {
      throw new Error('SecurityError');
    }, 'k');
    expect(store.available).toBe(false);
    expect(store.load().settings).toEqual(DEFAULT_SETTINGS);
    expect(store.save(sanitize(null))).toBe(false);
  });

  it('survives malformed or hostile saved data', () => {
    const mem = memory();
    const store = new SaveStore(() => mem, 'k');
    for (const bad of ['{not json', 'null', '[]', '42', '{"settings":{"volume":"loud","aimSensitivity":99},"bests":{"bestRunScore":-5,"furthestLevel":"x"}}']) {
      mem.data.set('k', bad);
      const d = store.load();
      expect(d.settings.volume).toBeGreaterThanOrEqual(0);
      expect(d.settings.volume).toBeLessThanOrEqual(1);
      expect(d.settings.aimSensitivity).toBeLessThanOrEqual(3);
      expect(d.bests.bestRunScore).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(d.bests.furthestLevel)).toBe(true);
    }
  });

  it('reports failure instead of throwing when the quota is exceeded', () => {
    const store = new SaveStore(
      () => ({
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
      }),
      'k',
    );
    expect(store.save(sanitize(null))).toBe(false);
  });
});
