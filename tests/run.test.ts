import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { RunModel, pointsFor, rangeZone } from '../src/core/run';

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
    expect(pointsFor('frankenstein', 'large')).toBe(10);
    expect(pointsFor('sucker', 'medium')).toBe(25);
    expect(pointsFor('spider', 'small')).toBe(50);
    expect(pointsFor('spider', 'medium')).toBe(25); // big spider
  });

  it('gives witches and candy corn their own base points', () => {
    expect(pointsFor('witch', 'medium')).toBe(75);
    expect(pointsFor('candyCorn', 'small')).toBe(100);
  });

  it('adds a per-hit range bonus: near +0, medium +5, far +10', () => {
    expect(rangeZone(0)).toBe('near');
    expect(rangeZone(11.9)).toBe('near');
    expect(rangeZone(12)).toBe('medium');
    expect(rangeZone(17.9)).toBe('medium');
    expect(rangeZone(18)).toBe('far');
    expect(pointsFor('frankenstein', 'large', 'medium')).toBe(15);
    expect(pointsFor('frankenstein', 'large', 'far')).toBe(20);
    expect(pointsFor('witch', 'medium', 'far')).toBe(85);
    expect(pointsFor('candyCorn', 'small', 'medium')).toBe(105);
  });

  it('doubles a Frankenstein or witch headshot, range bonus included', () => {
    expect(pointsFor('frankenstein', 'large', 'near', true)).toBe(20);
    expect(pointsFor('frankenstein', 'large', 'far', true)).toBe(40);
    expect(pointsFor('witch', 'medium', 'near', true)).toBe(150);
    expect(pointsFor('witch', 'medium', 'medium', true)).toBe(160);
    // Types without a head zone never get the bonus.
    expect(pointsFor('sucker', 'medium', 'near', true)).toBe(25);
  });

  it('records the doubled points on the shot that scored a headshot', () => {
    const run = new RunModel();
    run.startNewRun();
    run.sceneReady();
    run.advance(CONFIG.level.countdownSec);
    const shot = run.fireShot(0, 0);
    expect(run.awardHit('witch', 'medium', 'near', shot, true)).toBe(150);
    expect(shot).toMatchObject({ target: 'witch', zone: 'near', points: 150, headshot: true });
    expect(run.levelScore).toBe(150);
    const body = run.fireShot(0, 0);
    run.awardHit('frankenstein', 'large', 'near', body);
    expect(body).toMatchObject({ target: 'frankenstein', points: 10, headshot: false });
  });

  it('uses explicit size classes per target type', () => {
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
    expect(run.totalScore).toBe(135);
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
    expect(run.totalScore).toBe(125);
    expect(run.bests.bestRunScore).toBe(125);
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

describe('shot log and accuracy', () => {
  it('records every shot while playing, with its time and aim, and marks the one that hit', () => {
    const run = new RunModel();
    expect(run.fireShot(0, 0)).toBeNull(); // title
    startPlaying(run);
    playFor(run, 1.5);
    const miss = run.fireShot(0.25, -0.1)!;
    const hit = run.fireShot(0.3, 0.05)!;
    const pts = pointsFor('witch', 'medium', 'far');
    expect(run.awardHit('witch', 'medium', 'far', hit)).toBe(pts);
    expect(miss).toEqual({ ms: 1500, yaw: 0.25, pitch: -0.1, target: null, zone: null, points: 0, headshot: false });
    expect(hit).toMatchObject({ ms: 1500, target: 'witch', zone: 'far', points: pts });
    expect(run.shots).toEqual([miss, hit]);
    expect(run.levelHits).toBe(1);
    // A shot only ever counts as one hit.
    run.awardHit('spider', 'small', 'near', hit);
    expect(hit.target).toBe('witch');
    expect([run.runShots, run.runHits]).toEqual([2, 1]);
  });

  it('starts each level attempt with an empty log; run accuracy keeps every attempt, replays included', () => {
    const run = new RunModel();
    startPlaying(run);
    run.awardHit('frankenstein', 'large', 'near', run.fireShot(0, 0));
    run.fireShot(0, 0);
    completeLevel(run);
    expect(run.fireShot(0, 0)).toBeNull(); // level over
    expect(run.replayLevel()).toBe(true);
    expect(run.shots).toEqual([]);
    run.sceneReady();
    finishCountdown(run);
    run.fireShot(0, 0);
    expect([run.shots.length, run.levelHits, run.runShots, run.runHits]).toEqual([1, 0, 3, 1]);
    run.pause();
    expect(run.startNewRun()).toBe(true);
    expect([run.shots.length, run.runShots, run.runHits]).toEqual([0, 0, 0]);
  });
});
