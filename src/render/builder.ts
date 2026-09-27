import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type V3 = readonly [number, number, number];

export interface PartOptions {
  pos?: V3;
  rot?: V3;
  scale?: number | V3;
}

const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();
const tmpColor = new THREE.Color();

export function makeMatrix(opts: PartOptions = {}): THREE.Matrix4 {
  const p = opts.pos ?? [0, 0, 0];
  const r = opts.rot ?? [0, 0, 0];
  const s = opts.scale ?? 1;
  tmpPos.set(p[0], p[1], p[2]);
  tmpQuat.setFromEuler(tmpEuler.set(r[0], r[1], r[2]));
  if (typeof s === 'number') tmpScale.set(s, s, s);
  else tmpScale.set(s[0], s[1], s[2]);
  return tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
}

/**
 * Collects primitive parts, bakes their transform and a flat vertex color, and merges
 * them into one geometry. A whole prop, character limb or even an entire environment
 * layer becomes a single draw call with one shared vertex-colored material.
 */
export class PartBuilder {
  private parts: THREE.BufferGeometry[] = [];

  add(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, opts: PartOptions = {}): this {
    return this.addMatrix(geometry, color, makeMatrix(opts));
  }

  addMatrix(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, matrix: THREE.Matrix4): this {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    g.applyMatrix4(matrix);
    const count = g.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    tmpColor.set(color);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = tmpColor.r;
      colors[i * 3 + 1] = tmpColor.g;
      colors[i * 3 + 2] = tmpColor.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.morphAttributes = {};
    this.parts.push(g);
    return this;
  }

  /** Add an already-colored geometry (e.g. a per-face colored swirl) with a transform. */
  addColored(geometry: THREE.BufferGeometry, opts: PartOptions = {}): this {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);
    }
    g.applyMatrix4(makeMatrix(opts));
    this.parts.push(g);
    return this;
  }

  get isEmpty(): boolean {
    return this.parts.length === 0;
  }

  build(): THREE.BufferGeometry {
    const merged = this.parts.length
      ? mergeGeometries(this.parts, false)
      : new THREE.BufferGeometry();
    for (const p of this.parts) p.dispose();
    this.parts = [];
    if (!merged) throw new Error('PartBuilder: geometry merge failed');
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }
}

/** Tracks disposable GPU resources so an environment can be torn down completely. */
export class ResourceTracker {
  private items = new Set<{ dispose(): void }>();

  track<T extends { dispose(): void }>(item: T): T {
    this.items.add(item);
    return item;
  }

  dispose(): void {
    for (const item of this.items) item.dispose();
    this.items.clear();
  }

  get size(): number {
    return this.items.size;
  }
}
