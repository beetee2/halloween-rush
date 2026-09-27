import { CONFIG } from './config';
import type { Game } from './game';
import type { SpawnKind } from './sim/world';
import type { RangeZone, SizeClass, TargetKind } from './types';

/**
 * Deterministic fixtures for browser automation. This module is only imported when the
 * app is built with `--mode e2e`; production builds do not contain it and players have
 * no access to it. It never changes game rules, it only drives time and spawning and
 * records hits.
 */
export function installTestHooks(game: Game): void {
  const step = CONFIG.sim.maxStepSec;
  // Which spot a seeded target lands on decides its range bonus, so tests read the scored
  // hit back instead of hard-coding points. The run's own rule still awards them.
  let lastHit: { kind: TargetKind; size: SizeClass; zone: RangeZone; points: number } | null = null;
  const awardHit = game.run.awardHit.bind(game.run);
  game.run.awardHit = (kind, size, zone = 'near') => {
    const points = awardHit(kind, size, zone);
    lastHit = { kind, size, zone, points };
    return points;
  };
  const api = {
    state() {
      const r = game.run;
      return {
        phase: r.phase,
        levelIndex: r.levelIndex,
        env: game.environment.name,
        hearts: r.hearts,
        time: r.timeRemaining,
        countdown: r.countdownRemaining,
        levelScore: r.levelScore,
        totalScore: r.totalScore,
        inventory: r.totalInventory,
        levelInventory: r.levelInventory,
        bests: r.bests,
        targets: game.world.targets.map((t) => ({ id: t.id, kind: t.kind, alive: t.alive, x: t.position.x, y: t.position.y, z: t.position.z })),
        projectiles: game.world.projectiles.length,
        shots: game.shotsFired,
        locked: game.input.locked,
        mode: game.input.mode,
        inputEnabled: game.input.enabled,
        teleporting: game.teleporting,
        bagVisible: game.bag.visibleCount,
        flights: game.bag.activeFlights,
        particles: game.effects.activeCount,
        yaw: game.input.yaw,
        pitch: game.input.pitch,
        runId: game.runId,
        deviceId: game.scores.device.id,
        outbox: game.scores.pending,
      };
    },
    setSpawning(on: boolean) {
      game.world.spawningEnabled = on;
    },
    spawn(kind: SpawnKind) {
      return game.world.spawn(kind)?.id ?? null;
    },
    clearTargets() {
      for (const t of [...game.world.targets]) t.removed = true;
      game.world.sweep(0);
    },
    /** The most recent hit: target kind and size, range zone and the points awarded. */
    lastHit() {
      return lastHit;
    },
    /** Point the crosshair at a target's current position. */
    aimAt(id: number) {
      const t = game.world.targets.find((x) => x.id === id);
      if (!t) return false;
      const eye = game.world.eye;
      const d = t.position.clone().sub(eye);
      game.input.yaw = Math.atan2(-d.x, -d.z);
      game.input.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      return true;
    },
    /** Run simulation steps (countdown/playing only), as if time passed. */
    advance(seconds: number) {
      const n = Math.round(seconds / step);
      for (let i = 0; i < n; i++) {
        const p = game.run.phase;
        if (p !== 'countdown' && p !== 'playing') break;
        game.fixedStep(step);
      }
    },
    /** Jump to the last moment of the level so the next step completes it. */
    nearEnd() {
      if (game.run.phase === 'playing') game.run.timeRemaining = step / 2;
    },
    /**
     * Render now and sample the drawing buffer: a blank or single-colour canvas has very
     * few distinct colours, a populated 3D scene has many.
     */
    pixelStats() {
      game.stage.render();
      const gl = game.stage.renderer.getContext();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const px = new Uint8Array(4);
      const colors = new Set<number>();
      let sum = 0;
      let sumSq = 0;
      let n = 0;
      for (let gy = 1; gy < 24; gy++) {
        for (let gx = 1; gx < 32; gx++) {
          gl.readPixels(Math.floor((gx / 32) * w), Math.floor((gy / 24) * h), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          colors.add(((px[0]! >> 3) << 10) | ((px[1]! >> 3) << 5) | (px[2]! >> 3));
          const l = 0.2126 * px[0]! + 0.7152 * px[1]! + 0.0722 * px[2]!;
          sum += l;
          sumSq += l * l;
          n++;
        }
      }
      const mean = sum / n;
      return { distinctColors: colors.size, meanLuma: mean, stdLuma: Math.sqrt(Math.max(0, sumSq / n - mean * mean)) };
    },
    /** An incoming pumpkin reaches the player (immunity cleared first). */
    hurt() {
      if (game.run.phase !== 'playing') return false;
      game.run.immunityRemaining = 0;
      const damaged = game.run.applyDamage();
      game.fixedStep(step);
      return damaged;
    },
  };
  (window as unknown as { __HR__: typeof api }).__HR__ = api;
}
