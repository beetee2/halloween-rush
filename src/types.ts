export type SizeClass = 'small' | 'medium' | 'large';

/** Distance band from the player to the hit point; farther hits earn a bonus. */
export type RangeZone = 'near' | 'medium' | 'far';

export type TargetKind =
  | 'frankenstein'
  | 'witch'
  | 'spider'
  | 'incomingPumpkin'
  | 'candyCorn'
  | 'sucker';

export type CandyKind = 'frankenstein' | 'witch' | 'spider' | 'pumpkin' | 'candyCorn' | 'sucker';

export const CANDY_KINDS: readonly CandyKind[] = [
  'frankenstein',
  'witch',
  'spider',
  'pumpkin',
  'candyCorn',
  'sucker',
];

/** Which miniature candy each shot target turns into. */
export const CANDY_FOR_TARGET: Readonly<Record<TargetKind, CandyKind>> = {
  frankenstein: 'frankenstein',
  witch: 'witch',
  spider: 'spider',
  incomingPumpkin: 'pumpkin',
  candyCorn: 'candyCorn',
  sucker: 'sucker',
};

export type Phase =
  | 'title'
  | 'teleporting'
  | 'countdown'
  | 'playing'
  | 'paused'
  | 'levelComplete'
  | 'gameOver';

export type Inventory = Record<CandyKind, number>;

/** One pumpkin fired during a level. The hit fields are filled in when (if) it lands on a target. */
export interface ShotRecord {
  /** Milliseconds into the level (after the countdown). */
  ms: number;
  /** Aim when fired, in radians (yaw: left is positive; pitch: up is positive). */
  yaw: number;
  pitch: number;
  /** What it hit, or null for a miss. */
  target: TargetKind | null;
  zone: RangeZone | null;
  points: number;
}

export interface Settings {
  /** Master volume 0..1. */
  volume: number;
  muted: boolean;
  /** Aim sensitivity multiplier. */
  aimSensitivity: number;
}

export interface Bests {
  /** Highest valid run total reached at a completed level or game over. */
  bestRunScore: number;
  /** Highest level number (1-based) completed. */
  furthestLevel: number;
}

/** A finished run on the scoreboard. */
export interface ScoreEntry {
  name: string;
  score: number;
  /** Level number (1-based) the run ended on; 0 when unknown (carried over from an old save). */
  level: number;
  /** The run this came from, when known (to highlight it). */
  runId?: string;
  /** Pumpkins fired and target hits over the run, when known. */
  shots?: number;
  hits?: number;
}
