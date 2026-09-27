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

export interface MapRow {
  map: string;
  name: string;
  score: number;
  level: number;
  runId: string;
  shots: number;
  hits: number;
}

export interface CareerRow {
  name: string;
  points: number;
  games: number;
  best: number;
  furthest: number;
  shots: number;
  hits: number;
  maps: Array<{ map: string; avg: number; plays: number }>;
}

export interface Boards {
  runs: RunRow[];
  levels: LevelRow[];
  maps: MapRow[];
  career: CareerRow[];
}

export type SyncResult = { accepted: number; rejected: number; error?: undefined } | { error: string };

export interface Scores {
  sync(body: unknown): Promise<SyncResult>;
  boards(): Promise<Boards>;
  reset(): Promise<void>;
}

/** The slice of Cloudflare's D1 binding the scores code uses. */
export interface D1Like {
  prepare(sql: string): D1LikeStatement;
  batch(statements: D1LikeStatement[]): Promise<Array<{ results: Array<Record<string, unknown>> }>>;
}

export interface D1LikeStatement {
  bind(...values: unknown[]): D1LikeStatement;
  all(): Promise<{ results: Array<Record<string, unknown>> }>;
}

export const MAX_BODY_BYTES: number;
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string);
}
export function cleanName(raw: string, max?: number): string;
export function createScores(db: D1Like): Scores;
export function errorResponse(err: unknown): Response;
export function handleScores(request: Request, scores: Scores, opts?: { allowReset?: boolean }): Promise<Response | null>;
