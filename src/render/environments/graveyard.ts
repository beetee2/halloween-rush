import * as THREE from 'three';
import { EnvBuilder, gableGeometry, mulberry, type Environment } from './common';

const STONE = [0x9c98ab, 0x8a8699, 0xa9a3b8, 0x7d7a8e] as const;
const IRON = 0x1d1a24;
const BARK = 0x2f2a33;

/** Row of wrought-iron bars with spear tips between x0 and x1 at depth z. */
function ironFence(b: EnvBuilder, x0: number, x1: number, z: number, height: number): void {
  const n = Math.round(Math.abs(x1 - x0) / 0.38);
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const h = height + (i % 3 === 0 ? 0.25 : 0);
    b.add(new THREE.CylinderGeometry(0.03, 0.03, h, 5), IRON, { pos: [x, h / 2, z] });
    b.add(new THREE.ConeGeometry(0.07, 0.2, 4), IRON, { pos: [x, h + 0.1, z] });
  }
  for (const y of [0.35, height - 0.25]) {
    b.box([Math.abs(x1 - x0), 0.06, 0.05], IRON, { pos: [(x0 + x1) / 2, y, z] });
  }
  b.blocker([Math.min(x0, x1), 0, z - 0.06], [Math.max(x0, x1), 0.6, z + 0.06]);
}

/** One leaf of the gate, hinged at `hingeX`, swung open by `angle`. */
function gateLeaf(b: EnvBuilder, hingeX: number, z: number, width: number, angle: number, dir: 1 | -1): void {
  const bars = 6;
  for (let i = 0; i <= bars; i++) {
    const d = (width * i) / bars;
    const x = hingeX + dir * Math.cos(angle) * d;
    const zz = z + Math.sin(angle) * d;
    const h = 2.6 + 0.35 * Math.sin((i / bars) * Math.PI);
    b.add(new THREE.CylinderGeometry(0.035, 0.035, h, 5), IRON, { pos: [x, h / 2, zz] });
    b.add(new THREE.ConeGeometry(0.08, 0.22, 4), IRON, { pos: [x, h + 0.1, zz] });
  }
  for (const y of [0.4, 1.4, 2.4]) {
    const cx = hingeX + (dir * Math.cos(angle) * width) / 2;
    const cz = z + (Math.sin(angle) * width) / 2;
    b.box([width, 0.07, 0.06], IRON, { pos: [cx, y, cz], rot: [0, -dir * angle, 0] });
  }
  // Curly scroll decoration
  b.add(new THREE.TorusGeometry(0.28, 0.03, 5, 12), IRON, {
    pos: [hingeX + dir * Math.cos(angle) * width * 0.5, 1.9, z + Math.sin(angle) * width * 0.5],
    rot: [0, -dir * angle, 0],
  });
}

export function buildGraveyard(): Environment {
  const b = new EnvBuilder('graveyard');
  const rand = mulberry(31);

  b.sky({ top: 0x0c2536, horizon: 0x5fb592, bottom: 0x0d1c20 })
    .stars(220, 9, 0xe8fff0)
    .moon([34, 42, -118], 10, 0xe8ffd8, 0xb8ffc8, 5.5)
    .hills(0x163029, 8)
    .lights({ sky: 0xa8f0d4, ground: 0x28302c, hemi: 1.3, moon: 0xe0ffe8, moonIntensity: 1.35, moonDir: [6, 9, 6], fill: 0xd0c0ff, fillIntensity: 0.45 })
    .ground(0x34463a);

  for (let i = 0; i < 16; i++) {
    b.patch(-24 + rand() * 48, -3 - rand() * 28, 1.5 + rand() * 2, 1 + rand() * 1.4, rand() < 0.5 ? 0x3d5244 : 0x2b3a30, 0.008);
  }
  // Worn dirt path up to the gate
  b.patch(0, -8, 1.4, 7, 0x4f4436, 0.012);
  b.patch(0, -17, 1.8, 4, 0x4f4436, 0.012);

  // ---------------------------------------------------------------- headstone rows
  const rows: Array<{ z: number; xs: number[]; scale: [number, number] }> = [
    { z: -7.6, xs: [-10.5, -7.2, -3.6, 3.8, 7.0, 10.6], scale: [0.75, 0.95] },
    { z: -12.1, xs: [-12.5, -8.8, -5.2, 5.0, 8.7, 12.4], scale: [0.85, 1.1] },
    { z: -17.2, xs: [-13, -9.5, -6, -3, 3.2, 6.4, 9.8, 13.2], scale: [0.95, 1.25] },
    { z: -19.8, xs: [-11, -7.4, 7.6, 11.2], scale: [1.0, 1.3] },
  ];
  for (const row of rows) {
    for (const x of row.xs) {
      const s = row.scale[0] + rand() * (row.scale[1] - row.scale[0]);
      const tilt = (rand() - 0.5) * 0.35;
      const col = STONE[Math.floor(rand() * STONE.length)] as number;
      if (rand() < 0.22) b.graveCross(x + (rand() - 0.5) * 0.6, row.z, s, col, tilt * 0.6);
      else b.tombstone(x + (rand() - 0.5) * 0.6, row.z, s, col, tilt, (rand() - 0.5) * 0.3, (rand() - 0.5) * 0.2);
      b.patch(x, row.z + 0.9, 0.55, 0.9, 0x4a3e30, 0.015);
    }
  }
  // Candles flickering on a few graves
  for (const [x, z] of [[-7.2, -7.2], [3.8, -7.2], [8.7, -11.7], [-5.2, -11.7]] as const) {
    b.add(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 6), 0xf2ead8, { pos: [x + 0.3, 0.11, z + 0.35] });
    b.add(new THREE.ConeGeometry(0.04, 0.12, 5), 0xffd35a, { pos: [x + 0.3, 0.29, z + 0.35] }, 'glow');
    b.halo(x + 0.3, 0.32, z + 0.4, 0.8, 0xffc050, 0.5);
  }

  // ---------------------------------------------------------------- gate + fence
  const gz = -22;
  for (const side of [-1, 1] as const) {
    const px = side * 2.3;
    b.solidBox([1.0, 3.3, 1.0], 0x7c788c, [px, 1.65, gz]);
    b.box([1.25, 0.25, 1.25], 0x6a6679, { pos: [px, 3.4, gz] });
    b.pumpkin(px, gz, 0.42, true, -side * 0.3, undefined, false, 3.52);
  }
  b.halo(-2.3, 4.0, gz + 0.5, 1.8, 0xffb040, 0.45);
  b.halo(2.3, 4.0, gz + 0.5, 1.8, 0xffb040, 0.45);
  gateLeaf(b, -1.8, gz, 1.8, 0.55, 1);
  gateLeaf(b, 1.8, gz, 1.8, 0.75, -1);
  b.add(new THREE.TorusGeometry(2.3, 0.07, 6, 20, Math.PI), IRON, { pos: [0, 3.3, gz] });
  b.add(new THREE.TorusGeometry(1.95, 0.05, 6, 20, Math.PI), IRON, { pos: [0, 3.3, gz] });
  b.add(new THREE.TorusGeometry(0.4, 0.04, 5, 14), IRON, { pos: [0, 4.85, gz] });
  ironFence(b, -2.9, -17, gz, 2.1);
  ironFence(b, 2.9, 17, gz, 2.1);

  // ---------------------------------------------------------------- mausoleum
  const mx = 11.5;
  const mz = -28;
  b.solidBox([6.2, 4.2, 5], 0x8e8aa0, [mx, 2.1, mz]);
  b.add(gableGeometry(6.8, 1.6, 5.4, 0.2), 0x6e6a80, { pos: [mx, 4.2, mz] });
  for (const dx of [-2.4, -0.9, 0.9, 2.4]) b.add(new THREE.CylinderGeometry(0.22, 0.26, 3.9, 10), 0xb4b0c4, { pos: [mx + dx, 2.15, mz + 2.75] });
  b.box([6.6, 0.4, 1.2], 0x6e6a80, { pos: [mx, 0.2, mz + 3.0] });
  b.box([1.6, 2.6, 0.1], 0x2a3a30, { pos: [mx, 1.5, mz + 2.52] });
  b.box([0.1, 2.4, 0.1], 0x8dffb8, { pos: [mx, 1.4, mz + 2.58] }, 'glow');
  b.halo(mx, 1.4, mz + 3, 2.4, 0x7dffb0, 0.35);

  // ---------------------------------------------------------------- trees
  b.bareTree(-15.5, -14.6, 1.6, BARK, 41, 0.35);
  b.bareTree(15.2, -14.8, 1.5, BARK, 42, -0.3);
  b.bareTree(-7, -27, 1.9, 0x262129, 43, 0.1);
  b.bareTree(-22, -24, 1.7, 0x262129, 44);
  b.bareTree(24, -20, 1.8, 0x262129, 45);
  // Perch branches for spiders
  b.segment([-14.8, 5.5, -14.6], [-8.6, 7.7, -14.4], 0.13, BARK);
  b.segment([-11.6, 6.6, -14.5], [-10.4, 7.5, -14.4], 0.07, BARK);
  b.segment([14.6, 5.4, -14.8], [8.8, 7.9, -14.6], 0.13, BARK);
  b.segment([11.8, 6.6, -14.7], [12.6, 7.6, -14.7], 0.07, BARK);

  // Ground fog banks drifting across the graves.
  b.fogBanks(16, 0xd6f5e6, 0.32, { xMin: -26, xMax: 26, zMin: -30, zMax: -6 }, 12, 0.7);

  return b.finish(
    'Graveyard',
    {
      frankLanes: [
        { z: -9.9, xMin: -11.5, xMax: 11.5 },
        { z: -14.6, xMin: -12.5, xMax: 12.5 },
      ],
      witchLanes: [
        { y: 9.5, z: -17.5, xMin: -21, xMax: 21 },
        { y: 12.2, z: -24, xMin: -27, xMax: 27 },
      ],
      spiderAnchors: [
        { x: -8.8, y: 7.6, z: -14.4 },
        { x: -10.5, y: 7.4, z: -14.4 },
        { x: 9.0, y: 7.8, z: -14.6 },
        { x: 12.5, y: 7.5, z: -14.7 },
        { x: 0, y: 5.6, z: gz + 0.2, minHang: 3.6 },
      ],
      candySpots: [
        { x: -5.2, z: -9.9 },
        { x: 5.4, z: -9.8 },
        { x: -1.6, z: -12.6 },
        { x: 1.8, z: -15.2 },
        { x: -7.5, z: -15.4 },
        { x: 7.6, z: -15.2 },
      ],
    },
    { color: 0x3f6b5c, near: 22, far: 125 },
  );
}
