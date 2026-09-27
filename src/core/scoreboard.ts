import { CONFIG } from '../config';
import type { ScoreEntry } from '../types';
import { approvedName } from './names.mjs';

/** Saved when the name box is left empty. */
export const DEFAULT_NAME = 'Player';

/** Collapse whitespace, drop control characters and cap the length in characters (emoji stay whole). */
export function cleanName(raw: string): string {
  const s = raw.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, CONFIG.scoreboard.nameMaxChars).join('').trim();
}

/** The typed name, cleaned, if it may go on a scoreboard (see names.mjs); otherwise ''. */
export function scoreboardName(raw: string): string {
  return approvedName(cleanName(raw));
}

/**
 * The 0-based place `score` would take on the board, or null if it doesn't make it.
 * A tie goes below the older entry, so an equal score never bumps anyone off.
 */
export function rankFor(board: readonly ScoreEntry[], score: number): number | null {
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
