import type { IncomingMessage, ServerResponse } from 'node:http';

export interface RunRow {
  runId: string;
  name: string;
  score: number;
  level: number;
}

export interface LevelRow {
  level: number;
  map: string;
  name: string;
  score: number;
  runId: string;
}

export interface CareerRow {
  name: string;
  points: number;
  games: number;
  best: number;
  furthest: number;
  maps: Array<{ map: string; avg: number; plays: number }>;
}

export interface Boards {
  runs: RunRow[];
  levels: LevelRow[];
  career: CareerRow[];
}

export interface ScoresDb {
  sync(body: unknown): { accepted: number; rejected: number; error?: undefined } | { error: string };
  boards(): Boards;
  reset(): void;
  close(): void;
}

export interface ScoresApi {
  readonly file: string;
  handle(req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void>;
  close(): void;
}

export function cleanName(raw: string, max?: number): string;
export function openScores(file: string): ScoresDb;
export function createScoresApi(opts: { file: string; allowReset?: boolean }): ScoresApi;
