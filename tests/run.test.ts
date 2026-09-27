import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { RunModel, pointsFor } from '../src/core/run';

const STEP = 1 / 60;

/** Title → teleport → countdown → playing. */
function startPlaying(run: RunModel): void {
  expect(run.startNewRun()).toBe(true);
  expect(run.sceneReady()).toBe(true);
  for (let i = 0; i < 400 && run.phase === 'countdown'; i++) run.advance(STEP);
  expect(run.phase).toBe('playing');
}

function finishCountdown(run: RunModel): void {
  for (let i = 0; i < 400 && run.phase === 'countdown'; i++) run.advance(STEP);
  expect(run.phase).toBe('playing');
}

function playFor(run: RunModel, seconds: number): void {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps && run.phase === 'playing'; i++) run.advance(STEP);
}

function completeLevel(run: RunModel, hits: Array<Parameters<RunModel['awardHit']>> = []): void {
  for (const h of hits) run.awardHit(...h);
  playFor(run, CONFIG.level.durationSec + 1);
  expect(run.phase).toBe('levelComplete');
}

describe('scoring', () => {
  it('awards more points to smaller size classes', () => {
    expect(pointsFor('large')).toBe(10);
    expect(pointsFor('medium')).toBe(25);
    expect(pointsFor('small')).toBe(50);
  });

  it('uses explicit size classes per target type (not distance)', () => {
    expect(CONFIG.defaultSize.frankenstein).toBe('large');
    expect(CONFIG.defaultSize.witch).toBe('medium');
    expect(CONFIG.defaultSize.spider).toBe('small');
    expect(CONFIG.defaultSize.candyCorn).toBe('small');
  });

  it('credits one point award and one candy per hit, only while playing', () => {
    const run = new RunModel();
    expect(run.awardHit('spider', 'small')).toBe(0); // title
    startPlaying(run);
    expect(run.awardHit('spider', 'small')).toBe(50);
    expect(run.awardHit('incomingPumpkin', 'medium')).toBe(25);
    expect(run.levelScore).toBe(75);
    expect(run.levelInventory.spider).toBe(1);
    expect(run.levelInventory.pumpkin).toBe(1);
    run.pause();
    expect(run.awardHit('witch', 'medium')).toBe(0);
    expect(run.levelScore).toBe(75);
  });
});

describe('countdown and level timer', () => {
  it('counts down before play and then runs exactly 60 seconds of play', () => {
    const run = new RunModel();
    run.startNewRun();
    expect(run.phase).toBe('teleporting');
    run.advance(10); // no time passes while teleporting
    expect(run.timeRemaining).toBe(60);
    run.sceneReady();
    expect(run.phase).toBe('countdown');
    let steps = 0;
    while (run.phase === 'countdown') {
      run.advance(STEP);
      steps++;
    }
    expect(steps).toBe(Math.round(CONFIG.level.countdownSec / STEP));
    expect(run.timeRemaining).toBe(60);
    let playSteps = 0;
    while (run.phase === 'playing') {
      run.advance(STEP);
      playSteps++;
    }
    expect(run.phase).toBe('levelComplete');
    expect(playSteps).toBe(3600);
  });

  it('does not consume time while paused and resumes into the same phase', () => {
    const run = new RunModel();
    startPlaying(run);
    playFor(run, 10);
    const left = run.timeRemaining;
    expect(run.pause()).toBe(true);
    for (let i = 0; i < 600; i++) run.advance(STEP);
    expect(run.timeRemaining).toBeCloseTo(left, 9);
    expect(run.resume()).toBe(true);
    expect(run.phase).toBe('playing');

    const r2 = new RunModel();
    r2.startNewRun();
    r2.sceneReady();
    r2.advance(1);
    r2.pause();
    r2.advance(5);
    expect(r2.countdownRemaining).toBeCloseTo(2, 9);
    r2.resume();
    expect(r2.phase).toBe('countdown');
  });
});

describe('hearts and damage', () => {
  it('removes a heart and grants brief immunity against overlapping impacts', () => {
    const run = new RunModel();
    startPlaying(run);
    expect(run.applyDamage()).toBe(true);
    expect(run.hearts).toBe(2);
    expect(run.applyDamage()).toBe(false); // same instant
    playFor(run, CONFIG.level.damageImmunitySec - 0.1);
    expect(run.applyDamage()).toBe(false);
    playFor(run, 0.2);
    expect(run.applyDamage()).toBe(true);
    expect(run.hearts).toBe(1);
  });

  it('ends the run when the last heart is lost', () => {
    const run = new RunModel();
    startPlaying(run);
    for (let i = 0; i < 3; i++) {
      run.applyDamage();
      playFor(run, CONFIG.level.damageImmunitySec + 0.05);
    }
    expect(run.hearts).toBe(0);
    expect(run.phase).toBe('gameOver');
  });

  it('gives the final heart priority when it coincides with the timer running out', () => {
    const run = new RunModel();
    startPlaying(run);
    run.hearts = 1;
    // Burn time to the final step.
    while (run.timeRemaining > STEP * 1.5) run.advance(STEP);
    expect(run.phase).toBe('playing');
    run.awardHit('spider', 'small');
    expect(run.applyDamage()).toBe(true); // lands in the same update that time expires
    expect(run.advance(STEP)).toBe('gameOver');
    expect(run.phase).toBe('gameOver');
  });

  it('does not accept damage outside of play', () => {
    const run = new RunModel();
    expect(run.applyDamage()).toBe(false);
    run.startNewRun();
    run.sceneReady();
    expect(run.applyDamage()).toBe(false); // countdown
  });
});

describe('checkpoints: replay, next level, new run', () => {
  it('replay restores the level-start snapshot without stacking points or candy', () => {
    const run = new RunModel();
    startPlaying(run);
    completeLevel(run, [
      ['frankenstein', 'large'],
      ['spider', 'small'],
    ]);
    expect(run.totalScore).toBe(60);
    expect(run.nextLevel()).toBe(true);
    expect(run.levelIndex).toBe(1);
    expect(run.checkpoint.score).toBe(60);
    run.sceneReady();
    finishCountdown(run);
    completeLevel(run, [['witch', 'medium']]);
    expect(run.totalScore).toBe(85);
    expect(run.totalInventory.witch).toBe(1);

    // Replay level 2 three times with different results.
    for (const hits of [[['candyCorn', 'small']], [], [['sucker', 'medium'], ['sucker', 'medium']]] as const) {
      expect(run.replayLevel()).toBe(true);
      expect(run.levelIndex).toBe(1);
      expect(run.totalScore).toBe(60);
      expect(run.totalInventory.witch).toBe(0);
      expect(run.totalInventory.frankenstein).toBe(1);
      expect(run.hearts).toBe(3);
      expect(run.timeRemaining).toBe(60);
      run.sceneReady();
      finishCountdown(run);
      completeLevel(run, hits.map((h) => [...h]) as Array<Parameters<RunModel['awardHit']>>);
    }
    expect(run.totalScore).toBe(60 + 50);
    expect(run.totalInventory.sucker).toBe(2);
    expect(run.totalInventory.candyCorn).toBe(0);
  });

  it('next level keeps the completed score and bag, restores hearts, and advances the environment', () => {
    const run = new RunModel();
    startPlaying(run);
    run.applyDamage();
    completeLevel(run, [['spider', 'small']]);
    run.nextLevel();
    expect(run.hearts).toBe(3);
    expect(run.totalScore).toBe(50);
    expect(run.totalInventory.spider).toBe(1);
    expect(run.levelScore).toBe(0);
  });

  it('game over reports the run total including the partial failed level', () => {
    const run = new RunModel();
    startPlaying(run);
    completeLevel(run, [['witch', 'medium']]);
    run.nextLevel();
    run.sceneReady();
    finishCountdown(run);
    run.awardHit('spider', 'small');
    for (let i = 0; i < 3; i++) {
      run.applyDamage();
      playFor(run, CONFIG.level.damageImmunitySec + 0.05);
    }
    expect(run.phase).toBe('gameOver');
    expect(run.totalScore).toBe(75);
    expect(run.bests.bestRunScore).toBe(75);
  });

  it('a new run clears score and candy but keeps personal bests', () => {
    const run = new RunModel({ bestRunScore: 500, furthestLevel: 4 });
    startPlaying(run);
    completeLevel(run, [['spider', 'small']]);
    run.nextLevel();
    run.sceneReady();
    finishCountdown(run);
    run.hearts = 1;
    run.applyDamage();
    run.advance(STEP);
    expect(run.phase).toBe('gameOver');
    expect(run.startNewRun()).toBe(true);
    expect(run.levelIndex).toBe(0);
    expect(run.totalScore).toBe(0);
    expect(run.totalInventory.spider).toBe(0);
    expect(run.bests).toEqual({ bestRunScore: 500, furthestLevel: 4 });
  });

  it('personal best is never inflated by replaying a level', () => {
    const run = new RunModel();
    startPlaying(run);
    completeLevel(run, [['spider', 'small'], ['spider', 'small']]);
    expect(run.bests.bestRunScore).toBe(100);
    expect(run.bests.furthestLevel).toBe(1);
    for (let i = 0; i < 4; i++) {
      run.replayLevel();
      run.sceneReady();
      finishCountdown(run);
      completeLevel(run, [['spider', 'small']]);
      expect(run.bests.bestRunScore).toBe(100);
    }
  });

  it('only allows transitions from valid phases', () => {
    const run = new RunModel();
    expect(run.nextLevel()).toBe(false);
    expect(run.replayLevel()).toBe(false);
    expect(run.resume()).toBe(false);
    startPlaying(run);
    expect(run.startNewRun()).toBe(false);
    expect(run.nextLevel()).toBe(false);
  });
});
