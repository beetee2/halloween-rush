import { CONFIG } from '../config';
import type { Bests, ScoreEntry, Settings } from '../types';
import { DEFAULT_NAME, scoreboardName } from './scoreboard';

export interface SaveData {
  settings: Settings;
  bests: Bests;
  /** Best finished runs, highest first. */
  scoreboard: ScoreEntry[];
  /** Name last typed on the scoreboard, offered again next time. */
  playerName: string;
  /** Best completed score per level number (index 0 = level 1), from this device and the host. */
  levelBests: number[];
}

/** Name shown for a best score saved before the scoreboard existed. */
export const LEGACY_NAME = '???';

const RUN_ID = /^[A-Za-z0-9-]{8,64}$/;
const MAX_LEVELS = 500;

export const DEFAULT_SETTINGS: Settings = { volume: 0.8, muted: false, aimSensitivity: 1, invertPadY: false, invertPadX: false };
export const DEFAULT_BESTS: Bests = { bestRunScore: 0, furthestLevel: 0 };

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function num(v: unknown, fallback: number, lo: number, hi: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
}

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function scoreboard(v: unknown): ScoreEntry[] {
  if (!Array.isArray(v)) return [];
  const out: ScoreEntry[] = [];
  for (const item of v) {
    const e = obj(item);
    const score = Math.floor(num(e.score, 0, 0, 1e9));
    if (score <= 0) continue;
    const entry: ScoreEntry = {
      // Names saved before they were checked are only kept if they're approved.
      name: e.name === LEGACY_NAME ? LEGACY_NAME : (typeof e.name === 'string' ? scoreboardName(e.name) : '') || DEFAULT_NAME,
      score,
      level: Math.floor(num(e.level, 0, 0, 1e6)),
    };
    if (typeof e.runId === 'string' && RUN_ID.test(e.runId)) entry.runId = e.runId;
    const shots = Math.floor(num(e.shots, 0, 0, 1e9));
    if (shots > 0) {
      entry.shots = shots;
      entry.hits = Math.floor(num(e.hits, 0, 0, shots));
    }
    out.push(entry);
  }
  // Stable sort: equal scores keep their saved order.
  return out.sort((a, c) => c.score - a.score).slice(0, CONFIG.scoreboard.size);
}

function levelBests(v: unknown): number[] {
  return Array.isArray(v) ? v.slice(0, MAX_LEVELS).map((x) => Math.floor(num(x, 0, 0, 1e9))) : [];
}

/** Validate untrusted saved JSON, falling back field-by-field to defaults. */
export function sanitize(raw: unknown): SaveData {
  const root = obj(raw);
  const s = obj(root.settings);
  const b = obj(root.bests);
  const bests: Bests = {
    bestRunScore: Math.floor(num(b.bestRunScore, 0, 0, 1e9)),
    furthestLevel: Math.floor(num(b.furthestLevel, 0, 0, 1e6)),
  };
  // Saves from before the scoreboard keep their best run on it, without a name.
  const board =
    root.scoreboard === undefined && bests.bestRunScore > 0
      ? [{ name: LEGACY_NAME, score: bests.bestRunScore, level: 0 }]
      : scoreboard(root.scoreboard);
  return {
    settings: {
      volume: num(s.volume, DEFAULT_SETTINGS.volume, 0, 1),
      muted: typeof s.muted === 'boolean' ? s.muted : DEFAULT_SETTINGS.muted,
      aimSensitivity: num(s.aimSensitivity, DEFAULT_SETTINGS.aimSensitivity, 0.25, 3),
      invertPadY: s.invertPadY === true,
      invertPadX: s.invertPadX === true,
    },
    bests,
    scoreboard: board,
    playerName: typeof root.playerName === 'string' ? scoreboardName(root.playerName) : '',
    levelBests: levelBests(root.levelBests),
  };
}

/**
 * Local save wrapper. Storage may be missing, blocked (throws on access), full, or hold
 * malformed data; none of these may stop the game from running.
 */
export class SaveStore {
  private storage: StorageLike | null;

  constructor(
    getStorage: () => StorageLike | null | undefined,
    private readonly key: string,
  ) {
    try {
      this.storage = getStorage() ?? null;
    } catch {
      this.storage = null;
    }
  }

  get available(): boolean {
    return this.storage !== null;
  }

  load(): SaveData {
    if (!this.storage) return sanitize(null);
    try {
      const text = this.storage.getItem(this.key);
      return sanitize(text ? JSON.parse(text) : null);
    } catch {
      return sanitize(null);
    }
  }

  /** Returns false (never throws) if the save could not be written. */
  save(data: SaveData): boolean {
    if (!this.storage) return false;
    try {
      this.storage.setItem(this.key, JSON.stringify(sanitize(data)));
      return true;
    } catch {
      return false;
    }
  }
}

export function browserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  // Accessing window.localStorage itself throws in some privacy modes.
  const s = window.localStorage;
  const probe = '__hr_probe__';
  s.setItem(probe, '1');
  s.removeItem(probe);
  return s;
}
