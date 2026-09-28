import type { RangeZone, SizeClass, TargetKind } from './types';

/**
 * Central gameplay tuning. Everything a designer might want to tweak lives here so
 * balancing never requires editing systems code.
 */
export const CONFIG = {
  level: {
    durationSec: 60,
    startingHearts: 3,
    countdownSec: 3,
    /** After losing a heart, further impacts are ignored for this long. */
    damageImmunitySec: 1.2,
    environmentCount: 5,
  },

  sim: {
    /** Largest simulation sub-step; frames are split into steps no longer than this. */
    maxStepSec: 1 / 60,
    /** Frame deltas are clamped so a long hitch cannot fast-forward the level. */
    maxFrameSec: 0.1,
  },

  weapon: {
    fireIntervalSec: 0.4,
    projectileSpeed: 48,
    projectileRadius: 0.22,
    projectileMaxRange: 95,
    /** Launcher muzzle in camera space (x right, y up, -z forward). */
    muzzleOffset: [0.3, -0.27, -1.0] as const,
    /** Crosshair ray length used to find the aim point when nothing is hit. */
    aimDistance: 80,
    maxActiveProjectiles: 12,
  },

  points: {
    small: 50,
    medium: 25,
    large: 10,
  } satisfies Record<SizeClass, number>,

  /** Flat base points for specific target types, replacing the size-class value. */
  kindPoints: {
    witch: 75,
    candyCorn: 100,
  } satisfies Partial<Record<TargetKind, number>>,

  /** Range bonus by distance (m) from the player's eye to the hit point. */
  range: {
    mediumFromM: 12,
    farFromM: 18,
    bonus: { near: 0, medium: 5, far: 10 } satisfies Record<RangeZone, number>,
  },

  /** Default size class per target type. Spiders may roll a rarer medium "big spider". */
  defaultSize: {
    frankenstein: 'large',
    witch: 'medium',
    spider: 'small',
    incomingPumpkin: 'medium',
    candyCorn: 'small',
    sucker: 'medium',
  } satisfies Record<TargetKind, SizeClass>,

  aim: {
    yawLimitDeg: 55,
    pitchMinDeg: -12,
    pitchMaxDeg: 38,
    /** Radians per CSS pixel at sensitivity 1. */
    mouseRadPerPx: 0.0022,
    touchRadPerPx: 0.0048,
    /** Clamp for a single pointer-lock movement event (browsers occasionally spike). */
    maxMouseDeltaPx: 180,
    /** Drag-fallback: a press that moves less than this and releases quickly is a click-to-fire. */
    clickMoveTolerancePx: 8,
    clickMaxSec: 0.35,
    /** Controller: turn speed with a stick pushed all the way (radians per second at sensitivity 1). */
    padRadPerSec: 2.2,
    /** Controller: stick travel ignored around the centre, so a resting stick never drifts the view. */
    padDeadZone: 0.18,
  },

  camera: {
    position: [0, 1.7, 0] as const,
    fovDeg: 55,
    /** Widen the vertical FOV on narrow screens so the horizontal view stays usable. */
    minHorizontalFovDeg: 72,
  },

  targets: {
    frankenstein: { hitSpheres: [{ y: 1.45, r: 0.66 }, { y: 2.35, r: 0.5 }], spawnMargin: 1.2 },
    witch: { hitRadius: 0.8, hitCenterY: 0.55, bobAmplitude: 0.6, spawnMargin: 3 },
    spider: {
      hitRadius: { small: 0.46, medium: 0.64 } as Record<'small' | 'medium', number>,
      mediumChance: 0.15,
      descendSpeed: 2.4,
      climbSpeed: 3.2,
      minHangHeight: 2.8,
      maxHangHeight: 5.4,
      swingAmplitude: 0.35,
    },
    incomingPumpkin: { hitRadius: 0.62, gravity: -5, arrivalAhead: 1.3, lateralJitter: 0.55 },
    candyCorn: { hitRadius: 0.5, scale: 0.75, tossSpeed: [7.5, 9.5] as const, gravity: -6 },
    sucker: { hitRadius: 0.62, hoverSec: [4, 5.5] as const, hoverY: [2.2, 3.6] as const },
  },

  difficulty: {
    /** Difficulty ramps linearly per level index and is capped from this index onward. */
    capLevelIndex: 12,
    easy: {
      frankInterval: 3.4, frankMax: 2, frankSpeed: 1.5,
      witchInterval: 7, witchMax: 1, witchSpeed: 4.5,
      spiderInterval: 7, spiderMax: 1, spiderPrepSec: 1.1, spiderHangSec: 1.5, spiderThrows: 2,
      incomingFlightSec: 3.0, incomingMax: 1,
      candyCornInterval: 6, candyCornMax: 1,
      suckerInterval: 8, suckerMax: 1,
    },
    hard: {
      frankInterval: 2.0, frankMax: 4, frankSpeed: 2.6,
      witchInterval: 4, witchMax: 3, witchSpeed: 7.5,
      spiderInterval: 3.2, spiderMax: 3, spiderPrepSec: 0.7, spiderHangSec: 0.8, spiderThrows: 3,
      incomingFlightSec: 2.0, incomingMax: 3,
      candyCornInterval: 4.5, candyCornMax: 2,
      suckerInterval: 6, suckerMax: 2,
    },
    /** Delay before the first spawn of each type in a level. */
    firstSpawnSec: {
      frankenstein: 0.6,
      witch: 3,
      spider: 5,
      candyCorn: 2.5,
      sucker: 8,
    },
  },

  caps: {
    maxTargets: 16,
    maxParticles: 260,
    maxFlyingCandies: 12,
    maxBagVisibleCandies: 26,
    maxScorePopups: 8,
  },

  render: {
    maxPixelRatioDesktop: 2,
    maxPixelRatioTouch: 1.5,
  },

  teleport: {
    /** Swirl-in time before the scene swaps, then swirl-out time. */
    inSec: 0.7,
    outSec: 0.7,
  },

  screens: {
    /**
     * Level results and game over ignore clicks and taps this long after appearing, so a
     * player still firing when the level ends can't skip them unseen.
     */
    clickLockSec: 1,
  },

  scoreboard: {
    /** Runs kept on the local scoreboard. */
    size: 10,
    /** Longest name, in characters. */
    nameMaxChars: 16,
  },

  storageKey: 'halloween-rush:v1',
} as const;

export type GameConfig = typeof CONFIG;
