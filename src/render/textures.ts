import * as THREE from 'three';

/**
 * Procedural textures built from typed arrays (no canvas, no files) so they work in the
 * browser and in Node-based tests alike.
 */

function makeTexture(size: number, fill: (u: number, v: number) => [number, number, number, number]): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = fill((x + 0.5) / size, (y + 0.5) / size);
      const i = (y * size + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

let softDot: THREE.DataTexture | null = null;
/** White radial falloff: halos, fog puffs, glows. */
export function softDotTexture(): THREE.DataTexture {
  if (!softDot) {
    softDot = makeTexture(64, (u, v) => {
      const d = Math.hypot(u - 0.5, v - 0.5) * 2;
      const a = Math.max(0, 1 - d);
      return [255, 255, 255, Math.round(255 * a * a * (3 - 2 * a))];
    });
  }
  return softDot;
}

let ring: THREE.DataTexture | null = null;
/** Hollow ring used for incoming-threat warnings. */
export function ringTexture(): THREE.DataTexture {
  if (!ring) {
    ring = makeTexture(64, (u, v) => {
      const d = Math.hypot(u - 0.5, v - 0.5) * 2;
      const a = Math.max(0, 1 - Math.abs(d - 0.8) / 0.12);
      return [255, 255, 255, Math.round(255 * Math.min(1, a * 1.4))];
    });
  }
  return ring;
}

let shadow: THREE.DataTexture | null = null;
/** Dark blob shadow for characters (cheaper than real shadow maps on phones). */
export function blobShadowTexture(): THREE.DataTexture {
  if (!shadow) {
    shadow = makeTexture(32, (u, v) => {
      const d = Math.min(1, Math.hypot(u - 0.5, v - 0.5) * 2);
      return [0, 0, 0, Math.round(150 * (1 - d * d))];
    });
  }
  return shadow;
}

// ------------------------------------------------------------------ soil detail

/** Average linear value of {@link soilDetailTexture}; divide vertex colours by it to keep their brightness. */
export const SOIL_DETAIL_MEAN = 0.5;

function hash3(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0,1] over a `p`×`p` lattice that wraps across the unit tile. */
function tileNoise(p: number, seed: number): (u: number, v: number) => number {
  const lat = new Float32Array(p * p);
  for (let j = 0; j < p; j++) for (let i = 0; i < p; i++) lat[j * p + i] = hash3(i, j, seed);
  return (u, v) => {
    const x = u * p;
    const y = v * p;
    const i0 = Math.floor(x);
    const j0 = Math.floor(y);
    const fx = x - i0;
    const fy = y - j0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const i1 = i0 + 1 === p ? 0 : i0 + 1;
    const r0 = j0 * p;
    const r1 = (j0 + 1 === p ? 0 : j0 + 1) * p;
    const a = lat[r0 + i0]!;
    const b = lat[r0 + i1]!;
    const c = lat[r1 + i0]!;
    const d = lat[r1 + i1]!;
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

/**
 * Jittered feature points on a `g`×`g` cell grid that wraps across the tile. The returned
 * lookup writes [distance to the nearest point in cell units, that cell's random id, a
 * second random value] into `out`.
 */
function cellular(g: number, seed: number): (u: number, v: number, out: number[]) => void {
  const n = g * g;
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  const id = new Float32Array(n);
  const id2 = new Float32Array(n);
  for (let j = 0; j < g; j++) {
    for (let i = 0; i < g; i++) {
      const k = j * g + i;
      px[k] = 0.15 + 0.7 * hash3(i, j, seed);
      py[k] = 0.15 + 0.7 * hash3(i, j, seed + 1);
      id[k] = hash3(i, j, seed + 2);
      id2[k] = hash3(i, j, seed + 3);
    }
  }
  return (u, v, out) => {
    const x = u * g;
    const y = v * g;
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    let best = 9;
    let k1 = 0;
    for (let j = -1; j <= 1; j++) {
      const gy = cy + j;
      const wy = gy < 0 ? gy + g : gy >= g ? gy - g : gy;
      for (let i = -1; i <= 1; i++) {
        const gx = cx + i;
        const wx = gx < 0 ? gx + g : gx >= g ? gx - g : gx;
        const k = wy * g + wx;
        const dx = x - gx - px[k]!;
        const dy = y - gy - py[k]!;
        const d = dx * dx + dy * dy;
        if (d < best) {
          best = d;
          k1 = k;
        }
      }
    }
    out[0] = Math.sqrt(best);
    out[1] = id[k1]!;
    out[2] = id2[k1]!;
  };
}

let soil: THREE.DataTexture | null = null;
/**
 * Tileable soil detail (clods with cracks, grit, a few pebbles and straw fibres), roughly
 * neutral so it can multiply a ground mesh's vertex colours. Its mean linear value is
 * {@link SOIL_DETAIL_MEAN}. Repeat-wrapped and mipmapped for use with world-planar UVs.
 */
export function soilDetailTexture(): THREE.DataTexture {
  if (soil) return soil;
  const S = 512;
  const n = S * S;
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  // 1) Height field: layered noise plus sparse rounded clods and crumbs.
  const h = new Float32Array(n);
  const c: number[] = [0, 0, 0];
  const e1 = tileNoise(20, 1);
  const e2 = tileNoise(52, 2);
  const e3 = tileNoise(130, 3);
  const e4 = tileNoise(256, 4);
  const clods = cellular(44, 21); // ~10 cm, about a third of the cells carry one
  const crumbs = cellular(112, 25); // ~4 cm
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const v = (y + 0.5) / S;
      let e = e1(u, v) * 0.3 + e2(u, v) * 0.28 + e3(u, v) * 0.2 + e4(u, v) * 0.1;
      clods(u, v, c);
      if (c[1]! < 0.36) {
        const t = c[0]! / (0.24 + 0.26 * c[2]!);
        if (t < 1) e += Math.sqrt(1 - t * t) * (0.34 + 0.2 * c[1]!);
      }
      crumbs(u, v, c);
      if (c[1]! < 0.5) {
        const t = c[0]! / 0.36;
        if (t < 1) e += Math.sqrt(1 - t * t) * 0.16;
      }
      h[y * S + x] = e;
    }
  }
  let hMin = Infinity;
  let hMax = -Infinity;
  for (let i = 0; i < n; i++) {
    hMin = Math.min(hMin, h[i]!);
    hMax = Math.max(hMax, h[i]!);
  }
  // 2) Albedo from low-frequency blotches, shading from the height gradient (light from the
  //    top-left of the tile) and a little cavity darkening.
  const lx = -0.6;
  const ly = -0.8;
  const at = (x: number, y: number) => h[(((y % S) + S) % S) * S + (((x % S) + S) % S)]!;
  const b1 = tileNoise(6, 11);
  const b2 = tileNoise(14, 12);
  const b3 = tileNoise(33, 13);
  const w1 = tileNoise(9, 16);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const v = (y + 0.5) / S;
      const i = y * S + x;
      const hn = (h[i]! - hMin) / (hMax - hMin);
      const gx = (at(x + 1, y) - at(x - 1, y)) * 0.5;
      const gy = (at(x, y + 1) - at(x, y - 1)) * 0.5;
      const lit = Math.min(1.5, Math.max(0.45, 1 - (gx * lx + gy * ly) * 9));
      const blot = b1(u, v) * 0.5 + b2(u, v) * 0.3 + b3(u, v) * 0.2;
      const l = (0.78 + (blot - 0.5) * 0.36) * lit * (0.62 + 0.5 * hn);
      // Damp, redder soil in some blotches; drier, greyer tops elsewhere.
      const warm = w1(u, v);
      r[i] = l * (1.03 + 0.06 * warm - 0.04 * hn);
      g[i] = l * (0.97 + 0.02 * (1 - warm));
      b[i] = l * (0.88 + 0.06 * (1 - warm) + 0.04 * hn);
    }
  }
  const rand = (() => {
    let s = 0x5eed;
    return () => {
      s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
      s ^= s >>> 12;
      return (s >>> 0) / 4294967296;
    };
  })();
  const blend = (px: number, py: number, cr: number, cg: number, cb: number, a: number) => {
    if (a <= 0) return;
    const i = (((py % S) + S) % S) * S + (((px % S) + S) % S);
    r[i] = r[i]! + (cr - r[i]!) * a;
    g[i] = g[i]! + (cg - g[i]!) * a;
    b[i] = b[i]! + (cb - b[i]!) * a;
  };
  // Pebbles: a soft contact shadow, then a lit rounded stone.
  for (let k = 0; k < 36; k++) {
    const px = rand() * S;
    const py = rand() * S;
    const rad = 1.6 + rand() * rand() * 4;
    const tone = 0.78 + rand() * 0.3;
    const R = Math.ceil(rad + 2);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const x = Math.floor(px) + dx;
        const y = Math.floor(py) + dy;
        const ex = x + 0.5 - px;
        const ey = y + 0.5 - py;
        const ds = Math.hypot(ex - rad * 0.3, ey - rad * 0.3);
        blend(x, y, 0.3, 0.27, 0.25, Math.min(1, Math.max(0, rad + 0.8 - ds)) * 0.55);
        const d = Math.hypot(ex, ey);
        const a = Math.min(1, Math.max(0, rad + 0.5 - d));
        const shade = 1 + (-(ex * lx + ey * ly) / rad) * 0.25;
        blend(x, y, tone * shade, tone * 0.95 * shade, tone * 0.86 * shade, a);
      }
    }
  }
  // A few pale straw fibres blown onto the field.
  for (let k = 0; k < 46; k++) {
    let px = rand() * S;
    let py = rand() * S;
    const ang = rand() * Math.PI * 2;
    const len = 10 + rand() * 26;
    const bend = (rand() - 0.5) * 0.04;
    const tone = 1.05 + rand() * 0.35;
    let a = ang;
    for (let s = 0; s < len; s += 0.5) {
      px += Math.cos(a) * 0.5;
      py += Math.sin(a) * 0.5;
      a += bend;
      const fx = Math.floor(px);
      const fy = Math.floor(py);
      const tx = px - fx;
      const ty = py - fy;
      const alpha = 0.5 * Math.min(1, (len - s) / 4);
      blend(fx, fy, tone, tone * 0.86, tone * 0.52, alpha * (1 - tx) * (1 - ty));
      blend(fx + 1, fy, tone, tone * 0.86, tone * 0.52, alpha * tx * (1 - ty));
      blend(fx, fy + 1, tone, tone * 0.86, tone * 0.52, alpha * (1 - tx) * ty);
      blend(fx + 1, fy + 1, tone, tone * 0.86, tone * 0.52, alpha * tx * ty);
    }
  }
  // Treat the working values as linear, normalise their mean, then store as sRGB bytes.
  let sum = 0;
  for (let i = 0; i < n; i++) sum += (r[i]! + g[i]! + b[i]!) / 3;
  const k = SOIL_DETAIL_MEAN / (sum / n);
  const lut = new Uint8Array(4097);
  for (let i = 0; i <= 4096; i++) {
    const c = i / 4096;
    lut[i] = Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
  }
  const toByte = (lin: number) => lut[Math.round(Math.min(1, Math.max(0, lin * k)) * 4096)]!;
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    data[i * 4] = toByte(r[i]!);
    data[i * 4 + 1] = toByte(g[i]!);
    data[i * 4 + 2] = toByte(b[i]!);
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  soil = tex;
  return tex;
}
