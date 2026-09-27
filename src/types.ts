export type SizeClass = 'small' | 'medium' | 'large';

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
}
