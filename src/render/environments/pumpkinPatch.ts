import * as THREE from 'three';
import { PartBuilder } from '../builder';
import { SOIL_DETAIL_MEAN, soilDetailTexture } from '../textures';
import { EnvBuilder, gambrelGeometry, mulberry, type Environment } from './common';

const WOOD = 0x6b4a2e;
const WOOD_DARK = 0x4a3220;
const HAY = 0xe3b23c;
const BARN = 0xb8392c;

// ------------------------------------------------------------------ field layout
// Crop rows run away from the player (along z) on both sides of a straw aisle. They stop
// short of the two Frankenstein lanes, which stay flat at y = 0 so walkers' feet and blob
// shadows sit on the ground.
const LANES_Z = [-10.2, -14.8] as const;
/** Inside this |x| rows break for the lanes; further out they run the whole field. */
const LANE_REACH = 15;
const AISLE_HALF = 1.9;
const ROW_SEGMENTS: ReadonlyArray<readonly [number, number]> = [
  [-2.2, -9.0],
  [-11.4, -13.6],
  [-16.0, -23.5],
];
/** Length of the rounded taper at each end of a row. */
const ROW_CAP = 0.8;
/** Row edges sit this far above the ground so the mound foot never z-fights it. */
const ROW_LIFT = 0.008;

interface Row {
  x: number;
  z0: number;
  z1: number;
  w: number;
  h: number;
  phase: number;
}

function buildRows(): Row[] {
  const rand = mulberry(404);
  const rows: Row[] = [];
  const add = (x: number, z0: number, z1: number, w: number) => {
    rows.push({ x, z0, z1, w: w * (0.94 + rand() * 0.12), h: 0.13 + rand() * 0.035, phase: rand() * Math.PI * 2 });
  };
  const centres: Array<[number, number]> = []; // [x, half width]
  for (let k = 0; k < 15; k++) centres.push([-2.9 - k * 1.45, 0.46]);
  for (let k = 0; k < 7; k++) centres.push([2.9 + k * 1.45, 0.46]);
  centres.push([12.85, 0.36]);
  // The corn on the right stands on its own, wider-spaced rows.
  for (let k = 0; k < 7; k++) centres.push([14 + k * 1.6, 0.5]);
  for (const [x, w] of centres) {
    const ax = Math.abs(x);
    const corn = x > 15;
    if (ax >= LANE_REACH) {
      add(x, -2.2, corn && x < 21 ? -31.5 : -23.5, w);
      continue;
    }
    for (const [z0, z1] of ROW_SEGMENTS) {
      if (z0 === -11.4 && ax < 3.5) continue; // trampled around the harvest arch posts
      // Leave a clear patch for the hay bales.
      const end = z0 === -2.2 && ax > 7.9 && ax < 12.3 ? -5.9 : z1;
      add(x, z0, end, w);
    }
  }
  return rows;
}

const rowCentre = (r: Row, z: number) => r.x + 0.06 * Math.sin(0.43 * z + r.phase) + 0.03 * Math.sin(1.07 * z + 2 * r.phase);

/** 0 at the tips, rising along an elliptical cap to 1 along the body. */
function rowScale(r: Row, z: number): number {
  const s = Math.min(r.z0 - z, z - r.z1);
  if (s <= 0) return 0;
  const t = Math.min(1, s / ROW_CAP);
  return Math.sqrt(1 - (1 - t) * (1 - t));
}

const rowHeight = (r: Row, z: number) =>
  r.h * (1 + 0.1 * Math.sin(2.3 * z + r.phase) + 0.07 * Math.sin(4.1 * z + 3 * r.phase)) * Math.pow(rowScale(r, z), 1.2);

/** Mound surface height at (x, z), or 0 off the row. */
function moundY(r: Row, x: number, z: number): number {
  const we = r.w * rowScale(r, z);
  if (we < 1e-4) return 0;
  const t = (x - rowCentre(r, z)) / we;
  if (Math.abs(t) >= 1) return 0;
  return rowHeight(r, z) * Math.pow(1 - t * t, 0.7) + ROW_LIFT;
}

function groundY(rows: readonly Row[], x: number, z: number): number {
  let y = 0;
  for (const r of rows) {
    if (Math.abs(x - r.x) < r.w + 0.2 && z <= r.z0 && z >= r.z1) y = Math.max(y, moundY(r, x, z));
  }
  return y;
}

// ------------------------------------------------------------------ ground colour

function hash(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth 2D value noise in [0,1]. */
function vnoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash(x0, z0, seed);
  const b = hash(x0 + 1, z0, seed);
  const c = hash(x0, z0 + 1, seed);
  const d = hash(x0 + 1, z0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const C = (hex: number) => new THREE.Color(hex);
const FIELD_DAMP = C(0x34200f);
const FIELD_DRY = C(0x54371f);
const CRUST = C(0x8a6a4e);
const LANE_DIRT = C(0x684b31);
const LANE_LIGHT = C(0x7d6041);
const AISLE_DIRT = C(0x66503a);
const AISLE_STRAW = C(0xa89060);
const GRASS_OLIVE = C(0x4a4c26);
const GRASS_DRY = C(0x76683a);
const FAR = C(0x2c2220);

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

/** Linear albedo of the flat ground at (x, z): field soil, lanes, aisle, grassy margins. */
function groundAlbedo(x: number, z: number, out: THREE.Color): THREE.Color {
  const n1 = vnoise(x / 6.5, z / 6.5, 1);
  const n2 = vnoise(x / 2.2, z / 2.2, 2);
  const n3 = vnoise(x / 0.8, z / 0.8, 3);
  const ax = Math.abs(x);
  out.lerpColors(FIELD_DAMP, FIELD_DRY, Math.min(1, Math.max(0, 0.2 + 0.65 * n1 + 0.3 * (n2 - 0.5))));
  // Dry grass round the headland, the sides and behind the fence.
  const edgeJitter = (n2 - 0.5) * 1.2;
  const inField = smooth(-1.1, -2.0, z + edgeJitter * 0.4) * smooth(-24.8, -24.1, z - edgeJitter * 0.4) * smooth(25.2, 24.2, ax + edgeJitter);
  tmpA.lerpColors(GRASS_OLIVE, GRASS_DRY, Math.min(1, n2 * 0.7 + n3 * 0.4));
  out.lerp(tmpA, 1 - inField);
  // Trampled cross-paths where the Frankensteins walk.
  for (const lz of LANES_Z) {
    const lane = smooth(1.35 + (n3 - 0.5) * 0.3, 0.8, Math.abs(z - lz)) * smooth(LANE_REACH + 0.6, LANE_REACH - 0.6, ax);
    if (lane > 0) {
      tmpB.lerpColors(LANE_DIRT, LANE_LIGHT, n2 * 0.6 + n3 * 0.4);
      out.lerp(tmpB, lane * 0.9);
    }
  }
  // Straw-strewn aisle down the middle, through the arch.
  const aisle = smooth(AISLE_HALF + 0.4 + (n3 - 0.5) * 0.4, AISLE_HALF - 0.3, ax) * smooth(-25, -24.2, z);
  if (aisle > 0) {
    tmpB.lerpColors(AISLE_DIRT, AISLE_STRAW, smooth(0.3, 0.7, n3 * 0.7 + n2 * 0.3));
    out.lerp(tmpB, aisle);
  }
  return out.lerp(FAR, smooth(38, 95, Math.hypot(x, z + 12)));
}

// ------------------------------------------------------------------ ground mesh

/** Axis samples: `step` apart across [lo, hi] (shifted by `offset`), then growing out to the far limits. */
function axis(lo: number, hi: number, step: number, offset: number, farLo: number, farHi: number): number[] {
  const out: number[] = [];
  for (let v = lo + offset; v <= hi; v += step) out.push(v);
  let s = step;
  let v = out[0]!;
  while (v > farLo) {
    s *= 1.35;
    v = Math.max(farLo, v - s);
    out.unshift(v);
  }
  s = step;
  v = out[out.length - 1]!;
  while (v < farHi) {
    s *= 1.35;
    v = Math.min(farHi, v + s);
    out.push(v);
  }
  return out;
}

const UV_SCALE = 1 / 4.2;
const UV_ROT = 0.37;

/**
 * One textured ground mesh: a flat grid out to the horizon plus a raised strip per crop row,
 * with world-planar UVs for the soil detail texture and baked vertex colours.
 */
function groundGeometry(rows: readonly Row[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const cu = Math.cos(UV_ROT) * UV_SCALE;
  const su = Math.sin(UV_ROT) * UV_SCALE;
  const c = new THREE.Color();
  const k = 1 / SOIL_DETAIL_MEAN;
  const vert = (x: number, y: number, z: number, color: THREE.Color) => {
    pos.push(x, y, z);
    col.push(color.r * k, color.g * k, color.b * k);
    uv.push(x * cu + z * su, -x * su + z * cu);
    return pos.length / 3 - 1;
  };

  // Flat grid. Offsets keep every vertex off x = 0 and z = 0 (the camera's axes).
  const xs = axis(-26, 26, 0.55, 0.2137, -150, 150);
  const zs = axis(-26, 4, 0.55, 0.425, -175, 70);
  const base = pos.length / 3;
  for (const z of zs) for (const x of xs) vert(x, 0, z, groundAlbedo(x, z, c));
  const nx = xs.length;
  for (let j = 0; j < zs.length - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = base + j * nx + i;
      idx.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
    }
  }

  // Crop rows: a strip of cross-sections along each row, rounded on top, damp at the foot and
  // dry on the crest. The outer vertices dip just below the ground to bury the seam.
  const ts = [-1.18, -1, -0.72, -0.38, 0, 0.38, 0.72, 1, 1.18];
  const caps = [0, 0.05, 0.16, 0.32, 0.52, ROW_CAP];
  for (const r of rows) {
    const len = r.z0 - r.z1;
    const ss: number[] = [...caps];
    const inner = len - 2 * ROW_CAP;
    const n = Math.max(1, Math.round(inner / 0.5));
    for (let i = 1; i < n; i++) ss.push(ROW_CAP + (inner * i) / n);
    for (let i = caps.length - 1; i >= 0; i--) ss.push(len - caps[i]!);
    const start = pos.length / 3;
    for (const s of ss) {
      const z = r.z0 - s;
      const e = rowScale(r, z);
      const cx = rowCentre(r, z);
      const hh = rowHeight(r, z);
      for (const t of ts) {
        const x = cx + t * r.w * e;
        const at = Math.abs(t);
        const y = at > 1 ? -0.03 : hh * Math.pow(1 - t * t, 0.7) + ROW_LIFT;
        const dry = Math.min(1, Math.max(0, y / 0.15));
        groundAlbedo(x, z, c);
        c.multiplyScalar(1 + 0.55 * dry).lerp(CRUST, 0.42 * dry * dry);
        vert(x, y, z, c);
      }
    }
    const m = ts.length;
    for (let j = 0; j < ss.length - 1; j++) {
      for (let i = 0; i < m - 1; i++) {
        const a = start + j * m + i;
        // Rows run toward -z; wind the quads so their faces point up.
        idx.push(a, a + 1, a + m, a + 1, a + m + 1, a + m);
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------ small props

let leafGeom: THREE.BufferGeometry | null = null;
/** Palmate pumpkin leaf of radius ~1 in the XZ plane, main lobe toward +z, centre raised. */
function leafGeometry(): THREE.BufferGeometry {
  if (leafGeom) return leafGeom;
  const ring: Array<[number, number, number]> = [
    [-2.55, 0.3, 0.05],
    [-1.6, 0.74, 0],
    [-1.2, 0.46, 0.07],
    [-0.8, 0.93, 0],
    [-0.4, 0.5, 0.07],
    [0, 1, 0],
    [0.4, 0.5, 0.07],
    [0.8, 0.93, 0],
    [1.2, 0.46, 0.07],
    [1.6, 0.74, 0],
    [2.55, 0.3, 0.05],
    [Math.PI, 0.12, 0.1],
  ];
  const pos: number[] = [0, 0.16, 0.05];
  for (const [a, r, y] of ring) pos.push(Math.sin(a) * r, y, Math.cos(a) * r);
  const idx: number[] = [];
  for (let i = 0; i < ring.length; i++) idx.push(0, 1 + i, 1 + ((i + 1) % ring.length));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  leafGeom = g;
  return g;
}

const vineGeom = new THREE.CylinderGeometry(1, 1, 1, 3, 1, true);
const hayHeap = new THREE.SphereGeometry(1, 9, 3, 0, Math.PI * 2, 0, Math.PI / 2);

let tuftGeoms: THREE.BufferGeometry[] | null = null;
/** A few variants of a dry grass tuft (thin leaning blades), about 0.5 m tall. */
function tuftGeometries(): THREE.BufferGeometry[] {
  if (tuftGeoms) return tuftGeoms;
  const blade = new THREE.ConeGeometry(0.045, 1, 3, 1, true).translate(0, 0.5, 0);
  const cols = [0x9a8350, 0x8a7a45, 0xb09a5a, 0x7a6a3a, 0xa08850];
  tuftGeoms = [0, 1, 2].map((v) => {
    const rand = mulberry(900 + v);
    const p = new PartBuilder();
    const n = 6 + v;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand();
      const lean = 0.25 + rand() * 0.45;
      const h = 0.3 + rand() * 0.35;
      p.add(blade, cols[Math.floor(rand() * cols.length)] as number, {
        pos: [Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05],
        rot: [Math.sin(a) * lean, 0, -Math.cos(a) * lean],
        scale: [1, h, 1],
      });
    }
    return p.build();
  });
  return tuftGeoms;
}

const LEAF_COLORS = [0x4f7a2e, 0x4f7a2e, 0x3d6428, 0x3d6428, 0x6f7d2c, 0x6f7d2c, 0x8f8a34, 0xa88a3a, 0x7a5230, 0x5d4a2a] as const;
const VINE_COLORS = [0x5b6b2a, 0x6d6a2e, 0x55642a] as const;

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const rotY = new THREE.Matrix4();
const rotX = new THREE.Matrix4();

/** Leaf tipped toward the player so it never goes edge-on (the shared material is single-sided). */
function addLeaf(b: EnvBuilder, x: number, y: number, z: number, size: number, tilt: number, spin: number, color: number): void {
  const az = Math.atan2(-x, -z);
  tmpM.makeTranslation(x, y, z);
  tmpM.multiply(rotY.makeRotationY(az)).multiply(rotX.makeRotationX(tilt)).multiply(rotY.makeRotationY(spin));
  tmpM.scale(tmpS.set(size, size, size));
  b.lit.addMatrix(leafGeometry(), color, tmpM);
}

function addVine(b: EnvBuilder, a: THREE.Vector3, c: THREE.Vector3, color: number): void {
  tmpV.subVectors(c, a);
  const len = tmpV.length();
  tmpQ.setFromUnitVectors(UP, tmpV.normalize());
  tmpM.compose(tmpV.addVectors(a, c).multiplyScalar(0.5), tmpQ, tmpS.set(0.028, len, 0.028));
  b.lit.addMatrix(vineGeom, color, tmpM);
}

function scarecrow(b: EnvBuilder, x: number, z: number, yaw: number, shirt: number): void {
  const rot: [number, number, number] = [0, yaw, 0];
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const at = (dx: number, y: number, dz = 0): [number, number, number] => [x + dx * c + dz * s, y, z - dx * s + dz * c];
  b.add(new THREE.CylinderGeometry(0.08, 0.1, 3.4, 6), WOOD, { pos: at(0, 1.7), rot });
  b.box([2.5, 0.13, 0.13], WOOD, { pos: at(0, 2.35), rot });
  b.box([0.8, 1.0, 0.36], shirt, { pos: at(0, 1.9), rot });
  b.box([0.3, 0.3, 0.38], 0x3f6fb5, { pos: at(0.2, 1.65, 0.01), rot: [0, yaw, 0.2] });
  b.box([2.2, 0.32, 0.32], shirt, { pos: at(0, 2.35), rot });
  for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      b.add(new THREE.ConeGeometry(0.06, 0.35, 4), HAY, { pos: at(side * 1.25, 2.3 - k * 0.05, (k - 1) * 0.08), rot: [0, yaw, side * (Math.PI / 2 + (k - 1) * 0.3)] });
    }
  }
  b.box([0.84, 0.12, 0.4], 0x6b4a2e, { pos: at(0, 1.42), rot });
  // Burlap head with stitched grin and triangle eyes
  b.add(new THREE.SphereGeometry(0.36, 10, 8), 0xd9b98a, { pos: at(0, 2.85), rot, scale: [1, 1.1, 0.95] });
  for (const side of [-1, 1]) {
    b.add(new THREE.ConeGeometry(0.07, 0.1, 3), 0x1a1210, { pos: at(side * 0.12, 2.93, 0.33), rot: [Math.PI / 2, yaw, 0] });
  }
  b.box([0.3, 0.035, 0.03], 0x1a1210, { pos: at(0, 2.72, 0.34), rot });
  for (const dx of [-0.1, 0, 0.1]) b.box([0.02, 0.09, 0.03], 0x1a1210, { pos: at(dx, 2.72, 0.35), rot });
  // Straw hat
  b.add(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 14), 0xe0b050, { pos: at(0, 3.12), rot: [0.1, yaw, -0.08] });
  b.add(new THREE.ConeGeometry(0.34, 0.5, 10), 0xd6a340, { pos: at(0, 3.36), rot: [0.1, yaw, -0.08] });
  b.add(new THREE.CylinderGeometry(0.3, 0.33, 0.08, 10), 0xc0392b, { pos: at(0, 3.2), rot: [0.1, yaw, -0.08] });
  // A crow keeping watch on one arm
  b.add(new THREE.SphereGeometry(0.16, 8, 6), 0x151218, { pos: at(0.9, 2.62), scale: [1.4, 1, 1] });
  b.add(new THREE.SphereGeometry(0.1, 8, 6), 0x151218, { pos: at(1.08, 2.8) });
  b.add(new THREE.ConeGeometry(0.04, 0.14, 4), 0xe0a020, { pos: at(1.2, 2.8), rot: [0, yaw, -Math.PI / 2] });
  b.blocker([x - 0.45, 0, z - 0.3], [x + 0.45, 3.3, z + 0.3]);
}

function hayBale(b: EnvBuilder, x: number, y: number, z: number, yaw: number): void {
  b.box([1.5, 0.8, 0.85], HAY, { pos: [x, y + 0.4, z], rot: [0, yaw, 0] });
  for (const dx of [-0.4, 0.4]) {
    b.box([0.04, 0.82, 0.87], 0x8a5a2a, { pos: [x + dx * Math.cos(yaw), y + 0.4, z - dx * Math.sin(yaw)], rot: [0, yaw, 0] });
  }
}

export function buildPumpkinPatch(): Environment {
  const b = new EnvBuilder('pumpkin-patch');

  b.sky({ top: 0x1c0e38, horizon: 0xa0482a, bottom: 0x1a1014 })
    .stars(220, 17)
    .moon([-24, 20, -120], 13, 0xffb45e, 0xff9a40, 4.5)
    .hills(0x2a1628, 18, 11, 100)
    .lights({ sky: 0xd8a8b8, ground: 0x2a1a14, hemi: 0.95, moon: 0xffc890, moonIntensity: 1.1, moonDir: [-5, 7, 6], fill: 0xc0a0ff, fillIntensity: 0.4 });

  // ---------------------------------------------------------------- ground
  const rows = buildRows();
  const ground = new THREE.Mesh(
    b.tracker.track(groundGeometry(rows)),
    b.tracker.track(new THREE.MeshLambertMaterial({ map: soilDetailTexture(), vertexColors: true })),
  );
  ground.name = 'ground';
  b.group.add(ground);

  // ---------------------------------------------------------------- pumpkins
  // Oversized show pumpkins (solid); the small ones grow on the vines further down.
  b.pumpkin(-9.5, -18.5, 2.1, true, 0.35, 0xff7a18, true);
  b.pumpkin(10.5, -21.5, 2.6, false, -0.4, 0xff8c28, true);
  b.pumpkin(15.5, -16.5, 1.6, true, -0.6, 0xf26a10, true);
  b.pumpkin(-15.5, -8.2, 1.3, false, 0.5, 0xff9a30, true);
  b.pumpkin(4.2, -24.5, 1.8, true, -0.1, 0xff7a18, true);
  b.halo(-9.5, 1.6, -16.3, 3.5, 0xffb040, 0.3);
  b.halo(15.5, 1.3, -15.2, 2.8, 0xffb040, 0.3);

  // ---------------------------------------------------------------- barn + silo
  // Built in local space, then placed crooked (yawed and leaning) as one piece.
  const bx = -10;
  const bz = -28;
  const barnRot: [number, number, number] = [0, 0.28, 0.035];
  const barn = new PartBuilder().add(gambrelGeometry(8.5, 4.2, 3.6, 7), BARN);
  const roof = 0x3b2a2a;
  for (const side of [-1, 1]) {
    barn.add(new THREE.BoxGeometry(2.9, 0.18, 7.5), roof, { pos: [side * 3.52, 5.33, 0], rot: [0, 0, side * -0.97] });
    barn.add(new THREE.BoxGeometry(3.2, 0.18, 7.5), roof, { pos: [side * 1.38, 7.18, 0], rot: [0, 0, side * -0.466] });
  }
  barn.add(new THREE.BoxGeometry(2.6, 3.0, 0.1), 0xf2e8d8, { pos: [0, 1.5, 3.52] })
    .add(new THREE.BoxGeometry(2.3, 2.7, 0.1), 0x8a2a20, { pos: [0, 1.45, 3.56] })
    .add(new THREE.BoxGeometry(3.4, 0.14, 0.1), 0xf2e8d8, { pos: [0, 1.45, 3.62], rot: [0, 0, 0.86] })
    .add(new THREE.BoxGeometry(3.4, 0.14, 0.1), 0xf2e8d8, { pos: [0, 1.45, 3.62], rot: [0, 0, -0.86] })
    .add(new THREE.BoxGeometry(1.7, 1.4, 0.1), 0xf2e8d8, { pos: [0, 5.4, 3.52] })
    .add(new THREE.BoxGeometry(8.6, 0.16, 0.12), 0xf2e8d8, { pos: [0, 4.2, 3.55] });
  b.lit.addColored(barn.build(), { pos: [bx, 0, bz], rot: barnRot });
  b.glow.addColored(
    new PartBuilder().add(new THREE.BoxGeometry(1.4, 1.1, 0.1), 0xffc55a, { pos: [0, 5.4, 3.6] }).build(),
    { pos: [bx, 0, bz], rot: barnRot },
  );
  const fx = bx + Math.sin(0.28) * 3.6;
  const fz = bz + Math.cos(0.28) * 3.6;
  b.halo(fx + 0.2, 5.4, fz + 0.8, 3, 0xffc050, 0.3);
  b.blocker([bx - 4.8, 0, bz - 4.5], [bx + 4.8, 7.8, bz + 4.5]);
  b.add(new THREE.CylinderGeometry(1.8, 1.8, 8, 12), 0x9aa2ab, { pos: [bx - 7.4, 4, bz - 2] });
  b.add(new THREE.SphereGeometry(1.85, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0x6c7079, { pos: [bx - 7.4, 8, bz - 2] });
  b.add(new THREE.ConeGeometry(0.06, 1.1, 4), 0x2a2020, { pos: [bx + 0.3, 8.4, bz], rot: [0, 0, 0.2] });
  b.box([0.9, 0.08, 0.08], 0x2a2020, { pos: [bx + 0.4, 8.8, bz], rot: [0, 0.6, 0.2] });

  // A dead tree on the right whose long branch is a spider perch.
  b.bareTree(14.3, -20.6, 1.5, 0x3a2a26, 77, -0.2);
  b.segment([13.9, 5.2, -20.6], [9.2, 7.7, -19.3], 0.13, 0x3a2a26);

  // ---------------------------------------------------------------- scarecrows, hay, fence
  scarecrow(b, -5.8, -17.6, 0.25, 0xc0392b);
  scarecrow(b, 7.2, -17.2, -0.3, 0x8e44ad);
  hayBale(b, -10.5, 0, -7.2, 0.2);
  hayBale(b, -9.3, 0, -7.6, -0.1);
  hayBale(b, -9.9, 0.8, -7.4, 0.05);
  hayBale(b, 9.6, 0, -7.0, -0.25);
  hayBale(b, 11.1, 0, -7.4, 0.1);
  b.blocker([-11.4, 0, -8.3], [-8.4, 1.6, -6.5]);
  b.blocker([8.7, 0, -8.1], [12.0, 0.8, -6.3]);
  b.pumpkin(-9.9, -6.6, 0.35, true, 0.1, undefined, false, 0.8);

  // Split-rail fence along the back of the field.
  for (let x = -22; x < 22; x += 3) {
    b.add(new THREE.CylinderGeometry(0.1, 0.12, 1.5, 5), WOOD_DARK, { pos: [x, 0.75, -24 + Math.sin(x) * 0.3], rot: [0, 0, Math.sin(x * 3) * 0.08] });
    b.box([3.1, 0.12, 0.1], WOOD, { pos: [x + 1.5, 1.05, -24], rot: [0, 0, Math.sin(x) * 0.05] });
    b.box([3.1, 0.12, 0.1], WOOD, { pos: [x + 1.5, 0.55, -24], rot: [0, 0, Math.cos(x) * 0.05] });
  }

  // Harvest arch over the centre with hanging lanterns (spider perch).
  const az = -12.3;
  const beamY = 5.6;
  for (const side of [-1, 1]) {
    b.add(new THREE.CylinderGeometry(0.16, 0.2, beamY + 0.1, 6), WOOD, { pos: [side * 3.4, (beamY + 0.1) / 2, az], rot: [0, 0, side * 0.03] });
    b.blocker([side * 3.4 - 0.2, 0, az - 0.2], [side * 3.4 + 0.2, beamY, az + 0.2]);
  }
  b.box([8.0, 0.3, 0.3], WOOD, { pos: [0, beamY, az], rot: [0, 0, 0.04] });
  b.box([5.4, 0.6, 0.1], 0xe8d2a8, { pos: [0, beamY + 0.5, az + 0.05], rot: [0, 0, 0.04] });
  for (let i = 0; i < 7; i++) {
    b.pumpkin(-2.25 + i * 0.75, az + 0.14, 0.13, false, 0, i % 2 ? 0xff7a18 : 0x8e44ad, false, beamY + 0.33 + 0.03 * (i - 3));
  }
  for (const lx of [-2.2, 0, 2.2]) {
    b.box([0.03, 0.6, 0.03], 0x2a2020, { pos: [lx, beamY - 0.45, az] });
    b.add(new THREE.SphereGeometry(0.2, 8, 6), 0xffc050, { pos: [lx, beamY - 0.85, az], scale: [1, 1.2, 1] }, 'glow');
    b.halo(lx, beamY - 0.85, az + 0.3, 1.5, 0xffb040, 0.45);
  }

  // Corn stalks in rows on the right, fading into the distance. The stream is advanced past
  // the draws the old scatter used so the stalks keep their places.
  const rand = mulberry(71);
  for (let i = 0; i < 538; i++) rand();
  for (let row = 0; row < 5; row++) {
    for (let i = 0; i < 12; i++) {
      const x = 14 + row * 1.6 + (rand() - 0.5) * 0.5;
      const z = -9 - i * 2 - (rand() - 0.5) * 0.8;
      const h = 2.2 + rand() * 0.9;
      const lean = (rand() - 0.5) * 0.2;
      b.add(new THREE.CylinderGeometry(0.04, 0.07, h, 4), 0xc9a860, { pos: [x, h / 2, z], rot: [0, 0, lean] });
      for (let k = 0; k < 3; k++) {
        b.box([0.9, 0.05, 0.18], 0xb89a50, { pos: [x + 0.3, h * (0.4 + k * 0.2), z], rot: [0, k * 2, -0.5 + lean] });
      }
    }
  }

  // ---------------------------------------------------------------- vines, leaves, pumpkins
  const candySpots = [
    { x: -4.8, z: -8.4 },
    { x: 4.6, z: -8.6 },
    { x: -1.6, z: -12.8 },
    { x: 1.9, z: -16.8 },
    { x: -7.4, z: -12.6 },
    { x: 7.6, z: -12.4 },
  ];
  // Nothing small goes on the lanes (walkers' feet and shadows), candy spots or solid props.
  const clear = (x: number, z: number, r: number) =>
    (Math.abs(x) > LANE_REACH || LANES_Z.every((lz) => Math.abs(z - lz) > 1.25 + r)) &&
    candySpots.every((s) => Math.hypot(s.x - x, s.z - z) > 1.2 + r) &&
    b.blockers.every((k) => x < k.min.x - r - 0.3 || x > k.max.x + r + 0.3 || z < k.min.z - r - 0.3 || z > k.max.z + r + 0.3);
  const vr = mulberry(505);
  const pumpkinColors = [0xff7a18, 0xff9a30, 0xf5f0e0, 0xe86a10, 0x9ccf4a];
  let pumpkins = 0;
  const a = new THREE.Vector3();
  const c = new THREE.Vector3();
  // A few hand-placed pumpkins sitting on the rows nearest the player.
  const hero: Array<[number, number, number, boolean, number]> = [
    [-2.9, -6.4, 0.42, true, 0xff7a18],
    [-5.8, -8.2, 0.36, false, 0xe86a10],
    [-8.7, -13.1, 0.34, false, 0x9ccf4a],
    [4.35, -12.9, 0.33, false, 0xf5f0e0],
  ];
  for (const [hx, hz, hr, carved, color] of hero) {
    const row = rows.find((r) => Math.abs(r.x - hx) < 0.3 && hz <= r.z0 && hz >= r.z1);
    const x = row ? rowCentre(row, hz) : hx;
    b.pumpkin(x, hz, hr, carved, carved ? Math.atan2(-x, -hz) : x * 3, color, false, groundY(rows, x, hz) - 0.04 * hr);
    pumpkins++;
  }
  // Visit the rows in shuffled order so pumpkins spread over both sides of the aisle.
  const order = rows.filter((r) => r.x < 13.5); // the corn rows carry corn, not vines
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(vr() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  for (const r of order) {
    const len = r.z0 - r.z1;
    const vines = len > 4 ? 1 + (vr() < 0.45 ? 1 : 0) : vr() < 0.6 ? 1 : 0;
    for (let v = 0; v < vines; v++) {
      const runLen = Math.min(len - 0.6, 2 + vr() * 3.5);
      let z = r.z0 - 0.3 - vr() * Math.max(0, len - 0.6 - runLen);
      const zEnd = z - runLen;
      let side = vr() < 0.5 ? -1 : 1;
      const wander = vr() * Math.PI * 2;
      const vineColor = VINE_COLORS[Math.floor(vr() * VINE_COLORS.length)] as number;
      const xAt = (zz: number) => rowCentre(r, zz) + 0.2 * r.w * Math.sin(zz * 1.9 + wander);
      a.set(xAt(z), groundY(rows, xAt(z), z) + 0.02, z);
      let grown = false;
      while (z > zEnd) {
        z -= 0.5 + vr() * 0.25;
        const x = xAt(z);
        c.set(x, groundY(rows, x, z) + 0.02, z);
        addVine(b, a, c, vineColor);
        a.copy(c);
        // A leaf (sometimes two) on alternating sides of each node.
        const leaves = vr() < 0.22 ? 2 : 1;
        for (let l = 0; l < leaves; l++) {
          side = -side;
          const size = 0.2 + vr() * 0.16;
          const tilt = 0.4 + vr() * 0.35;
          const lx = x + side * (0.12 + vr() * 0.22);
          const lz = z + (vr() - 0.5) * 0.2;
          const color = LEAF_COLORS[Math.floor(vr() * LEAF_COLORS.length)] as number;
          if (!clear(lx, lz, 0)) continue;
          addLeaf(b, lx, groundY(rows, lx, lz) + size * Math.sin(tilt) * 0.75 + 0.04, lz, size, tilt, (vr() - 0.5) * 1.2, color);
        }
        // Now and then a pumpkin on the vine.
        if (!grown && pumpkins < 26 && z < -5.2 && vr() < (Math.abs(r.x) < 10 ? 0.42 : 0.16)) {
          const pr = 0.24 + vr() * 0.3;
          const px = x - side * (0.1 + vr() * 0.15);
          // Keep the launcher (lower right) and candy bag (lower left) of the opening view clear.
          const across = px / -z;
          const below = (1.7 - pr) / -z;
          const behindHud = (across > 0.2 && below > 0.15) || (across < -0.62 && below > 0.2);
          if (!behindHud && clear(px, z, pr)) {
            const color = pumpkinColors[pumpkins % pumpkinColors.length] as number;
            const carved = pumpkins % 7 === 0;
            const yaw = carved ? Math.atan2(-px, -z) + (vr() - 0.5) * 0.4 : vr() * Math.PI * 2;
            b.pumpkin(px, z, pr, carved, yaw, color, false, groundY(rows, px, z) - 0.04 * pr);
            pumpkins++;
            grown = vr() < 0.4;
          }
        }
      }
    }
  }
  // Fallen, browning leaves in the furrows.
  for (let i = 0; i < 26; i++) {
    const x = (vr() < 0.5 ? -1 : 1) * (2.7 + vr() * 18);
    const z = -3 - vr() * 20.5;
    if (!clear(x, z, 0)) continue;
    const size = 0.16 + vr() * 0.1;
    const color = [0x6a4628, 0x5d4a2a, 0x7a5a2a, 0x5a4a26][Math.floor(vr() * 4)] as number;
    addLeaf(b, x, groundY(rows, x, z) + 0.06, z, size, 0.3 + vr() * 0.2, vr() * 6, color);
  }

  // Low heaps of loose hay round the bales, dry grass on the edges and by the fence.
  for (const [hx, hz, s] of [[-9.8, -6.1, 0.8], [-11.7, -7.9, 0.6], [-8.1, -8.3, 0.55], [10.3, -5.9, 0.7], [8.4, -7.9, 0.5], [12.3, -6.9, 0.6]] as const) {
    b.add(hayHeap, vr() < 0.5 ? 0xd4aa48 : 0xc09a40, { pos: [hx, 0, hz], rot: [0, vr() * 3, 0], scale: [s * 0.8, 0.24 + vr() * 0.08, s * 0.6] });
  }
  const tufts = tuftGeometries();
  const tuft = (x: number, z: number, s: number) => {
    b.lit.addColored(tufts[Math.floor(vr() * tufts.length)]!, { pos: [x, groundY(rows, x, z), z], rot: [0, vr() * 6, 0], scale: s });
  };
  for (let x = -22; x < 22; x += 3) {
    tuft(x + 0.1, -24 + Math.sin(x) * 0.3 + 0.15, 0.9 + vr() * 0.5);
    if (vr() < 0.7) tuft(x + 0.8 + vr() * 1.4, -23.8 - vr() * 0.6, 0.7 + vr() * 0.5);
  }
  for (let i = 0; i < 95; i++) {
    const side = vr() < 0.5 ? -1 : 1;
    let x: number;
    let z: number;
    const pick = vr();
    if (pick < 0.4) {
      // along the outer edges of the field and out into the margins
      x = side * (24.3 + vr() * vr() * 12);
      z = 1 - vr() * 30;
    } else if (pick < 0.85) {
      // headland in front of the rows
      x = side * (2.6 + vr() * 24);
      z = 1.5 - vr() * 3.4;
    } else {
      // round the farmyard behind the fence
      x = -20 + vr() * 40;
      z = -25 - vr() * 8;
    }
    if (Math.hypot(x, z) < 2.5 || !clear(x, z, 0.3)) continue;
    tuft(x, z, 0.7 + vr() * 0.6);
  }

  return b.finish(
    'Pumpkin Patch',
    {
      frankLanes: [
        { z: -10.2, xMin: -11.5, xMax: 11.5 },
        { z: -14.8, xMin: -12, xMax: 12 },
      ],
      witchLanes: [
        { y: 10.6, z: -18.5, xMin: -21, xMax: 21 },
        { y: 11.8, z: -25, xMin: -27, xMax: 27 },
      ],
      spiderAnchors: [
        { x: -1.1, y: beamY - 0.15, z: az + 0.25, minHang: 3.0 },
        { x: 1.1, y: beamY - 0.1, z: az + 0.25, minHang: 3.0 },
        { x: 3.0, y: beamY - 0.05, z: az + 0.25, minHang: 3.0 },
        { x: fx - 1.2, y: 7.6, z: fz + 0.6, minHang: 4.6 },
        { x: 9.4, y: 7.6, z: -19.2 },
      ],
      candySpots,
    },
    { color: 0x3e2430, near: 26, far: 145 },
  );
}
