import * as THREE from 'three';
import { CONFIG } from '../config';
import type { LevelParams } from '../core/difficulty';
import type { Rng } from '../core/rng';
import type { FrankLane, SpiderAnchor, WitchLane } from '../render/environments/common';
import { materials } from '../render/materials';
import type {
  FrankInstance,
  JackInstance,
  ModelLibrary,
  SpiderInstance,
  WitchInstance,
} from '../render/models/characters';
import type { SizeClass, TargetKind } from '../types';

export interface HitShape {
  center: THREE.Vector3;
  radius: number;
}

/** What target behaviours may read or request from the world each step. */
export interface TargetContext {
  rng: Rng;
  params: LevelParams;
  eye: THREE.Vector3;
  time: number;
  incomingCount(): number;
  throwPumpkin(from: THREE.Vector3): boolean;
  onSpiderPrepare(spider: SpiderTarget): void;
}

const POP_SEC = 0.28;

export abstract class Target {
  abstract readonly kind: TargetKind;
  /** Hittable. Cleared the instant a hit is registered so it can never score twice. */
  alive = true;
  /** Remove from the world at the end of this step (escaped, landed, or pop finished). */
  removed = false;
  age = 0;
  private dying = -1;
  private flashed: Array<[THREE.Mesh, THREE.Material | THREE.Material[]]> = [];
  readonly shapes: HitShape[] = [];
  /** Headshot zone, for types that score a headshot bonus. Not part of the hit test. */
  readonly head: HitShape | null = null;

  constructor(
    readonly id: number,
    public size: SizeClass,
    readonly root: THREE.Object3D,
  ) {}

  abstract update(dt: number, ctx: TargetContext): void;

  /** Called once when a projectile registers a hit: start the pop/flash animation. */
  hit(): void {
    this.alive = false;
    this.dying = 0;
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material !== materials().shadow) {
        this.flashed.push([m, m.material]);
        m.material = materials().hitFlash;
      }
    });
  }

  /** Advance the pop animation; returns true when finished. */
  updateDying(dt: number): boolean {
    if (this.dying < 0) return true;
    this.dying += dt;
    const t = this.dying / POP_SEC;
    if (t > 0.35 && this.flashed.length) {
      for (const [m, mat] of this.flashed) m.material = mat;
      this.flashed = [];
    }
    const s = t < 0.3 ? 1 + t * 0.8 : Math.max(0, 1.24 * (1 - (t - 0.3) / 0.7));
    this.root.scale.setScalar(this.baseScale * s);
    return t >= 1;
  }

  get isDying(): boolean {
    return this.dying >= 0;
  }

  protected baseScale = 1;

  /** Representative world position (for effects and candy flight). */
  get position(): THREE.Vector3 {
    return this.shapes[0]?.center ?? this.root.position;
  }

  dispose(): void {
    for (const [m, mat] of this.flashed) m.material = mat;
    this.flashed = [];
    this.root.removeFromParent();
  }
}

// -------------------------------------------------------------------- Frankenstein
export class FrankTarget extends Target {
  readonly kind = 'frankenstein' as const;
  override readonly head: HitShape = { center: new THREE.Vector3(), radius: CONFIG.targets.frankenstein.head.r };
  private x: number;
  private dir: 1 | -1;
  private turnAt: number | null;
  private phase: number;
  private readonly speed: number;
  private entered = false;

  constructor(
    id: number,
    private readonly model: FrankInstance,
    private readonly lane: FrankLane,
    rng: Rng,
    params: LevelParams,
  ) {
    super(id, CONFIG.defaultSize.frankenstein, model.root);
    this.dir = rng.sign();
    const m = CONFIG.targets.frankenstein.spawnMargin;
    this.x = this.dir > 0 ? lane.xMin - m : lane.xMax + m;
    this.turnAt = rng.chance(0.35) ? rng.range(lane.xMin * 0.4, lane.xMax * 0.4) : null;
    this.speed = params.frank.speed * rng.range(0.85, 1.15);
    this.phase = rng.range(0, Math.PI * 2);
    for (const s of CONFIG.targets.frankenstein.hitSpheres) this.shapes.push({ center: new THREE.Vector3(), radius: s.r });
    this.place(0);
  }

  update(dt: number): void {
    this.age += dt;
    this.x += this.dir * this.speed * dt;
    if (this.turnAt !== null && (this.dir > 0 ? this.x >= this.turnAt : this.x <= this.turnAt)) {
      this.dir = this.dir > 0 ? -1 : 1;
      this.turnAt = null;
    }
    const inside = this.x >= this.lane.xMin && this.x <= this.lane.xMax;
    if (inside) this.entered = true;
    const m = CONFIG.targets.frankenstein.spawnMargin + 0.3;
    if (this.entered && (this.x < this.lane.xMin - m || this.x > this.lane.xMax + m)) this.removed = true;
    this.place(dt);
  }

  private place(dt: number): void {
    this.phase += dt * this.speed * 3.2;
    const swing = Math.sin(this.phase);
    const bob = Math.abs(Math.cos(this.phase)) * 0.08;
    const mdl = this.model;
    mdl.root.position.set(this.x, 0, this.lane.z);
    // Face the walking direction but stay three-quarters toward the player.
    const targetYaw = this.dir * 0.95;
    mdl.root.rotation.y += (targetYaw - mdl.root.rotation.y) * Math.min(1, dt * 6 || 1);
    mdl.body.position.y = bob;
    mdl.body.rotation.z = swing * 0.05;
    mdl.legL.rotation.x = swing * 0.5;
    mdl.legR.rotation.x = -swing * 0.5;
    mdl.armL.rotation.x = -0.1 + Math.sin(this.phase * 0.5) * 0.1;
    mdl.armR.rotation.x = -0.1 - Math.sin(this.phase * 0.5) * 0.1;
    mdl.head.rotation.z = Math.sin(this.phase * 0.5) * 0.08;
    // Pop in over the first moments.
    const grow = Math.min(1, this.age / 0.35);
    this.baseScale = 1;
    mdl.root.scale.setScalar(0.2 + 0.8 * grow);
    const spheres = CONFIG.targets.frankenstein.hitSpheres;
    spheres.forEach((s, i) => this.shapes[i]!.center.set(this.x, s.y + bob, this.lane.z));
    this.head.center.set(this.x, CONFIG.targets.frankenstein.head.y + bob, this.lane.z);
  }
}

// -------------------------------------------------------------------- Witch
export class WitchTarget extends Target {
  readonly kind = 'witch' as const;
  override readonly head: HitShape = { center: new THREE.Vector3(), radius: CONFIG.targets.witch.head.r };
  private x: number;
  private readonly dir: 1 | -1;
  private readonly speed: number;
  private readonly phase: number;

  constructor(
    id: number,
    private readonly model: WitchInstance,
    private readonly lane: WitchLane,
    rng: Rng,
    params: LevelParams,
  ) {
    super(id, CONFIG.defaultSize.witch, model.root);
    this.dir = rng.sign();
    const m = CONFIG.targets.witch.spawnMargin;
    this.x = this.dir > 0 ? lane.xMin - m : lane.xMax + m;
    this.speed = params.witch.speed * rng.range(0.85, 1.15);
    this.phase = rng.range(0, Math.PI * 2);
    this.shapes.push({ center: new THREE.Vector3(), radius: CONFIG.targets.witch.hitRadius });
    model.root.rotation.y = this.dir > 0 ? Math.PI / 2 - 0.4 : -Math.PI / 2 + 0.4;
    this.place();
  }

  update(dt: number): void {
    this.age += dt;
    this.x += this.dir * this.speed * dt;
    const m = CONFIG.targets.witch.spawnMargin + 0.5;
    if (this.x < this.lane.xMin - m || this.x > this.lane.xMax + m) this.removed = true;
    this.place();
  }

  private place(): void {
    const t = this.age;
    const amp = CONFIG.targets.witch.bobAmplitude;
    const y = this.lane.y + Math.sin(t * 1.7 + this.phase) * amp + Math.sin(t * 0.6 + this.phase) * 0.3;
    this.model.root.position.set(this.x, y, this.lane.z);
    this.model.rider.rotation.z = Math.sin(t * 2.1 + this.phase) * 0.12;
    this.model.rider.rotation.x = Math.cos(t * 1.7 + this.phase) * 0.08;
    this.model.cape.rotation.x = 0.5 + Math.sin(t * 9) * 0.18;
    this.model.hat.rotation.z = Math.sin(t * 5 + this.phase) * 0.08;
    this.shapes[0]!.center.set(this.x, y + CONFIG.targets.witch.hitCenterY, this.lane.z);
    this.head.center.set(this.x, y + CONFIG.targets.witch.head.y, this.lane.z);
  }
}

// -------------------------------------------------------------------- Spider
type SpiderState = 'descend' | 'hang' | 'prepare' | 'reposition' | 'leave';

export class SpiderTarget extends Target {
  readonly kind = 'spider' as const;
  state: SpiderState = 'descend';
  private y: number;
  private hangY: number;
  private fromY = 0;
  private stateTime = 0;
  private stateDur = 0;
  throwsLeft: number;
  private swing = 0;
  private readonly minHang: number;
  private readonly maxHang: number;
  private readonly radius: number;

  constructor(
    id: number,
    private readonly model: SpiderInstance,
    readonly anchor: SpiderAnchor,
    private readonly rng: Rng,
    params: LevelParams,
    parent: THREE.Object3D,
  ) {
    const cfg = CONFIG.targets.spider;
    const big = params.levelIndex > 0 && rng.chance(cfg.mediumChance);
    super(id, big ? 'medium' : 'small', model.root);
    this.baseScale = big ? 1.45 : 1;
    this.radius = cfg.hitRadius[big ? 'medium' : 'small'];
    this.minHang = anchor.minHang ?? cfg.minHangHeight;
    this.maxHang = Math.max(this.minHang, Math.min(cfg.maxHangHeight, anchor.y - 1.2));
    this.hangY = rng.range(this.minHang, this.maxHang);
    this.y = anchor.y - 0.3;
    this.throwsLeft = params.spider.throws;
    this.swing = rng.range(0, Math.PI * 2);
    this.shapes.push({ center: new THREE.Vector3(), radius: this.radius });
    model.root.scale.setScalar(this.baseScale);
    model.web.position.set(anchor.x, anchor.y - 0.1, anchor.z - 0.08);
    model.web.scale.setScalar(0.9);
    parent.add(model.thread, model.web);
    this.place();
  }

  get preparing(): boolean {
    return this.state === 'prepare';
  }

  update(dt: number, ctx: TargetContext): void {
    const cfg = CONFIG.targets.spider;
    const p = ctx.params.spider;
    this.age += dt;
    this.stateTime += dt;
    switch (this.state) {
      case 'descend':
        this.y -= cfg.descendSpeed * dt;
        if (this.y <= this.hangY) {
          this.y = this.hangY;
          this.enter('hang', p.hangSec * this.rng.range(0.8, 1.3));
        }
        break;
      case 'hang':
        if (this.stateTime >= this.stateDur) {
          if (this.throwsLeft <= 0) this.enter('leave', 0);
          else if (ctx.incomingCount() < ctx.params.incoming.max) {
            this.enter('prepare', p.prepSec);
            ctx.onSpiderPrepare(this);
          } else this.stateDur += 0.3;
        }
        break;
      case 'prepare':
        if (this.stateTime >= this.stateDur) {
          const from = this.shapes[0]!.center.clone().add(new THREE.Vector3(0, -0.05, 0.35));
          if (ctx.throwPumpkin(from)) this.throwsLeft -= 1;
          this.fromY = this.y;
          this.hangY = this.rng.range(this.minHang, this.maxHang);
          this.enter('reposition', 0.9);
        }
        break;
      case 'reposition': {
        const k = Math.min(1, this.stateTime / this.stateDur);
        this.y = this.fromY + (this.hangY - this.fromY) * (k * k * (3 - 2 * k));
        if (k >= 1) this.enter('hang', p.hangSec * this.rng.range(0.8, 1.3));
        break;
      }
      case 'leave':
        this.y += cfg.climbSpeed * dt;
        if (this.y >= this.anchor.y - 0.35) this.removed = true;
        break;
    }
    this.place();
  }

  private enter(state: SpiderState, duration: number): void {
    this.state = state;
    this.stateTime = 0;
    this.stateDur = duration;
  }

  private place(): void {
    const cfg = CONFIG.targets.spider;
    const t = this.age;
    const settled = this.state === 'hang' || this.state === 'prepare' || this.state === 'reposition';
    const swingX = settled ? Math.sin(t * 1.3 + this.swing) * cfg.swingAmplitude : Math.sin(t * 2 + this.swing) * 0.08;
    const bob = settled ? Math.sin(t * 2.4) * 0.12 : 0;
    const prep = this.state === 'prepare' ? Math.min(1, this.stateTime / Math.max(0.01, this.stateDur)) : 0;
    const shake = prep > 0 ? Math.sin(t * 60) * 0.04 * (0.5 + prep) : 0;
    const x = this.anchor.x + swingX + shake;
    const y = this.y + bob;
    const z = this.anchor.z;
    const m = this.model;
    m.root.position.set(x, y, z);
    // Legs wiggle; the front pair rears up while preparing to throw.
    m.legsLeft.rotation.z = Math.sin(t * 6) * 0.08;
    m.legsRight.rotation.z = -Math.sin(t * 6) * 0.08;
    m.frontL.rotation.x = -prep * 0.9 - Math.sin(t * 7) * 0.1;
    m.frontR.rotation.x = -prep * 0.9 - Math.cos(t * 7) * 0.1;
    m.body.rotation.x = -prep * 0.35;
    m.glow.visible = prep > 0;
    if (prep > 0) {
      const pulse = 0.9 + Math.sin(t * 18) * 0.25;
      m.glow.scale.setScalar(1.6 * pulse * (0.6 + prep));
      m.glow.position.set(0, 0.05, -0.1);
      if (!m.glow.parent) m.body.add(m.glow);
    }
    m.marker.visible = prep > 0;
    m.marker.position.y = 0.6 + Math.abs(Math.sin(t * 8)) * 0.12;
    m.marker.rotation.y = t * 3;
    // Thread from the anchor to the top of the spider.
    const dx = x - this.anchor.x;
    const dy = y + 0.18 * this.baseScale - (this.anchor.y - 0.05);
    const len = Math.max(0.05, Math.hypot(dx, dy));
    m.thread.position.set(this.anchor.x, this.anchor.y - 0.05, z);
    m.thread.rotation.z = Math.asin(Math.max(-1, Math.min(1, dx / len)));
    m.thread.scale.set(1, len, 1);
    this.shapes[0]!.center.set(x, y, z);
  }

  override hit(): void {
    super.hit();
    this.model.marker.visible = false;
    this.model.glow.visible = false;
    this.model.thread.visible = false;
  }

  override dispose(): void {
    super.dispose();
    this.model.thread.removeFromParent();
    this.model.web.removeFromParent();
  }
}

// -------------------------------------------------------------------- Incoming jack-o'-lantern
export class IncomingPumpkin extends Target {
  readonly kind = 'incomingPumpkin' as const;
  private readonly p0: THREE.Vector3;
  private readonly v0: THREE.Vector3;
  private readonly g: number;
  private t = 0;
  readonly flightSec: number;
  private readonly spin: THREE.Vector3;

  constructor(id: number, private readonly model: JackInstance, from: THREE.Vector3, eye: THREE.Vector3, rng: Rng, flightSec: number) {
    super(id, CONFIG.defaultSize.incomingPumpkin, model.root);
    const cfg = CONFIG.targets.incomingPumpkin;
    this.baseScale = 0.42;
    this.flightSec = flightSec;
    this.g = cfg.gravity;
    this.p0 = from.clone();
    // Arrive just in front of the player's eye, coming from the spider's direction.
    const toSpider = from.clone().sub(eye).normalize();
    const side = new THREE.Vector3(-toSpider.z, 0, toSpider.x).normalize().multiplyScalar(rng.range(-cfg.lateralJitter, cfg.lateralJitter));
    const end = eye.clone().addScaledVector(toSpider, cfg.arrivalAhead).add(side).add(new THREE.Vector3(0, -0.25, 0));
    const T = flightSec;
    this.v0 = end.sub(this.p0).sub(new THREE.Vector3(0, 0.5 * this.g * T * T, 0)).divideScalar(T);
    this.spin = new THREE.Vector3(rng.range(1, 3), rng.range(-2, 2), rng.range(-1, 1));
    this.shapes.push({ center: this.p0.clone(), radius: cfg.hitRadius });
    model.root.scale.setScalar(this.baseScale);
    this.place();
  }

  /** 0..1 progress toward the player. */
  get progress(): number {
    return Math.min(1, this.t / this.flightSec);
  }

  get arrived(): boolean {
    return this.t >= this.flightSec;
  }

  update(dt: number): void {
    this.age += dt;
    this.t += dt;
    this.place();
  }

  private place(): void {
    const t = Math.min(this.t, this.flightSec);
    const c = this.shapes[0]!.center;
    c.copy(this.p0).addScaledVector(this.v0, t);
    c.y += 0.5 * this.g * t * t;
    this.model.root.position.copy(c);
    // Tumble, but keep the carved face mostly toward the player near the end.
    const face = Math.min(1, this.progress * 1.4);
    this.model.root.rotation.set(this.spin.x * t * (1 - face), this.spin.y * t * (1 - face), this.spin.z * t * (1 - face));
    const ring = this.model.ring;
    const pulse = 1 + Math.sin(this.age * (10 + this.progress * 20)) * 0.12;
    ring.scale.setScalar(3.2 * pulse);
    (ring.material as THREE.SpriteMaterial).opacity = 0.65 + this.progress * 0.35;
  }
}

// -------------------------------------------------------------------- Candy corn (tossed)
export class CandyCornTarget extends Target {
  readonly kind = 'candyCorn' as const;
  private readonly pos: THREE.Vector3;
  private readonly vel: THREE.Vector3;
  private readonly spinRate: number;

  constructor(id: number, readonly mesh: THREE.Mesh, spot: { x: number; z: number }, rng: Rng) {
    super(id, CONFIG.defaultSize.candyCorn, mesh);
    const cfg = CONFIG.targets.candyCorn;
    this.baseScale = cfg.scale;
    this.pos = new THREE.Vector3(spot.x, 0.4, spot.z);
    this.vel = new THREE.Vector3(rng.range(-1.8, 1.8), rng.range(cfg.tossSpeed[0], cfg.tossSpeed[1]), rng.range(-0.6, 0.3));
    this.spinRate = rng.range(3, 6) * rng.sign();
    this.shapes.push({ center: this.pos.clone(), radius: cfg.hitRadius });
    mesh.scale.setScalar(this.baseScale);
    this.place();
  }

  update(dt: number): void {
    this.age += dt;
    this.vel.y += CONFIG.targets.candyCorn.gravity * dt;
    this.pos.addScaledVector(this.vel, dt);
    if (this.vel.y < 0 && this.pos.y < 0.3) this.removed = true;
    this.place();
  }

  private place(): void {
    this.mesh.position.copy(this.pos);
    this.mesh.position.y -= 0.35 * this.baseScale;
    this.mesh.rotation.set(Math.sin(this.age * 2) * 0.5, this.age * this.spinRate, this.age * this.spinRate * 0.5);
    this.shapes[0]!.center.copy(this.pos);
  }
}

// -------------------------------------------------------------------- Sucker (rises, hovers, sinks)
export class SuckerTarget extends Target {
  readonly kind = 'sucker' as const;
  private readonly hoverY: number;
  private readonly hoverSec: number;
  private readonly x: number;
  private readonly z: number;
  private readonly phase: number;

  constructor(id: number, readonly mesh: THREE.Mesh, spot: { x: number; z: number }, rng: Rng) {
    super(id, CONFIG.defaultSize.sucker, mesh);
    const cfg = CONFIG.targets.sucker;
    this.x = spot.x;
    this.z = spot.z;
    this.hoverY = rng.range(cfg.hoverY[0], cfg.hoverY[1]);
    this.hoverSec = rng.range(cfg.hoverSec[0], cfg.hoverSec[1]);
    this.phase = rng.range(0, Math.PI * 2);
    this.shapes.push({ center: new THREE.Vector3(this.x, 0, this.z), radius: cfg.hitRadius });
    this.place();
  }

  update(dt: number): void {
    this.age += dt;
    if (this.age > this.hoverSec + 1.6) this.removed = true;
    this.place();
  }

  private place(): void {
    const rise = 0.8;
    const a = this.age;
    let y: number;
    if (a < rise) y = this.hoverY * (1 - Math.pow(1 - a / rise, 3));
    else if (a < rise + this.hoverSec) y = this.hoverY + Math.sin((a - rise) * 2 + this.phase) * 0.25;
    else y = this.hoverY * Math.max(0, 1 - (a - rise - this.hoverSec) / 0.8);
    this.mesh.position.set(this.x, y, this.z);
    this.mesh.rotation.set(0, Math.sin(a * 1.4 + this.phase) * 0.6, Math.sin(a * 2 + this.phase) * 0.15);
    this.shapes[0]!.center.set(this.x, y, this.z);
  }
}

export function makeCandyMesh(lib: ModelLibrary, kind: 'candyCorn' | 'sucker'): THREE.Mesh {
  return new THREE.Mesh(kind === 'candyCorn' ? lib.candyCornGeometry() : lib.suckerGeometry(), materials().lit);
}
