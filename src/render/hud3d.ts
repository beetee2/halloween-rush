import * as THREE from 'three';
import { CONFIG } from '../config';
import { CANDY_KINDS, type CandyKind, type Inventory } from '../types';
import { PartBuilder } from './builder';
import { materials } from './materials';
import type { ModelLibrary } from './models/characters';

/**
 * Objects that live in camera space (children of Stage.hud3d): the pumpkin rocket
 * launcher on the lower right and the physical trick-or-treat bag on the lower left.
 */

// ---------------------------------------------------------------------- Launcher
export class Launcher {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly loaded: THREE.Mesh;
  readonly muzzle = new THREE.Object3D();
  private recoil = 0;
  private loadAnim = 1;
  private wasReady = true;

  constructor(lib: ModelLibrary) {
    const PURPLE = 0x6a2fa0;
    const ORANGE = 0xff8a1c;
    const DARK = 0x231a2e;
    const g = new PartBuilder()
      .add(new THREE.CylinderGeometry(0.07, 0.078, 0.62, 16), PURPLE, { rot: [Math.PI / 2, 0, 0] })
      .add(new THREE.CylinderGeometry(0.1, 0.078, 0.1, 16, 1, true), ORANGE, { pos: [0, 0, -0.34], rot: [Math.PI / 2, 0, 0] })
      .add(new THREE.CylinderGeometry(0.098, 0.098, 0.02, 16), DARK, { pos: [0, 0, -0.388], rot: [Math.PI / 2, 0, 0] })
      .add(new THREE.CylinderGeometry(0.085, 0.07, 0.08, 12), DARK, { pos: [0, 0, 0.34], rot: [Math.PI / 2, 0, 0] })
      .add(new THREE.BoxGeometry(0.05, 0.14, 0.07), DARK, { pos: [0, -0.1, 0.1], rot: [0.25, 0, 0] })
      .add(new THREE.BoxGeometry(0.04, 0.12, 0.06), DARK, { pos: [0, -0.1, -0.12], rot: [-0.1, 0, 0] })
      .add(new THREE.BoxGeometry(0.03, 0.035, 0.12), DARK, { pos: [0, 0.085, -0.05] })
      .add(new THREE.SphereGeometry(0.014, 8, 6), 0x7dff6a, { pos: [0, 0.108, -0.1] });
    for (const z of [-0.22, -0.05, 0.14]) {
      g.add(new THREE.TorusGeometry(0.078, 0.012, 6, 20), ORANGE, { pos: [0, 0, z] });
    }
    // Little bat-wing fins at the back
    for (const side of [-1, 1]) {
      g.add(new THREE.ConeGeometry(0.05, 0.12, 3), DARK, { pos: [side * 0.09, 0.02, 0.28], rot: [Math.PI / 2, 0, side * 1.2], scale: [1, 1, 0.25] });
    }
    this.body.add(new THREE.Mesh(g.build(), materials().lit));
    this.loaded = new THREE.Mesh(lib.pumpkinGeometry(), materials().lit);
    this.loaded.scale.setScalar(0.075);
    this.loaded.position.set(0, 0.01, -0.4);
    this.body.add(this.loaded);
    this.muzzle.position.set(0, 0, -0.46);
    this.body.add(this.muzzle);
    this.root.add(this.body);
  }

  /** Place the launcher in the lower-right of view, pointed at the crosshair. */
  layout(halfW: number, halfH: number): void {
    const depth = 1.0;
    this.root.scale.setScalar(0.5 * Math.min(1, halfH / 0.52));
    this.root.position.set(halfW * depth * 0.5, -halfH * depth * 0.66, -depth);
    const d = new THREE.Vector3(0, 0, -40).sub(this.root.position);
    this.root.rotation.set(Math.atan2(d.y, Math.hypot(d.x, d.z)), Math.atan2(-d.x, -d.z), 0, 'YXZ');
  }

  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.muzzle.getWorldPosition(out);
  }

  fire(): void {
    this.recoil = 1;
    this.loadAnim = 0;
  }

  update(dt: number, ready: boolean, t: number): void {
    this.recoil = Math.max(0, this.recoil - dt * 6);
    if (ready && !this.wasReady) this.loadAnim = 0;
    this.wasReady = ready;
    this.loadAnim = Math.min(1, this.loadAnim + dt * 7);
    this.loaded.visible = ready;
    this.loaded.scale.setScalar(0.075 * (ready ? 0.4 + 0.6 * this.loadAnim : 0.001));
    const r = this.recoil * this.recoil;
    this.body.position.set(0, Math.sin(t * 1.6) * 0.003, r * 0.07);
    this.body.rotation.set(r * 0.18, 0, Math.sin(t * 1.1) * 0.01);
  }
}

// ---------------------------------------------------------------------- Candy bag
interface Flight {
  mesh: THREE.Mesh;
  kind: CandyKind;
  from: THREE.Vector3;
  t: number;
  spin: THREE.Vector3;
}

const MINI = 0.034;
const BAG_H = 0.21;

/** Deterministic pile slots inside the bag opening, bottom layers first. */
function pileSlots(count: number): THREE.Vector3[] {
  const slots: THREE.Vector3[] = [];
  const layers = [
    { y: 0.18, r: 0.045, n: 7 },
    { y: 0.18, r: 0, n: 1 },
    { y: 0.2, r: 0.04, n: 6 },
    { y: 0.2, r: 0, n: 1 },
    { y: 0.22, r: 0.03, n: 5 },
    { y: 0.238, r: 0.018, n: 4 },
    { y: 0.254, r: 0, n: 1 },
    { y: 0.215, r: 0.058, n: 1 },
  ];
  for (const L of layers) {
    for (let i = 0; i < L.n; i++) {
      const a = (i / L.n) * Math.PI * 2 + L.y * 40;
      slots.push(new THREE.Vector3(Math.cos(a) * L.r, L.y, Math.sin(a) * L.r));
    }
  }
  return slots.slice(0, count);
}

/** Split `visible` pile slots across candy kinds in proportion to the real inventory. */
export function allocatePile(inv: Inventory, visible: number): CandyKind[] {
  const total = CANDY_KINDS.reduce((n, k) => n + inv[k], 0);
  const shown = Math.min(total, visible);
  if (shown === 0) return [];
  const alloc = CANDY_KINDS.map((k) => {
    const exact = (inv[k] / total) * shown;
    return { k, n: Math.floor(exact), rem: exact - Math.floor(exact), has: inv[k] > 0 };
  });
  let left = shown - alloc.reduce((n, a) => n + a.n, 0);
  // Every collected kind is represented at least once when there is room.
  for (const a of alloc) if (left > 0 && a.has && a.n === 0) {
    a.n = 1;
    a.rem = -1;
    left--;
  }
  alloc.sort((a, b) => b.rem - a.rem);
  for (const a of alloc) if (left > 0 && a.rem >= 0) {
    a.n++;
    left--;
  }
  // Interleave kinds so the pile looks mixed.
  const out: CandyKind[] = [];
  const queues = alloc.filter((a) => a.n > 0).map((a) => ({ k: a.k, n: a.n }));
  while (out.length < shown) {
    for (const q of queues) if (q.n > 0 && out.length < shown) {
      out.push(q.k);
      q.n--;
    }
  }
  return out;
}

export class CandyBag {
  readonly root = new THREE.Group();
  private readonly bag = new THREE.Group();
  private readonly slotMeshes: THREE.Mesh[] = [];
  private readonly slots: THREE.Vector3[];
  private readonly flights: Flight[] = [];
  private readonly pool: THREE.Mesh[] = [];
  private bounce = 0;
  private readonly opening = new THREE.Vector3();
  onLand: ((kind: CandyKind) => void) | null = null;

  constructor(private readonly lib: ModelLibrary) {
    const ORANGE = 0xff8a1c;
    const PURPLE = 0x6a2fa0;
    const BLACK = 0x1b1420;
    // Cloth trick-or-treat sack: round belly, gathered neck, ruffled open top.
    const profile = [
      [0, 0], [0.06, 0.002], [0.088, 0.018], [0.1, 0.05], [0.1, 0.09], [0.092, 0.125], [0.074, 0.152], [0.064, 0.165],
      [0.07, 0.178], [0.086, 0.195], [0.094, 0.205],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const sack = new THREE.LatheGeometry(profile, 28);
    const sp = sack.getAttribute('position');
    const v = new THREE.Vector3();
    for (let i = 0; i < sp.count; i++) {
      v.fromBufferAttribute(sp, i);
      const a = Math.atan2(v.z, v.x);
      // Soft cloth folds on the belly, frilly ruffles on the top edge.
      const fold = v.y > 0.17 ? 1 + 0.12 * Math.sin(a * 11) * ((v.y - 0.17) / 0.035) : 1 + 0.025 * Math.sin(a * 7 + v.y * 30);
      sp.setXYZ(i, v.x * fold, v.y, v.z * fold);
    }
    sack.computeVertexNormals();
    const body = new PartBuilder()
      .add(sack, ORANGE)
      .add(new THREE.TorusGeometry(0.066, 0.009, 6, 24), PURPLE, { pos: [0, 0.165, 0], rot: [Math.PI / 2, 0, 0] })
      .add(new THREE.SphereGeometry(0.014, 8, 6), PURPLE, { pos: [0.02, 0.165, 0.066] })
      .add(new THREE.BoxGeometry(0.012, 0.04, 0.004), PURPLE, { pos: [0.012, 0.145, 0.07], rot: [0, 0, 0.3] })
      .add(new THREE.BoxGeometry(0.012, 0.035, 0.004), PURPLE, { pos: [0.03, 0.147, 0.068], rot: [0, 0, -0.35] })
      // Dark inside so the candy pops
      .add(new THREE.CircleGeometry(0.066, 20), 0x2a1420, { pos: [0, 0.17, 0], rot: [-Math.PI / 2, 0, 0] });
    // Jack-o'-lantern face printed on the belly.
    const tri = (w: number, h: number) => {
      const s = new THREE.Shape();
      s.moveTo(-w / 2, -h / 2);
      s.lineTo(w / 2, -h / 2);
      s.lineTo(0, h / 2);
      s.closePath();
      return new THREE.ShapeGeometry(s);
    };
    body.add(tri(0.03, 0.026), BLACK, { pos: [-0.027, 0.095, 0.1005] });
    body.add(tri(0.03, 0.026), BLACK, { pos: [0.027, 0.095, 0.1005] });
    const mouth = new THREE.Shape();
    mouth.moveTo(-0.045, 0.0);
    for (let i = 1; i <= 6; i++) mouth.lineTo(-0.045 + i * 0.015, i % 2 ? -0.008 : 0.0);
    mouth.quadraticCurveTo(0, -0.04, -0.045, 0.0);
    body.add(new THREE.ShapeGeometry(mouth), BLACK, { pos: [0, 0.06, 0.1005] });
    this.bag.add(new THREE.Mesh(body.build(), materials().lit));
    this.root.add(this.bag);
    this.slots = pileSlots(CONFIG.caps.maxBagVisibleCandies);
    for (let i = 0; i < this.slots.length; i++) {
      const m = new THREE.Mesh(lib.miniGeometry('pumpkin'), materials().lit);
      m.position.copy(this.slots[i]!);
      m.rotation.set(i * 1.7, i * 2.3, i * 0.9);
      m.scale.setScalar(MINI);
      m.visible = false;
      this.bag.add(m);
      this.slotMeshes.push(m);
    }
    this.root.rotation.set(0.38, 0.3, 0.06);
  }

  /** Place the bag in the lower-left of view (camera space), resting near the bottom edge. */
  layout(halfW: number, halfH: number): void {
    const depth = 1.0;
    const s = Math.min(1.1, (halfH / 0.52) * 0.95);
    this.root.scale.setScalar(s);
    this.root.position.set(-halfW * depth * 0.74, -halfH * depth * 0.93, -depth);
  }

  /** Show a representative pile for the given inventory (capped mesh count). */
  setContents(inv: Inventory): void {
    const kinds = allocatePile(inv, this.slotMeshes.length);
    this.slotMeshes.forEach((m, i) => {
      const k = kinds[i];
      m.visible = k !== undefined;
      if (k) m.geometry = this.lib.miniGeometry(k);
    });
  }

  get visibleCount(): number {
    return this.slotMeshes.filter((m) => m.visible).length;
  }

  get activeFlights(): number {
    return this.flights.length;
  }

  /** Send a miniature candy flying from a camera-space point into the bag. */
  launch(kind: CandyKind, fromCamera: THREE.Vector3): void {
    if (this.flights.length >= CONFIG.caps.maxFlyingCandies) this.finish(0);
    const mesh = this.pool.pop() ?? new THREE.Mesh(this.lib.miniGeometry(kind), materials().lit);
    mesh.geometry = this.lib.miniGeometry(kind);
    mesh.visible = true;
    this.root.parent?.add(mesh);
    const flight: Flight = { mesh, kind, from: fromCamera.clone(), t: 0, spin: new THREE.Vector3(Math.random() * 8 - 4, Math.random() * 10 - 5, Math.random() * 6 - 3) };
    this.flights.push(flight);
    this.place(flight);
  }

  /** Drop in-flight candy (used on replay/restart; inventory is already credited). */
  clearFlights(): void {
    for (const f of this.flights) this.release(f.mesh);
    this.flights.length = 0;
  }

  private finish(i: number): void {
    const [f] = this.flights.splice(i, 1);
    if (!f) return;
    this.release(f.mesh);
    this.bounce = 1;
    this.onLand?.(f.kind);
  }

  private release(mesh: THREE.Mesh): void {
    mesh.visible = false;
    mesh.removeFromParent();
    if (this.pool.length < CONFIG.caps.maxFlyingCandies) this.pool.push(mesh);
  }

  private place(f: Flight): void {
    const dur = 0.6;
    const k = Math.min(1, f.t / dur);
    const e = k * k * (3 - 2 * k);
    this.opening.set(0, BAG_H * 1.15, 0);
    this.bag.localToWorld(this.opening);
    this.root.parent?.worldToLocal(this.opening);
    const mid = f.from.clone().lerp(this.opening, 0.5).add(new THREE.Vector3(0, 0.12, 0));
    const a = f.from.clone().lerp(mid, e);
    const b = mid.lerp(this.opening, e);
    f.mesh.position.copy(a.lerp(b, e));
    f.mesh.scale.setScalar(MINI * this.root.scale.x * (2.4 - 1.4 * e));
    f.mesh.rotation.set(f.spin.x * f.t, f.spin.y * f.t, f.spin.z * f.t);
  }

  update(dt: number, t: number): void {
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i]!;
      f.t += dt;
      if (f.t >= 0.6) this.finish(i);
      else this.place(f);
    }
    this.bounce = Math.max(0, this.bounce - dt * 4);
    const b = Math.sin(this.bounce * Math.PI) * this.bounce;
    this.bag.scale.set(1 + b * 0.08, 1 - b * 0.1, 1 + b * 0.08);
    this.bag.rotation.z = Math.sin(t * 1.3) * 0.02;
  }
}
