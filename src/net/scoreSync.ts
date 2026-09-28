import type { RangeZone, ShotRecord, TargetKind } from '../types';
import type { DeviceInfo } from './device';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
type Http = (url: string, init: RequestInit) => Promise<Response>;

/** A shot as sent to the host: [ms into the level, yaw, pitch, target | null, range zone | null, points, headshot]. */
export type ShotTuple = [ms: number, yaw: number, pitch: number, target: TargetKind | null, zone: RangeZone | null, points: number, headshot: 0 | 1];

/** What a device reports to the scores database (see scripts/scores-core.mjs). */
export type SyncEvent =
  | { type: 'run'; id: string; player: string }
  | { type: 'attempt'; runId: string; attempt: number; level: number; map: string; score: number; completed: boolean; shots?: ShotTuple[] }
  | { type: 'name'; runId: string; name: string };

const round3 = (v: number) => Math.round(v * 1000) / 1000;

export function shotTuple(s: ShotRecord): ShotTuple {
  return [s.ms, round3(s.yaw), round3(s.pitch), s.target, s.zone, s.points, s.headshot ? 1 : 0];
}

export interface RunRow {
  runId: string;
  name: string;
  score: number;
  level: number;
  shots: number;
  hits: number;
}

export interface LevelRow {
  level: number;
  map: string;
  name: string;
  score: number;
  runId: string;
}

/** One of the ten best finished levels on a map. */
export interface MapRow {
  map: string;
  name: string;
  score: number;
  level: number;
  runId: string;
  shots: number;
  hits: number;
}

export interface MapAverage {
  map: string;
  avg: number;
  plays: number;
}

export interface CareerRow {
  name: string;
  points: number;
  games: number;
  best: number;
  furthest: number;
  shots: number;
  hits: number;
  maps: MapAverage[];
}

export interface Boards {
  runs: RunRow[];
  levels: LevelRow[];
  maps: MapRow[];
  career: CareerRow[];
}

const OUTBOX_KEY = 'halloween-rush:outbox';
const MAX_OUTBOX = 400;
/** Levels carry their shot logs (a few KB each), so requests stay well under the host's 1 MB limit. */
const BATCH = 25;
const EVENT_TYPES = new Set(['run', 'attempt', 'name']);

const obj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
/** Shot counts; a host from before shot tracking sends none. */
const count = (v: unknown): number => (isNum(v) ? v : 0);

function rows<T>(list: unknown, read: (o: Record<string, unknown>) => T | null): T[] {
  return Array.isArray(list) ? list.map((x) => read(obj(x))).filter((x): x is T => x !== null) : [];
}

/** Validate leaderboards from the host; malformed rows are dropped. */
export function parseBoards(raw: unknown): Boards | null {
  const r = obj(raw);
  if (!Array.isArray(r.runs) || !Array.isArray(r.levels) || !Array.isArray(r.career)) return null;
  return {
    runs: rows(r.runs, (o) =>
      isStr(o.runId) && isStr(o.name) && isNum(o.score) && isNum(o.level) ? { runId: o.runId, name: o.name, score: o.score, level: o.level, shots: count(o.shots), hits: count(o.hits) } : null,
    ),
    levels: rows(r.levels, (o) =>
      isNum(o.level) && isStr(o.map) && isStr(o.name) && isNum(o.score) && isStr(o.runId) ? { level: o.level, map: o.map, name: o.name, score: o.score, runId: o.runId } : null,
    ),
    maps: rows(r.maps, (o) =>
      isStr(o.map) && isStr(o.name) && isNum(o.score) && isNum(o.level) && isStr(o.runId)
        ? { map: o.map, name: o.name, score: o.score, level: o.level, runId: o.runId, shots: count(o.shots), hits: count(o.hits) }
        : null,
    ),
    career: rows(r.career, (o) =>
      isStr(o.name) && isNum(o.points) && isNum(o.games) && isNum(o.best) && isNum(o.furthest)
        ? {
            name: o.name,
            points: o.points,
            games: o.games,
            best: o.best,
            furthest: o.furthest,
            shots: count(o.shots),
            hits: count(o.hits),
            maps: rows(o.maps, (m) => (isStr(m.map) && isNum(m.avg) && isNum(m.plays) ? { map: m.map, avg: m.avg, plays: m.plays } : null)),
          }
        : null,
    ),
  };
}

function loadOutbox(storage: StorageLike | null): SyncEvent[] {
  try {
    const list: unknown = JSON.parse(storage?.getItem(OUTBOX_KEY) ?? '[]');
    return Array.isArray(list) ? (list.filter((e) => EVENT_TYPES.has(String(obj(e).type))) as SyncEvent[]).slice(-MAX_OUTBOX) : [];
  } catch {
    return [];
  }
}

/**
 * Sends finished levels (with their shots), runs and names to the host's scores database and keeps the latest
 * leaderboards. Events wait in an outbox saved in this browser until the host confirms them,
 * so a Wi-Fi hiccup or a closed tab loses nothing; every event carries its own id, so
 * sending one twice is harmless. The game never waits on any of this.
 */
export class ScoreSync {
  boards: Boards | null = null;
  /** False once the host turns out to have no scores API (e.g. a plain static file server). */
  available = true;
  onBoards: ((b: Boards) => void) | null = null;
  private outbox: SyncEvent[];
  private busy = false;
  private failures = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly device: DeviceInfo,
    private readonly storage: StorageLike | null,
    private readonly http: Http = (url, init) => fetch(url, init),
  ) {
    this.outbox = loadOutbox(storage);
    if (typeof window !== 'undefined') window.addEventListener('online', () => void this.flush());
  }

  /** Events not yet confirmed by the host. */
  get pending(): number {
    return this.outbox.length;
  }

  record(ev: SyncEvent): void {
    this.outbox.push(ev);
    if (this.outbox.length > MAX_OUTBOX) this.outbox.splice(0, this.outbox.length - MAX_OUTBOX);
    this.save();
    void this.flush();
  }

  /** Send anything queued (an empty send just refreshes the leaderboards). */
  async flush(): Promise<void> {
    if (this.busy || !this.available) return;
    this.busy = true;
    if (this.retry !== null) clearTimeout(this.retry);
    this.retry = null;
    try {
      do {
        const batch = this.outbox.slice(0, BATCH);
        const res = await this.http('api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device: this.device, events: batch }),
        });
        if (res.status === 404 || res.status === 405) {
          this.available = false;
          return;
        }
        if (res.status >= 500 || res.status === 408 || res.status === 429) throw new Error(`scores host answered ${res.status}`);
        // Stored, or refused as malformed (which resending can't fix): either way it's done.
        this.outbox.splice(0, batch.length);
        this.save();
        if (res.ok) this.setBoards(await res.json().catch(() => null));
      } while (this.outbox.length);
      this.failures = 0;
    } catch {
      this.failures++;
      this.retry = setTimeout(() => void this.flush(), Math.min(60_000, 2000 * 2 ** this.failures));
    } finally {
      this.busy = false;
    }
  }

  private setBoards(raw: unknown): void {
    const boards = parseBoards(obj(raw).boards);
    if (!boards) return;
    this.boards = boards;
    this.onBoards?.(boards);
  }

  private save(): void {
    try {
      this.storage?.setItem(OUTBOX_KEY, JSON.stringify(this.outbox));
    } catch {
      /* full or blocked storage: the outbox still lives in memory */
    }
  }
}
