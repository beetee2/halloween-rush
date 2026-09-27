import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Scores } from './scores-core.mjs';

export type { Boards, CareerRow, LevelRow, MapRow, RunRow, Scores } from './scores-core.mjs';

export interface ScoresDb extends Scores {
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
