import * as THREE from 'three';
import { CONFIG } from '../config';
import { segmentAabb, segmentGround, segmentSphere } from '../core/collision';
import type { LevelParams } from '../core/difficulty';
import type { Rng } from '../core/rng';
import { rangeZone, type RunModel } from '../core/run';
import type { EnvironmentLayout } from '../render/environments/common';
import { materials } from '../render/materials';
import type { ModelLibrary } from '../render/models/characters';
import type { ShotRecord, TargetKind } from '../types';
import {
  CandyCornTarget,
  FrankTarget,
  IncomingPumpkin,
  SpiderTarget,
  SuckerTarget,
  WitchTarget,
  makeCandyMesh,
  type Target,
  type TargetContext,
} from './targets';

export interface WorldEvents {
  targetHit(target: Target, point: THREE.Vector3, points: number): void;
  sceneryHit(point: THREE.Vector3): void;
  /** An incoming pumpkin reached the player; `damaged` is false during immunity. */
  playerHit(damaged: boolean): void;
  spiderPrepare(spider: SpiderTarget): void;
  spiderThrow(from: THREE.Vector3): void;
  targetSpawned(target: Target): void;
}

export interface Projectile {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  traveled: number;
  mesh: THREE.Mesh;
  spin: THREE.Vector3;
  /** The run's record of this shot, marked as a hit when it lands on a target. */
  shot: ShotRecord | null;
}

export type SpawnKind = 'frankenstein' | 'witch' | 'spider' | 'candyCorn' | 'sucker';
const SPAWN_KINDS: readonly SpawnKind[] = ['frankenstein', 'witch', 'spider', 'candyCorn', 'sucker'];

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

/**
 * Gameplay simulation: spawning, target behaviour, player projectiles and collisions.
 * Scoring and damage go through RunModel so the rules stay in one place.
 */
export class World {
  readonly root = new THREE.Group();
  readonly targets: Target[] = [];
  readonly projectiles: Projectile[] = [];
  readonly eye = new THREE.Vector3(...CONFIG.camera.position);
  time = 0;
  spawningEnabled = true;
  private params: LevelParams | null = null;
  private layout: EnvironmentLayout | null = null;
  private spawnTimers: Record<SpawnKind, number> = { frankenstein: 0, witch: 0, spider: 0, candyCorn: 0, sucker: 0 };
  private nextId = 1;
  private projectilePool: THREE.Mesh[] = [];
  private readonly ctx: TargetContext;
  private run: RunModel | null = null;

  constructor(
    private readonly lib: ModelLibrary,
    public rng: Rng,
    private readonly events: Partial<WorldEvents> = {},
  ) {
    this.root.name = 'world';
    const world = this;
    this.ctx = {
      get rng() {
        return world.rng;
      },
      get params() {
        return world.params!;
      },
      eye: this.eye,
      get time() {
        return world.time;
      },
      incomingCount: () => this.countAlive('incomingPumpkin'),
      throwPumpkin: (from) => this.throwPumpkin(from),
      onSpiderPrepare: (s) => this.events.spiderPrepare?.(s),
    };
  }

  /** Prepare for a fresh level attempt. */
  reset(params: LevelParams, layout: EnvironmentLayout): void {
    this.clear();
    this.params = params;
    this.layout = layout;
    this.time = 0;
    const first = CONFIG.difficulty.firstSpawnSec;
    this.spawnTimers = { ...first };
  }

  clear(): void {
    for (const t of this.targets) t.dispose();
    this.targets.length = 0;
    for (const p of this.projectiles) this.releaseProjectile(p);
    this.projectiles.length = 0;
  }

  get levelParams(): LevelParams | null {
    return this.params;
  }

  countAlive(kind: TargetKind): number {
    let n = 0;
    for (const t of this.targets) if (t.kind === kind && t.alive) n++;
    return n;
  }

  // ------------------------------------------------------------------ spawning
  spawn(kind: SpawnKind): Target | null {
    const params = this.params;
    const layout = this.layout;
    if (!params || !layout) return null;
    const rng = this.rng;
    const id = this.nextId++;
    let target: Target | null = null;
    switch (kind) {
      case 'frankenstein': {
        const lanes = layout.frankLanes.filter((lane) => !this.targets.some((t) => t.kind === 'frankenstein' && t.alive && Math.abs(t.position.z - lane.z) < 0.5));
        const lane = lanes.length ? rng.pick(lanes) : rng.pick(layout.frankLanes);
        target = new FrankTarget(id, this.lib.frankenstein(), lane, rng, params);
        break;
      }
      case 'witch':
        target = new WitchTarget(id, this.lib.witch(), rng.pick(layout.witchLanes), rng, params);
        break;
      case 'spider': {
        const busy = new Set(this.targets.filter((t): t is SpiderTarget => t instanceof SpiderTarget).map((s) => s.anchor));
        const free = layout.spiderAnchors.filter((a) => !busy.has(a));
        if (!free.length) return null;
        target = new SpiderTarget(id, this.lib.spider(), rng.pick(free), rng, params, this.root);
        break;
      }
      case 'candyCorn':
        target = new CandyCornTarget(id, makeCandyMesh(this.lib, 'candyCorn'), rng.pick(layout.candySpots), rng);
        break;
      case 'sucker':
        target = new SuckerTarget(id, makeCandyMesh(this.lib, 'sucker'), rng.pick(layout.candySpots), rng);
        break;
    }
    if (!target) return null;
    this.root.add(target.root);
    this.targets.push(target);
    this.events.targetSpawned?.(target);
    return target;
  }

  private throwPumpkin(from: THREE.Vector3): boolean {
    const params = this.params;
    if (!params || this.countAlive('incomingPumpkin') >= params.incoming.max) return false;
    const p = new IncomingPumpkin(this.nextId++, this.lib.jackOLantern(), from, this.eye, this.rng, params.incoming.flightSec);
    this.root.add(p.root);
    this.targets.push(p);
    this.events.spiderThrow?.(from);
    return true;
  }

  private maxFor(kind: SpawnKind, p: LevelParams): { max: number; interval: number } {
    switch (kind) {
      case 'frankenstein':
        return p.frank;
      case 'witch':
        return p.witch;
      case 'spider':
        return p.spider;
      case 'candyCorn':
        return p.candyCorn;
      case 'sucker':
        return p.sucker;
    }
  }

  private updateSpawning(dt: number): void {
    const p = this.params;
    if (!p || !this.spawningEnabled) return;
    for (const kind of SPAWN_KINDS) {
      this.spawnTimers[kind] -= dt;
      if (this.spawnTimers[kind] > 0) continue;
      const { max, interval } = this.maxFor(kind, p);
      const active = this.targets.filter((t) => t.kind === kind && !t.removed).length;
      if (active < max && this.targets.length < CONFIG.caps.maxTargets && this.spawn(kind)) {
        this.spawnTimers[kind] = interval * this.rng.range(0.75, 1.25);
      } else {
        this.spawnTimers[kind] = 0.5;
      }
    }
  }

  // ------------------------------------------------------------------ shooting
  /**
   * Launch a pumpkin from the muzzle toward the crosshair aim point. A target sitting
   * between the eye and the muzzle (point blank) is hit immediately.
   */
  fire(muzzle: THREE.Vector3, aimPoint: THREE.Vector3, run: RunModel, shot: ShotRecord | null = null): Projectile | null {
    this.run = run;
    if (this.projectiles.length >= CONFIG.weapon.maxActiveProjectiles) {
      const oldest = this.projectiles.shift();
      if (oldest) this.releaseProjectile(oldest);
    }
    const dir = tmpA.subVectors(aimPoint, muzzle);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    const mesh = this.projectilePool.pop() ?? this.makeProjectileMesh();
    mesh.visible = true;
    mesh.position.copy(muzzle);
    mesh.scale.setScalar(0.2);
    this.root.add(mesh);
    const proj: Projectile = {
      pos: muzzle.clone(),
      vel: dir.clone().multiplyScalar(CONFIG.weapon.projectileSpeed),
      traveled: 0,
      mesh,
      spin: new THREE.Vector3(this.rng.range(8, 14), this.rng.range(-4, 4), 0),
      shot,
    };
    // Point-blank: the launcher barrel occupies eye→muzzle, so test that segment first.
    const hit = this.firstTargetHit(this.eye, muzzle, CONFIG.weapon.projectileRadius);
    if (hit) {
      this.registerHit(hit.target, muzzle.clone(), shot);
      this.releaseProjectile(proj);
      return null;
    }
    this.projectiles.push(proj);
    return proj;
  }

  /** First thing the crosshair ray touches (targets, scenery, ground), for aiming. */
  aimPoint(origin: THREE.Vector3, dir: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const far = tmpB.copy(origin).addScaledVector(dir, CONFIG.weapon.aimDistance);
    let best = 1;
    for (const t of this.targets) {
      if (!t.alive) continue;
      for (const s of t.shapes) {
        const h = segmentSphere(origin, far, s.center, s.radius);
        if (h !== null && h < best) best = h;
      }
    }
    const sceneryHit = this.firstSceneryHit(origin, far);
    if (sceneryHit !== null && sceneryHit < best) best = sceneryHit;
    return out.copy(origin).lerp(far, Math.max(best, 0.02));
  }

  private firstTargetHit(p0: THREE.Vector3, p1: THREE.Vector3, radius: number): { t: number; target: Target } | null {
    let best: { t: number; target: Target } | null = null;
    for (const target of this.targets) {
      if (!target.alive) continue;
      for (const s of target.shapes) {
        const h = segmentSphere(p0, p1, s.center, s.radius + radius);
        if (h !== null && (!best || h < best.t)) best = { t: h, target };
      }
    }
    return best;
  }

  private firstSceneryHit(p0: THREE.Vector3, p1: THREE.Vector3): number | null {
    let best: number | null = segmentGround(p0, p1, 0);
    for (const b of this.layout?.blockers ?? []) {
      const h = segmentAabb(p0, p1, b);
      if (h !== null && (best === null || h < best)) best = h;
    }
    return best;
  }

  private registerHit(target: Target, point: THREE.Vector3, shot: ShotRecord | null): void {
    target.hit();
    const zone = rangeZone(point.distanceTo(this.eye));
    const points = this.run ? this.run.awardHit(target.kind, target.size, zone, shot) : 0;
    this.events.targetHit?.(target, point, points);
  }

  // ------------------------------------------------------------------ simulation
  /** Advance one simulation step. Call only while the run is in the playing phase. */
  step(dt: number, run: RunModel): void {
    this.run = run;
    this.time += dt;
    this.updateSpawning(dt);

    // 1. Behaviours (spiders may throw new pumpkins, which start moving next step).
    const count = this.targets.length;
    for (let i = 0; i < count; i++) {
      const t = this.targets[i]!;
      if (t.alive) t.update(dt, this.ctx);
    }

    // 2. Projectiles sweep their whole path this step and stop at the first contact.
    const r = CONFIG.weapon.projectileRadius;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      const p1 = tmpA.copy(p.pos).addScaledVector(p.vel, dt);
      const targetHit = this.firstTargetHit(p.pos, p1, r);
      const sceneryT = this.firstSceneryHit(p.pos, p1);
      if (targetHit && (sceneryT === null || targetHit.t <= sceneryT)) {
        const point = p.pos.clone().lerp(p1, targetHit.t);
        this.registerHit(targetHit.target, point, p.shot);
        this.removeProjectile(i);
        continue;
      }
      if (sceneryT !== null) {
        const point = p.pos.clone().lerp(p1, sceneryT);
        this.events.sceneryHit?.(point);
        this.removeProjectile(i);
        continue;
      }
      p.traveled += p.vel.length() * dt;
      p.pos.copy(p1);
      p.mesh.position.copy(p1);
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      if (p.traveled > CONFIG.weapon.projectileMaxRange) this.removeProjectile(i);
    }

    // 3. Pumpkins that survived the volley reach the player.
    for (const t of this.targets) {
      if (t instanceof IncomingPumpkin && t.alive && t.arrived) {
        t.alive = false;
        t.removed = true;
        const damaged = run.applyDamage();
        this.events.playerHit?.(damaged);
      }
    }

    this.sweep(dt);
  }

  /** Advance hit/pop animations and drop finished targets. Safe to call when not playing. */
  sweep(dt: number): void {
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const t = this.targets[i]!;
      let done = t.removed;
      if (!t.alive && t.isDying) done = t.updateDying(dt);
      if (done) {
        t.dispose();
        this.targets.splice(i, 1);
      }
    }
  }

  private removeProjectile(i: number): void {
    const [p] = this.projectiles.splice(i, 1);
    if (p) this.releaseProjectile(p);
  }

  private releaseProjectile(p: Projectile): void {
    p.mesh.visible = false;
    p.mesh.removeFromParent();
    if (this.projectilePool.length < CONFIG.weapon.maxActiveProjectiles) this.projectilePool.push(p.mesh);
  }

  private makeProjectileMesh(): THREE.Mesh {
    const mesh = this.lib.projectile();
    const trail = new THREE.Sprite(materials().halo);
    trail.scale.setScalar(2.6);
    mesh.add(trail);
    return mesh;
  }
}
