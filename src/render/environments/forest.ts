import * as THREE from 'three';
import { softDotTexture } from '../textures';
import { EnvBuilder, mulberry, type Environment } from './common';

const BARK = [0x4a3346, 0x3e2c3f, 0x553a3a] as const;
const CANOPY = [0x1f4038, 0x2c2650, 0x24463a, 0x352a5c] as const;
const MUSHROOM = [0x5ff7ff, 0xff6ad8, 0xb6ff5f, 0xffd45f] as const;

type V3 = [number, number, number];

/** Gnarled trunk made of bent segments, twisting branches and optional glowing owl eyes. */
function twistedTree(b: EnvBuilder, x: number, z: number, scale: number, seed: number, owl = false): V3 {
  const rand = mulberry(seed);
  const color = BARK[seed % BARK.length] as number;
  let p: V3 = [x, 0, z];
  let r = 0.55 * scale;
  const phase = rand() * Math.PI * 2;
  for (let i = 0; i < 6; i++) {
    const next: V3 = [
      x + Math.sin(phase + i * 0.9) * 0.55 * scale,
      p[1] + 1.15 * scale,
      z + Math.cos(phase + i * 0.7) * 0.25 * scale,
    ];
    b.segment(p, next, r, color);
    b.add(new THREE.SphereGeometry(r, 7, 5), color, { pos: next });
    p = next;
    r *= 0.86;
  }
  // Big roots
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rand();
    b.segment([x, 0.5 * scale, z], [x + Math.cos(a) * 1.4 * scale, -0.05, z + Math.sin(a) * 1.1 * scale], 0.2 * scale, color);
  }
  // Twisting branches from the upper trunk
  const top = p;
  for (let i = 0; i < 4; i++) {
    const a = phase + i * 1.7;
    let from: V3 = [top[0], top[1] - i * 0.7 * scale, top[2]];
    let rr = 0.2 * scale;
    for (let k = 0; k < 3; k++) {
      const to: V3 = [
        from[0] + Math.cos(a + k * 0.6) * 1.3 * scale,
        from[1] + (0.5 - k * 0.15) * scale,
        from[2] + Math.sin(a + k * 0.6) * 0.8 * scale,
      ];
      b.segment(from, to, rr, color);
      from = to;
      rr *= 0.7;
    }
  }
  if (owl) {
    const hy = 3.2 * scale;
    const hx = x + Math.sin(phase + 2 * 0.9) * 0.55 * scale;
    b.add(new THREE.SphereGeometry(0.32 * scale, 8, 6), 0x1a1020, { pos: [hx, hy, z + 0.45 * scale], scale: [1, 1.3, 0.4] });
    b.add(new THREE.SphereGeometry(0.07 * scale, 6, 4), 0xffe24a, { pos: [hx - 0.1 * scale, hy + 0.08 * scale, z + 0.56 * scale] }, 'glow');
    b.add(new THREE.SphereGeometry(0.07 * scale, 6, 4), 0xffe24a, { pos: [hx + 0.1 * scale, hy + 0.08 * scale, z + 0.56 * scale] }, 'glow');
  }
  b.blocker([x - 0.7 * scale, 0, z - 0.6 * scale], [x + 0.7 * scale, 6.5 * scale, z + 0.6 * scale]);
  return top;
}

function mushroomCluster(b: EnvBuilder, x: number, z: number, seed: number, halo = true): void {
  const rand = mulberry(seed);
  const color = MUSHROOM[seed % MUSHROOM.length] as number;
  const n = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const s = 0.25 + rand() * 0.45;
    const mx = x + (rand() - 0.5) * 1.2;
    const mz = z + (rand() - 0.5) * 0.9;
    b.add(new THREE.CylinderGeometry(0.07 * s * 2, 0.1 * s * 2, 0.6 * s, 6), 0xeee4cc, { pos: [mx, 0.3 * s, mz], rot: [0, 0, (rand() - 0.5) * 0.3] });
    b.add(new THREE.SphereGeometry(0.34 * s, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), color, { pos: [mx, 0.58 * s, mz], scale: [1, 0.7, 1] }, 'glow');
    b.add(new THREE.SphereGeometry(0.06 * s, 5, 4), 0xffffff, { pos: [mx + 0.12 * s, 0.75 * s, mz + 0.12 * s] }, 'glow');
  }
  if (halo) b.halo(x, 0.5, z, 2.4, color, 0.35);
}

export function buildForest(): Environment {
  const b = new EnvBuilder('spooky-forest');
  const rand = mulberry(51);

  b.sky({ top: 0x0e1238, horizon: 0x6f52cf, bottom: 0x0f0f22 })
    .stars(320, 13, 0xe6ecff)
    .moon([6, 62, -100], 8, 0xeef2ff, 0xbfd0ff, 6)
    .hills(0x1b1a3a, 14, 12, 90)
    .lights({ sky: 0xb4b0ff, ground: 0x2a2320, hemi: 1.55, moon: 0xdfe6ff, moonIntensity: 1.4, moonDir: [2, 10, 5], fill: 0xffb0e0, fillIntensity: 0.4 })
    .ground(0x3b3629);

  // Leaf litter and a winding path.
  for (let i = 0; i < 40; i++) {
    const c = [0x7a4a1a, 0x5a3a18, 0x8a5a20, 0x3e3522][Math.floor(rand() * 4)] as number;
    b.patch(-20 + rand() * 40, -3 - rand() * 26, 0.5 + rand() * 1.3, 0.4 + rand() * 0.8, c, 0.008 + rand() * 0.004, rand() * 3);
  }
  for (let i = 0; i < 12; i++) {
    const zz = -3 - i * 2.2;
    b.patch(Math.sin(i * 0.6) * 2.2, zz, 1.3, 1.6, 0x6e5a40, 0.014, i * 0.3);
  }

  // ---------------------------------------------------------------- trees
  // Keep walking lanes (z≈-10.5 and z≈-14.2) clear; big trees sit in front, between and behind them.
  const perchL = twistedTree(b, -9.5, -17.5, 1.25, 1, true);
  const perchR = twistedTree(b, 9.8, -18, 1.3, 2);
  twistedTree(b, -14.5, -7.2, 1.35, 3);
  twistedTree(b, 14.8, -7.5, 1.3, 4, true);
  twistedTree(b, -16.5, -12.3, 1.1, 5);
  twistedTree(b, 16.8, -12.4, 1.1, 6);
  twistedTree(b, -3.5, -24, 1.4, 7, true);
  twistedTree(b, 4.5, -27, 1.5, 8);
  twistedTree(b, -18, -22, 1.5, 9);
  twistedTree(b, 18, -24, 1.4, 10);
  twistedTree(b, -11, -32, 1.6, 11);
  twistedTree(b, 12, -34, 1.7, 12);
  // Perch branches reaching over the clearing
  b.segment([perchL[0], perchL[1] - 1.2, perchL[2]], [-5.2, 8.0, -16.5], 0.16, BARK[0]);
  b.segment([perchR[0], perchR[1] - 1.0, perchR[2]], [5.6, 8.4, -17], 0.16, BARK[1]);
  b.segment([-14.2, 6.2, -7.2], [-8.8, 7.6, -9.2], 0.14, BARK[2]);
  b.segment([14.4, 6.0, -7.5], [9.0, 7.4, -9.0], 0.14, BARK[0]);

  // Canopy clumps around the edges leave big sky gaps overhead and in the centre.
  const clumps: Array<[number, number, number, number]> = [
    [-17, 11, -9, 4.5], [-14, 13.5, -15, 5], [-19, 12, -20, 5.5], [17, 11.5, -9, 4.5], [15, 13, -16, 5],
    [19.5, 12.5, -21, 5.5], [-7, 15, -27, 5], [8, 16, -30, 6], [-14, 14, -30, 5], [18, 14, -33, 5],
    [-4, 12, -24.5, 3.5], [5, 13, -27.5, 4],
  ];
  for (const [cx, cy, cz, s] of clumps) {
    for (let k = 0; k < 3; k++) {
      b.add(new THREE.IcosahedronGeometry(1, 0), CANOPY[(k + Math.floor(cx)) & 3] as number, {
        pos: [cx + (rand() - 0.5) * s, cy + (rand() - 0.5) * s * 0.4, cz + (rand() - 0.5) * s * 0.6],
        scale: [s * (0.7 + rand() * 0.4), s * (0.5 + rand() * 0.3), s * (0.7 + rand() * 0.4)],
        rot: [rand(), rand(), rand()],
      });
    }
  }

  // Fallen log, stumps and ferns.
  b.add(new THREE.CylinderGeometry(0.5, 0.55, 4.2, 8), 0x5a3b2a, { pos: [-6.2, 0.45, -7.4], rot: [0, 0.2, Math.PI / 2] });
  b.add(new THREE.CylinderGeometry(0.45, 0.45, 0.05, 8), 0xc9a26a, { pos: [-4.12, 0.45, -7.0], rot: [0, 0.2, Math.PI / 2] });
  b.add(new THREE.SphereGeometry(0.5, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0x3f6a2f, { pos: [-7, 0.8, -7.5], scale: [1.6, 0.4, 0.7] });
  b.blocker([-8.3, 0, -8.1], [-4.1, 0.95, -6.7]);
  b.add(new THREE.CylinderGeometry(0.55, 0.65, 0.8, 8), 0x5a3b2a, { pos: [6.5, 0.4, -7.2] });
  b.add(new THREE.CylinderGeometry(0.52, 0.52, 0.04, 8), 0xc9a26a, { pos: [6.5, 0.81, -7.2] });
  for (let i = 0; i < 14; i++) {
    const fx = (rand() < 0.5 ? -1 : 1) * (4 + rand() * 12);
    const fz = -5 - rand() * 18;
    if (Math.abs(fz + 10.5) < 1.2 || Math.abs(fz + 14.2) < 1.2) continue;
    for (let k = 0; k < 4; k++) {
      b.add(new THREE.ConeGeometry(0.15, 1.0, 3), 0x2f5a34, { pos: [fx, 0.4, fz], rot: [0.7, k * 1.6, 0], scale: [1, 1, 0.3] });
    }
  }

  // Glowing mushrooms
  const shrooms: Array<[number, number]> = [[-8.2, -16.2], [8.4, -16.5], [-13.2, -6.4], [13.4, -6.6], [-2.4, -22.6], [3.2, -8.0], [-3.5, -7.8], [0.8, -19.5], [11.5, -21], [-12, -20.5]];
  shrooms.forEach(([mx, mz], i) => mushroomCluster(b, mx, mz, i + 1, i < 7));

  // Fireflies: a small animated point cloud.
  const count = 36;
  const base = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    base[i * 3] = -14 + rand() * 28;
    base[i * 3 + 1] = 0.8 + rand() * 4;
    base[i * 3 + 2] = -6 - rand() * 20;
  }
  const geom = b.tracker.track(new THREE.BufferGeometry());
  const posAttr = new THREE.BufferAttribute(base.slice(), 3);
  geom.setAttribute('position', posAttr);
  const mat = b.tracker.track(
    new THREE.PointsMaterial({ color: 0xd8ff6a, size: 0.22, map: softDotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  const flies = new THREE.Points(geom, mat);
  b.group.add(flies);
  b.animate((t) => {
    const arr = posAttr.array as Float32Array;
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (base[i * 3] as number) + Math.sin(t * 0.6 + i) * 0.8;
      arr[i * 3 + 1] = (base[i * 3 + 1] as number) + Math.sin(t * 0.9 + i * 1.7) * 0.4;
      arr[i * 3 + 2] = (base[i * 3 + 2] as number) + Math.cos(t * 0.5 + i * 0.7) * 0.6;
    }
    posAttr.needsUpdate = true;
    mat.opacity = 0.75 + 0.25 * Math.sin(t * 3);
  });

  b.fogBanks(10, 0xa99cff, 0.18, { xMin: -24, xMax: 24, zMin: -30, zMax: -8 }, 17, 0.9);

  return b.finish(
    'Spooky Forest',
    {
      frankLanes: [
        { z: -10.5, xMin: -11, xMax: 11 },
        { z: -14.2, xMin: -12.5, xMax: 12.5 },
      ],
      witchLanes: [
        { y: 9.8, z: -17.5, xMin: -13, xMax: 13 },
        { y: 11.8, z: -21.5, xMin: -15, xMax: 15 },
      ],
      spiderAnchors: [
        { x: -5.4, y: 7.9, z: -16.5 },
        { x: -7.2, y: 7.7, z: -16.9 },
        { x: 5.8, y: 8.3, z: -17 },
        { x: 7.6, y: 8.0, z: -17.4 },
        { x: -9.0, y: 7.5, z: -9.2, minHang: 3.7 },
        { x: 9.2, y: 7.3, z: -9.0, minHang: 3.7 },
      ],
      candySpots: [
        { x: -3.6, z: -8.6 },
        { x: 3.4, z: -9.0 },
        { x: -6.5, z: -12.4 },
        { x: 6.8, z: -12.4 },
        { x: 0.2, z: -12.3 },
        { x: -1.5, z: -16.5 },
        { x: 2.5, z: -18 },
      ],
    },
    { color: 0x3a3272, near: 18, far: 105 },
  );
}
