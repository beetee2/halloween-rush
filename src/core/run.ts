import { CONFIG, type GameConfig } from '../config';
import { CANDY_FOR_TARGET, type Bests, type Inventory, type Phase, type RangeZone, type ShotRecord, type SizeClass, type TargetKind } from '../types';
import { addInventories, cloneInventory, emptyInventory } from './inventory';

export interface Snapshot {
  score: number;
  inventory: Inventory;
}

export type StepOutcome = 'none' | 'started' | 'levelComplete' | 'gameOver';

export function rangeZone(distance: number, cfg: GameConfig = CONFIG): RangeZone {
  if (distance >= cfg.range.farFromM) return 'far';
  if (distance >= cfg.range.mediumFromM) return 'medium';
  return 'near';
}

/** Base points (per-type override, else size class) plus the range bonus, multiplied for a headshot. */
export function pointsFor(kind: TargetKind, size: SizeClass, zone: RangeZone = 'near', headshot = false, cfg: GameConfig = CONFIG): number {
  const kindPoints: Partial<Record<TargetKind, number>> = cfg.kindPoints;
  const headshotMultiplier: Partial<Record<TargetKind, number>> = cfg.headshotMultiplier;
  const points = (kindPoints[kind] ?? cfg.points[size]) + cfg.range.bonus[zone];
  return headshot ? points * (headshotMultiplier[kind] ?? 1) : points;
}

/**
 * Pure run/level rules: phase machine, timer, hearts, immunity, scoring, checkpoints.
 * No rendering or DOM access so every rule can be unit tested.
 *
 * Score model: `checkpoint` is the committed score + candy from earlier levels, captured
 * when a level attempt starts. The current attempt accumulates into `levelScore` /
 * `levelInventory`. Replay discards the attempt and restores the checkpoint; Next Level
 * folds the attempt into a new checkpoint.
 */
export class RunModel {
  phase: Phase = 'title';
  pausedFrom: 'countdown' | 'playing' | null = null;
  levelIndex = 0;
  checkpoint: Snapshot = { score: 0, inventory: emptyInventory() };
  levelScore = 0;
  levelInventory: Inventory = emptyInventory();
  hearts: number;
  timeRemaining: number;
  countdownRemaining = 0;
  immunityRemaining = 0;
  /** Increments every time a level attempt begins; lets callers discard stale work. */
  attempt = 0;
  /** True once the current attempt has been committed (completed or game over). */
  resultCommitted = false;
  /** Set when the last commit raised a personal best. */
  newBest = false;
  /** Every shot of the current level attempt, in order. */
  shots: ShotRecord[] = [];
  /** Shots and hits over the whole run, replayed attempts included. */
  runShots = 0;
  runHits = 0;
  readonly bests: Bests;

  constructor(
    bests: Bests = { bestRunScore: 0, furthestLevel: 0 },
    private readonly cfg: GameConfig = CONFIG,
  ) {
    this.bests = { ...bests };
    this.hearts = cfg.level.startingHearts;
    this.timeRemaining = cfg.level.durationSec;
  }

  get totalScore(): number {
    return this.checkpoint.score + this.levelScore;
  }

  get totalInventory(): Inventory {
    return addInventories(this.checkpoint.inventory, this.levelInventory);
  }

  /** Title or game over → teleport to level 1 with a clean score and bag. */
  startNewRun(): boolean {
    if (this.phase !== 'title' && this.phase !== 'gameOver' && this.phase !== 'paused') return false;
    this.levelIndex = 0;
    this.checkpoint = { score: 0, inventory: emptyInventory() };
    this.runShots = 0;
    this.runHits = 0;
    this.beginAttempt();
    return true;
  }

  /** Level results → next environment; the completed attempt becomes the new checkpoint. */
  nextLevel(): boolean {
    if (this.phase !== 'levelComplete') return false;
    this.checkpoint = { score: this.totalScore, inventory: this.totalInventory };
    this.levelIndex += 1;
    this.beginAttempt();
    return true;
  }

  /** Level results → same level again from the level-start snapshot. */
  replayLevel(): boolean {
    if (this.phase !== 'levelComplete') return false;
    this.beginAttempt();
    return true;
  }

  /** Abandon the run from the pause menu. Does not touch personal bests. */
  quitToTitle(): boolean {
    if (this.phase !== 'paused' && this.phase !== 'gameOver' && this.phase !== 'levelComplete') return false;
    this.phase = 'title';
    this.pausedFrom = null;
    return true;
  }

  /** Teleport finished and the scene is built: start the ready countdown. */
  sceneReady(): boolean {
    if (this.phase !== 'teleporting') return false;
    this.phase = 'countdown';
    this.countdownRemaining = this.cfg.level.countdownSec;
    return true;
  }

  pause(): boolean {
    if (this.phase !== 'countdown' && this.phase !== 'playing') return false;
    this.pausedFrom = this.phase;
    this.phase = 'paused';
    return true;
  }

  resume(): boolean {
    if (this.phase !== 'paused' || !this.pausedFrom) return false;
    this.phase = this.pausedFrom;
    this.pausedFrom = null;
    return true;
  }

  get acceptsCombat(): boolean {
    return this.phase === 'playing';
  }

  get levelHits(): number {
    return this.shots.filter((s) => s.target !== null).length;
  }

  /** A pumpkin left the launcher. Returns its record so a hit can be filled in later (null if not playing). */
  fireShot(yaw: number, pitch: number): ShotRecord | null {
    if (!this.acceptsCombat) return null;
    const shot: ShotRecord = { ms: Math.round((this.cfg.level.durationSec - this.timeRemaining) * 1000), yaw, pitch, target: null, zone: null, points: 0 };
    this.shots.push(shot);
    this.runShots += 1;
    return shot;
  }

  /**
   * Award points + candy for a successful hit, and mark `shot` (the pumpkin that hit) as a hit.
   * Returns points awarded (0 if not playing).
   */
  awardHit(kind: TargetKind, size: SizeClass, zone: RangeZone = 'near', shot: ShotRecord | null = null, headshot = false): number {
    if (!this.acceptsCombat) return 0;
    const pts = pointsFor(kind, size, zone, headshot, this.cfg);
    this.levelScore += pts;
    this.levelInventory[CANDY_FOR_TARGET[kind]] += 1;
    if (shot && shot.target === null) {
      Object.assign(shot, { target: kind, zone, points: pts });
      this.runHits += 1;
    }
    return pts;
  }

  /** An incoming pumpkin reached the player. Returns true if a heart was removed. */
  applyDamage(): boolean {
    if (!this.acceptsCombat || this.hearts <= 0 || this.immunityRemaining > 0) return false;
    this.hearts -= 1;
    this.immunityRemaining = this.cfg.level.damageImmunitySec;
    return true;
  }

  /**
   * Advance countdown or level time. Call once per simulation step *after* the world has
   * applied that step's hits and damage. If hearts hit zero in the same step that time
   * expires, game over wins.
   */
  advance(dt: number): StepOutcome {
    if (this.phase === 'countdown') {
      this.countdownRemaining -= dt;
      if (this.countdownRemaining <= 1e-9) {
        this.countdownRemaining = 0;
        this.phase = 'playing';
        return 'started';
      }
      return 'none';
    }
    if (this.phase !== 'playing') return 'none';

    this.immunityRemaining = Math.max(0, this.immunityRemaining - dt);
    this.timeRemaining -= dt;
    if (this.timeRemaining <= 1e-6) this.timeRemaining = 0;

    if (this.hearts <= 0) {
      this.phase = 'gameOver';
      this.commitResult(false);
      return 'gameOver';
    }
    if (this.timeRemaining <= 0) {
      this.phase = 'levelComplete';
      this.commitResult(true);
      return 'levelComplete';
    }
    return 'none';
  }

  private beginAttempt(): void {
    this.phase = 'teleporting';
    this.pausedFrom = null;
    this.levelScore = 0;
    this.levelInventory = emptyInventory();
    this.shots = [];
    this.hearts = this.cfg.level.startingHearts;
    this.timeRemaining = this.cfg.level.durationSec;
    this.countdownRemaining = 0;
    this.immunityRemaining = 0;
    this.resultCommitted = false;
    this.newBest = false;
    this.attempt += 1;
  }

  private commitResult(completed: boolean): void {
    if (this.resultCommitted) return;
    this.resultCommitted = true;
    this.newBest = false;
    if (this.totalScore > this.bests.bestRunScore) {
      this.bests.bestRunScore = this.totalScore;
      this.newBest = true;
    }
    if (completed && this.levelIndex + 1 > this.bests.furthestLevel) {
      this.bests.furthestLevel = this.levelIndex + 1;
    }
  }

  /** Copy of the checkpoint captured at the start of this level. */
  levelStartSnapshot(): Snapshot {
    return { score: this.checkpoint.score, inventory: cloneInventory(this.checkpoint.inventory) };
  }
}
