import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { levelParams } from '../src/core/difficulty';
import { Rng } from '../src/core/rng';
import { RunModel } from '../src/core/run';
import { ENVIRONMENTS } from '../src/render/environments';
import type { EnvironmentLayout } from '../src/render/environments/common';
import { ModelLibrary } from '../src/render/models/characters';
import { IncomingPumpkin, SpiderTarget, type Target } from '../src/sim/targets';
import { World, type WorldEvents } from '../src/sim/world';

const STEP = 1 / 60;
const lib = new ModelLibrary();

const openLayout = (): EnvironmentLayout => ({
  frankLanes: [{ z: -10, xMin: -8, xMax: 8 }],
  witchLanes: [{ y: 8, z: -18, xMin: -15, xMax: 15 }],
  spiderAnchors: [{ x: 0, y: 7.5, z: -12 }],
  candySpots: [{ x: 0, z: -9 }],
  blockers: [],
});

function setup(levelIndex = 0, layout = openLayout(), seed = 7) {
  const log = { hits: [] as Array<{ kind: string; points: number }>, scenery: 0, playerHits: [] as boolean[], prepares: 0, throws: 0 };
  const events: Partial<WorldEvents> = {
    targetHit: (t, _p, points) => log.hits.push({ kind: t.kind, points }),
    sceneryHit: () => log.scenery++,
    playerHit: (d) => log.playerHits.push(d),
    spiderPrepare: () => log.prepares++,
    spiderThrow: () => log.throws++,
  };
  const world = new World(lib, new Rng(seed), events);
  const run = new RunModel();
  run.startNewRun();
  for (let i = 0; i < levelIndex; i++) {
    run.sceneReady();
    run.phase = 'levelComplete';
    run.nextLevel();
  }
  run.sceneReady();
  while (run.phase === 'countdown') run.advance(STEP);
  world.reset(levelParams(run.levelIndex), layout);
  return { world, run, log };
}

const muzzle = () => new THREE.Vector3(...CONFIG.camera.position).add(new THREE.Vector3(...CONFIG.weapon.muzzleOffset));

function stepFor(world: World, run: RunModel, seconds: number, dt = STEP): void {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n && run.phase === 'playing'; i++) {
    world.step(dt, run);
    run.advance(dt);
  }
}

function aimAt(t: Target): THREE.Vector3 {
  return t.shapes[0]!.center.clone();
}

describe('projectiles and hits', () => {
  it('a pumpkin shot travels, hits a Frankenstein once, and awards 10 points + Frankenstein candy', () => {
    const { world, run, log } = setup();
    world.spawningEnabled = false;
    const frank = world.spawn('frankenstein')!;
    stepFor(world, run, 2.0); // let him walk into view
    const p = world.fire(muzzle(), aimAt(frank), run);
    expect(p).not.toBeNull();
    expect(run.levelScore).toBe(0); // no hitscan: nothing scores until the pumpkin arrives
    stepFor(world, run, 0.6);
    expect(log.hits).toEqual([{ kind: 'frankenstein', points: 10 }]);
    expect(run.levelScore).toBe(10);
    expect(run.levelInventory.frankenstein).toBe(1);
    expect(world.projectiles.length).toBe(0);
    stepFor(world, run, 0.5);
    expect(world.targets.length).toBe(0); // pop animation finished and cleaned up
  });

  it('two pumpkins arriving at the same target only score once', () => {
    const { world, run, log } = setup();
    world.spawningEnabled = false;
    world.spawn('sucker');
    stepFor(world, run, 1.2);
    const target = world.targets[0]!;
    world.fire(muzzle(), aimAt(target), run);
    world.fire(muzzle(), aimAt(target), run);
    stepFor(world, run, 0.8);
    expect(log.hits.length).toBe(1);
    expect(run.levelScore).toBe(25);
    expect(run.levelInventory.sucker).toBe(1);
    // The second pumpkin kept flying and eventually hit scenery or expired.
    stepFor(world, run, 2);
    expect(world.projectiles.length).toBe(0);
  });

  it('adds the range bonus by distance from the eye to where the shot lands', () => {
    const { mediumFromM, farFromM, bonus } = CONFIG.range;
    const base = CONFIG.points.medium;
    // A sucker straight ahead at each depth. The shot lands ~0.84 m short of its centre
    // (sucker radius + pumpkin radius), which the last case relies on.
    const cases = [
      { z: -(mediumFromM - 3), points: base + bonus.near },
      { z: -(mediumFromM + farFromM) / 2, points: base + bonus.medium },
      { z: -(farFromM + 3), points: base + bonus.far },
      { z: -(mediumFromM + 0.3), points: base + bonus.near }, // centre past the line, hit short of it
    ];
    for (const { z, points } of cases) {
      const layout = openLayout();
      layout.candySpots = [{ x: 0, z }];
      const { world, run, log } = setup(0, layout);
      world.spawningEnabled = false;
      const sucker = world.spawn('sucker')!;
      stepFor(world, run, 1.2);
      world.fire(muzzle(), aimAt(sucker), run);
      stepFor(world, run, 0.8);
      expect(log.hits, `sucker at z = ${z}`).toEqual([{ kind: 'sucker', points }]);
    }
  });

  it('solid scenery stops the shot before a target behind it', () => {
    const layout = openLayout();
    layout.blockers.push({ min: { x: -3, y: 0, z: -7 }, max: { x: 3, y: 5, z: -6.5 } });
    const { world, run, log } = setup(0, layout);
    world.spawningEnabled = false;
    world.spawn('sucker');
    stepFor(world, run, 1.2);
    world.fire(muzzle(), aimAt(world.targets[0]!), run);
    stepFor(world, run, 0.8);
    expect(log.hits.length).toBe(0);
    expect(log.scenery).toBe(1);
    expect(run.levelScore).toBe(0);
  });

  it('does not tunnel through a small spider at very low frame rates', () => {
    const { world, run, log } = setup();
    world.spawningEnabled = false;
    const spider = world.spawn('spider')!;
    stepFor(world, run, 3);
    expect(spider.alive).toBe(true);
    world.fire(muzzle(), aimAt(spider), run);
    // 5 fps: the pumpkin moves ~9.6 m per step, far more than the spider's size.
    for (let i = 0; i < 5; i++) world.step(0.2, run);
    expect(log.hits).toEqual([{ kind: 'spider', points: 50 }]);
    expect(run.levelInventory.spider).toBe(1);
  });

  it('caps active projectiles', () => {
    const { world, run } = setup();
    world.spawningEnabled = false;
    for (let i = 0; i < 40; i++) world.fire(muzzle(), new THREE.Vector3(0, 30, -80), run);
    expect(world.projectiles.length).toBeLessThanOrEqual(CONFIG.weapon.maxActiveProjectiles);
  });
});

describe('spider attacks', () => {
  function spiderUntil(world: World, run: RunModel, cond: () => boolean, max = 15): void {
    for (let i = 0; i < max / STEP && !cond(); i++) {
      world.step(STEP, run);
      run.advance(STEP);
    }
    expect(cond()).toBe(true);
  }

  it('descends, telegraphs, throws a jack-o-lantern that costs a heart when it arrives', () => {
    const { world, run, log } = setup();
    world.spawningEnabled = false;
    const spider = world.spawn('spider') as SpiderTarget;
    spiderUntil(world, run, () => log.prepares > 0);
    expect(spider.state).toBe('prepare');
    expect(log.throws).toBe(0);
    spiderUntil(world, run, () => log.throws > 0);
    const incoming = world.targets.find((t) => t instanceof IncomingPumpkin) as IncomingPumpkin;
    expect(incoming.flightSec).toBeCloseTo(levelParams(0).incoming.flightSec, 5);
    spiderUntil(world, run, () => log.playerHits.length > 0);
    expect(log.playerHits[0]).toBe(true);
    expect(run.hearts).toBe(2);
  });

  it('shooting a spider while it prepares prevents the throw', () => {
    const { world, run, log } = setup();
    world.spawningEnabled = false;
    const spider = world.spawn('spider') as SpiderTarget;
    spiderUntil(world, run, () => spider.preparing);
    world.fire(muzzle(), aimAt(spider), run);
    stepFor(world, run, 0.5);
    expect(spider.alive).toBe(false);
    stepFor(world, run, 8);
    expect(log.throws).toBe(0);
    expect(run.hearts).toBe(3);
  });

  it('shooting the spider after it throws does not remove the pumpkin already in flight', () => {
    const { world, run, log } = setup();
    world.spawningEnabled = false;
    const spider = world.spawn('spider') as SpiderTarget;
    spiderUntil(world, run, () => log.throws > 0);
    world.fire(muzzle(), aimAt(spider), run);
    stepFor(world, run, 0.4);
    expect(spider.alive).toBe(false);
    stepFor(world, run, 4);
    expect(log.playerHits).toEqual([true]);
    expect(run.hearts).toBe(2);
  });

  it('shooting the incoming pumpkin prevents damage and gives pumpkin candy', () => {
    const { world, run, log } = setup();
    world.spawningEnabled = false;
    world.spawn('spider');
    spiderUntil(world, run, () => log.throws > 0);
    stepFor(world, run, 1.2);
    const incoming = world.targets.find((t) => t instanceof IncomingPumpkin)!;
    world.fire(muzzle(), aimAt(incoming), run);
    stepFor(world, run, 0.3);
    expect(incoming.alive).toBe(false);
    expect(run.levelInventory.pumpkin).toBe(1);
    stepFor(world, run, 3);
    expect(log.playerHits).toEqual([]);
    expect(run.hearts).toBe(3);
  });

  it('level 1 never has more than one spider or incoming pumpkin at a time', () => {
    const env = ENVIRONMENTS[0]!.build();
    const { world, run } = setup(0, env.layout, 99);
    let maxSpiders = 0;
    let maxIncoming = 0;
    while (run.phase === 'playing') {
      world.step(STEP, run);
      run.advance(STEP);
      maxSpiders = Math.max(maxSpiders, world.countAlive('spider'));
      maxIncoming = Math.max(maxIncoming, world.countAlive('incomingPumpkin'));
    }
    expect(maxSpiders).toBe(1);
    expect(maxIncoming).toBeLessThanOrEqual(1);
    env.dispose();
  });
});

describe('bounded collections over long play', () => {
  it('keeps targets, projectiles and scene children bounded across many repeated levels', () => {
    const env = ENVIRONMENTS[4]!.build();
    const { world, run } = setup(0, env.layout, 3);
    const rng = new Rng(5);
    let maxTargets = 0;
    for (let level = 0; level < 12; level++) {
      world.reset(levelParams(15 + level), env.layout);
      run.hearts = 1000; // keep playing
      run.timeRemaining = 60;
      run.phase = 'playing';
      for (let i = 0; i < 60 / STEP; i++) {
        if (i % 20 === 0) world.fire(muzzle(), new THREE.Vector3(rng.range(-8, 8), rng.range(1, 7), -12), run);
        world.step(STEP, run);
        maxTargets = Math.max(maxTargets, world.targets.length);
        expect(world.projectiles.length).toBeLessThanOrEqual(CONFIG.weapon.maxActiveProjectiles);
      }
    }
    expect(maxTargets).toBeLessThanOrEqual(CONFIG.caps.maxTargets + levelParams(20).incoming.max);
    world.clear();
    expect(world.targets.length).toBe(0);
    expect(world.root.children.length).toBe(0);
    env.dispose();
  });
});

describe('environments', () => {
  const eye = new THREE.Vector3(...CONFIG.camera.position);
  const deg = THREE.MathUtils.radToDeg;
  const inAimRange = (p: THREE.Vector3, margin = 1) => {
    const d = p.clone().sub(eye);
    const yaw = deg(Math.atan2(d.x, -d.z));
    const pitch = deg(Math.atan2(d.y, Math.hypot(d.x, d.z)));
    return (
      d.z < -4 &&
      Math.abs(yaw) <= CONFIG.aim.yawLimitDeg + margin &&
      pitch >= CONFIG.aim.pitchMinDeg - margin &&
      pitch <= CONFIG.aim.pitchMaxDeg + margin
    );
  };

  it.each(ENVIRONMENTS.map((e, i) => [e.name, i] as const))('%s keeps every threat and target in front of the player and aimable', (_name, i) => {
    const env = ENVIRONMENTS[i]!.build();
    const L = env.layout;
    expect(L.frankLanes.length).toBeGreaterThan(0);
    expect(L.spiderAnchors.length).toBeGreaterThanOrEqual(3);
    for (const lane of L.frankLanes) {
      for (const x of [lane.xMin, lane.xMax]) expect(inAimRange(new THREE.Vector3(x, 1.45, lane.z))).toBe(true);
    }
    for (const lane of L.witchLanes) {
      for (const x of [lane.xMin, lane.xMax]) expect(inAimRange(new THREE.Vector3(x, lane.y, lane.z))).toBe(true);
    }
    for (const a of L.spiderAnchors) {
      const min = a.minHang ?? CONFIG.targets.spider.minHangHeight;
      expect(a.y - 1.2).toBeGreaterThanOrEqual(min - 1e-6);
      expect(inAimRange(new THREE.Vector3(a.x, min, a.z))).toBe(true);
      expect(inAimRange(new THREE.Vector3(a.x, a.y, a.z))).toBe(true);
    }
    for (const s of L.candySpots) expect(inAimRange(new THREE.Vector3(s.x, 2, s.z))).toBe(true);
    // Spider anchors must be visible: no solid blocker between the eye and the hanging spider.
    const world = new World(lib, new Rng(1));
    world.reset(levelParams(0), L);
    for (const a of L.spiderAnchors) {
      const hang = new THREE.Vector3(a.x, a.minHang ?? CONFIG.targets.spider.minHangHeight, a.z);
      const aim = world.aimPoint(eye, hang.clone().sub(eye).normalize(), new THREE.Vector3());
      expect(aim.distanceTo(eye)).toBeGreaterThan(hang.distanceTo(eye) - 0.8);
    }
    env.dispose();
  });

  // A depth-writing vertex straight above/below the eye has clip-space w = 0 when pitch is 0
  // (the aim every level starts with); SwiftShader then smeared the ground over the view.
  it.each(ENVIRONMENTS.map((e, i) => [e.name, i] as const))('%s has no solid vertex on the camera vertical axis', (_name, i) => {
    const env = ENVIRONMENTS[i]!.build();
    env.group.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    let onAxis = 0;
    env.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const pos = mesh.isMesh ? mesh.geometry.getAttribute('position') : undefined;
      if (!pos || (mesh.material as THREE.Material).depthWrite === false) return;
      for (let k = 0; k < pos.count; k++) {
        v.fromBufferAttribute(pos, k).applyMatrix4(mesh.matrixWorld);
        if (Math.abs(v.x - eye.x) < 1e-3 && Math.abs(v.z - eye.z) < 1e-3) onAxis++;
      }
    });
    expect(onAxis).toBe(0);
    env.dispose();
  });

  it('disposes every GPU resource it created', () => {
    const env = ENVIRONMENTS[2]!.build();
    let disposed = 0;
    env.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.addEventListener('dispose', () => disposed++);
    });
    env.dispose();
    expect(disposed).toBeGreaterThan(0);
    expect(env.group.parent).toBeNull();
  });
});
