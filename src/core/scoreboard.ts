import { CONFIG } from '../config';
import type { ScoreEntry } from '../types';

/** Saved when the name box is left empty. */
export const DEFAULT_NAME = 'Player';

/** Collapse whitespace, drop control characters and cap the length in characters (emoji stay whole). */
export function cleanName(raw: string): string {
  const s = raw.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, CONFIG.scoreboard.nameMaxChars).join('').trim();
}

/**
 * The 0-based place `score` would take on the board, or null if it doesn't make it.
 * A tie goes below the older entry, so an equal score never bumps anyone off.
 */
export function rankFor(board: ReadonlyArray<{ score: number }>, score: number): number | null {
  if (!(score > 0)) return null;
  let i = 0;
  while (i < board.length && board[i]!.score >= score) i++;
  return i < CONFIG.scoreboard.size ? i : null;
}

/** A new board with `entry` at its place (the last entry drops off a full board). */
export function addScore(board: readonly ScoreEntry[], entry: ScoreEntry): { board: ScoreEntry[]; rank: number | null } {
  const rank = rankFor(board, entry.score);
  if (rank === null) return { board: [...board], rank: null };
  const next = [...board];
  next.splice(rank, 0, entry);
  return { board: next.slice(0, CONFIG.scoreboard.size), rank };
}

/** Place (0-based) a finished level's score would take in its map's top 10, or null. */
export function mapRank(maps: ReadonlyArray<{ map: string; score: number }>, map: string, score: number): number | null {
  return rankFor(maps.filter((m) => m.map === map), score);
}

/**
 * Place (0-based) a player would reach on the career board after adding `points`, or null.
 * `who` is the name their runs are listed under (names match case-insensitively, like the
 * host); a player missing from the top 10 is counted from zero. Levels of this run that the
 * host already has may be counted twice, which only errs toward asking for a name.
 */
export function careerRank(career: ReadonlyArray<{ name: string; points: number }>, who: string, points: number): number | null {
  if (!(points > 0)) return null;
  const key = who.toLowerCase();
  const mine = career.find((c) => c.name.toLowerCase() === key);
  const others = career.filter((c) => c !== mine).map((c) => ({ score: c.points }));
  return rankFor(others, (mine?.points ?? 0) + points);
}

/** Share of shots that hit, as a whole percentage; null before the first shot. */
export function accuracy(hits: number, shots: number): number | null {
  return shots > 0 ? Math.round((100 * hits) / shots) : null;
}
