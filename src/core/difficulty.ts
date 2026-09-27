import { CONFIG } from '../config';

export interface LevelParams {
  levelIndex: number;
  /** 0..4, which environment this level uses. */
  environmentIndex: number;
  /** 1 for the first pass through the five environments, 2 for the second, ... */
  night: number;
  /** 0 (first level) .. 1 (capped). */
  difficulty: number;
  frank: { interval: number; max: number; speed: number };
  witch: { interval: number; max: number; speed: number };
  spider: { interval: number; max: number; prepSec: number; hangSec: number; throws: number };
  incoming: { flightSec: number; max: number };
  candyCorn: { interval: number; max: number };
  sucker: { interval: number; max: number };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function levelParams(levelIndex: number, cfg = CONFIG): LevelParams {
  const index = Math.max(0, Math.floor(levelIndex));
  const d = Math.min(index, cfg.difficulty.capLevelIndex) / cfg.difficulty.capLevelIndex;
  const e = cfg.difficulty.easy;
  const h = cfg.difficulty.hard;
  const count = (a: number, b: number) => Math.round(lerp(a, b, d));
  return {
    levelIndex: index,
    environmentIndex: index % cfg.level.environmentCount,
    night: Math.floor(index / cfg.level.environmentCount) + 1,
    difficulty: d,
    frank: { interval: lerp(e.frankInterval, h.frankInterval, d), max: count(e.frankMax, h.frankMax), speed: lerp(e.frankSpeed, h.frankSpeed, d) },
    witch: { interval: lerp(e.witchInterval, h.witchInterval, d), max: count(e.witchMax, h.witchMax), speed: lerp(e.witchSpeed, h.witchSpeed, d) },
    spider: {
      interval: lerp(e.spiderInterval, h.spiderInterval, d),
      // The first level always has exactly one active spider at a time.
      max: index === 0 ? 1 : count(e.spiderMax, h.spiderMax),
      prepSec: lerp(e.spiderPrepSec, h.spiderPrepSec, d),
      hangSec: lerp(e.spiderHangSec, h.spiderHangSec, d),
      throws: count(e.spiderThrows, h.spiderThrows),
    },
    incoming: { flightSec: lerp(e.incomingFlightSec, h.incomingFlightSec, d), max: index === 0 ? 1 : count(e.incomingMax, h.incomingMax) },
    candyCorn: { interval: lerp(e.candyCornInterval, h.candyCornInterval, d), max: count(e.candyCornMax, h.candyCornMax) },
    sucker: { interval: lerp(e.suckerInterval, h.suckerInterval, d), max: count(e.suckerMax, h.suckerMax) },
  };
}
