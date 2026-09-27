import * as THREE from 'three';
import { EnvBuilder, gableGeometry, mulberry, type Environment } from './common';

const SIDING = 0x6d5b8c;
const SIDING_DARK = 0x4f416a;
const ROOF = 0x2c2340;
const TRIM = 0x3a2f55;
const WINDOW = 0xffd36b;
const PORCH = 0x5b4636;
const FENCE = 0xd9cfe8;
const BARK = 0x3b2b3a;

/** Glowing window with a dark frame, cross mullions and optional crooked shutters. */
function houseWindow(b: EnvBuilder, x: number, y: number, z: number, w: number, h: number, shutters: boolean, tilt = 0): void {
  b.box([w + 0.24, h + 0.24, 0.1], TRIM, { pos: [x, y, z], rot: [0, 0, tilt] });
  b.box([w, h, 0.06], WINDOW, { pos: [x, y, z + 0.04], rot: [0, 0, tilt] }, 'glow');
  b.box([0.08, h, 0.06], TRIM, { pos: [x, y, z + 0.08], rot: [0, 0, tilt] });
  b.box([w, 0.08, 0.06], TRIM, { pos: [x, y + h * 0.1, z + 0.08], rot: [0, 0, tilt] });
  b.box([w + 0.4, 0.12, 0.2], TRIM, { pos: [x, y - h / 2 - 0.14, z + 0.06] });
  if (shutters) {
    b.box([w * 0.45, h * 1.05, 0.06], SIDING_DARK, { pos: [x - w / 2 - w * 0.28, y - 0.05, z + 0.03], rot: [0, 0, 0.12] });
    b.box([w * 0.45, h * 1.05, 0.06], SIDING_DARK, { pos: [x + w / 2 + w * 0.3, y + 0.02, z + 0.03], rot: [0, 0, -0.18] });
  }
  b.halo(x, y, z + 0.4, Math.max(w, h) * 1.6, 0xffc85a, 0.22);
}

export function buildHauntedHouse(): Environment {
  const b = new EnvBuilder('haunted-house');
  const rand = mulberry(11);

  b.sky({ top: 0x24124a, horizon: 0xe06a9c, bottom: 0x241634 })
    .stars(260, 5)
    .moon([-38, 50, -125], 9, 0xfff3c4, 0xffe2a0, 5)
    .hills(0x2b2046, 4)
    .lights({ sky: 0xc9b3ff, ground: 0x3a2a33, hemi: 1.25, moon: 0xfff0dc, moonIntensity: 1.5, moonDir: [-4, 9, 7], fill: 0xffc9a0, fillIntensity: 0.45 })
    .ground(0x35522f);

  // Lawn variation and the stone path to the porch.
  for (let i = 0; i < 18; i++) {
    b.patch(-22 + rand() * 44, -4 - rand() * 26, 1.5 + rand() * 2.5, 1 + rand() * 1.5, rand() < 0.5 ? 0x3e5e36 : 0x2d472a, 0.008);
  }
  for (let i = 0; i < 7; i++) {
    b.box([1.5 + rand() * 0.3, 0.06, 1.0], 0x8a7f96, { pos: [-0.9 + (rand() - 0.5) * 0.3, 0.03, -3.5 - i * 1.55], rot: [0, (rand() - 0.5) * 0.3, 0] });
  }

  // ---------------------------------------------------------------- the house
  const hz = -21; // house centre z
  b.box([11, 7, 6], SIDING, { pos: [0, 3.5, hz] });
  // Horizontal siding lines
  for (let y = 0.6; y < 7; y += 0.7) b.box([11.04, 0.05, 6.04], SIDING_DARK, { pos: [0, y, hz] });
  b.blocker([-5.6, 0, hz - 3.1], [5.6, 10.6, hz + 3.1]);
  // Crooked gable roof + trim
  b.add(gableGeometry(11, 3.6, 6.6, 0.6), ROOF, { pos: [0, 7, hz], rot: [0, 0, 0.035] });
  b.box([12.4, 0.25, 0.3], TRIM, { pos: [0, 6.95, hz + 3.25], rot: [0, 0, 0.02] });
  // Attic round window in the gable
  b.add(new THREE.CylinderGeometry(0.75, 0.75, 0.12, 16), TRIM, { pos: [0, 8.45, hz + 3.34], rot: [Math.PI / 2, 0, 0] });
  b.add(new THREE.CylinderGeometry(0.58, 0.58, 0.14, 16), WINDOW, { pos: [0, 8.45, hz + 3.38], rot: [Math.PI / 2, 0, 0] }, 'glow');
  b.halo(0, 8.45, hz + 3.8, 2.2, 0xffc85a, 0.3);
  // Chimney leaning a little
  b.box([1.0, 3.2, 1.0], 0x7a4b43, { pos: [-3.4, 9.6, hz - 1.2], rot: [0, 0, 0.09] });
  b.box([1.3, 0.3, 1.3], 0x5a3530, { pos: [-3.55, 11.2, hz - 1.2], rot: [0, 0, 0.09] });

  // Tower on the right with a crooked witch-hat roof.
  b.box([3.4, 9.5, 3.4], 0x7a679a, { pos: [5.6, 4.75, hz + 1.6] });
  for (let y = 0.7; y < 9.5; y += 0.7) b.box([3.44, 0.05, 3.44], SIDING_DARK, { pos: [5.6, y, hz + 1.6] });
  b.blocker([3.9, 0, hz - 0.1], [7.3, 14, hz + 3.3]);
  b.add(new THREE.ConeGeometry(2.8, 4.6, 4), ROOF, { pos: [5.75, 11.8, hz + 1.6], rot: [0.05, Math.PI / 4, -0.14] });
  b.add(new THREE.ConeGeometry(0.1, 1.0, 4), 0xd7b44a, { pos: [6.25, 14.4, hz + 1.6], rot: [0, 0, -0.25] });
  b.box([3.7, 0.3, 3.7], TRIM, { pos: [5.6, 9.5, hz + 1.6] });

  // Windows: ground floor, upper floor, tower.
  const front = hz + 3.02;
  houseWindow(b, -3.7, 2.4, front, 1.2, 1.6, true);
  houseWindow(b, 1.9, 2.4, front, 1.2, 1.6, false, 0.04);
  houseWindow(b, -3.7, 5.3, front, 1.1, 1.4, true, -0.05);
  houseWindow(b, -0.9, 5.3, front, 1.1, 1.4, false);
  houseWindow(b, 1.9, 5.3, front, 1.1, 1.4, true, 0.06);
  houseWindow(b, 5.6, 3.0, hz + 3.32, 1.0, 1.5, false);
  houseWindow(b, 5.6, 6.8, hz + 3.32, 0.9, 1.3, false, -0.05);

  // Door with a warm glowing crack.
  b.box([1.5, 2.6, 0.12], TRIM, { pos: [-0.9, 1.3, front] });
  b.box([1.25, 2.4, 0.1], 0x6a2434, { pos: [-0.9, 1.2, front + 0.06] });
  b.box([0.08, 2.2, 0.1], 0xffb347, { pos: [-0.35, 1.15, front + 0.07] }, 'glow');
  b.add(new THREE.SphereGeometry(0.08, 8, 6), 0xd7b44a, { pos: [-0.5, 1.2, front + 0.14] });

  // Porch: deck, steps, crooked posts, sagging roof, railings.
  const pz = hz + 4.6;
  b.box([8.4, 0.35, 3.2], PORCH, { pos: [-0.6, 0.18, pz] });
  for (let i = 0; i < 3; i++) b.box([2.0, 0.18, 0.45], 0x6b5444, { pos: [-0.9, 0.09 + i * 0.1 - 0.02, pz + 1.75 + (2 - i) * 0.3] });
  for (const [x, lean] of [[-4.5, 0.05], [-2.2, -0.03], [0.4, 0.06], [3.0, -0.05]] as const) {
    b.box([0.2, 3.0, 0.2], 0xcfc4dc, { pos: [x, 1.85, pz + 1.4], rot: [0, 0, lean] });
  }
  b.box([8.8, 0.22, 3.6], ROOF, { pos: [-0.6, 3.4, pz + 0.1], rot: [-0.14, 0, 0.03] });
  b.box([8.8, 0.3, 0.12], TRIM, { pos: [-0.6, 3.18, pz + 1.85], rot: [0, 0, 0.03] });
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? -4.5 : 1.0;
    b.box([3.0, 0.1, 0.08], 0xcfc4dc, { pos: [x0 + 1.2, 1.2, pz + 1.4], rot: [0, 0, side * 0.04] });
    for (let i = 0; i < 7; i++) b.box([0.07, 0.8, 0.07], 0xcfc4dc, { pos: [x0 + i * 0.42, 0.8, pz + 1.4] });
  }
  b.blocker([-4.8, 0, pz - 1.6], [3.6, 0.9, pz + 1.6]);
  // Jack-o'-lanterns on the steps and porch.
  b.pumpkin(-2.6, pz + 2.2, 0.38, true, 0.2);
  b.pumpkin(1.0, pz + 2.1, 0.3, true, -0.3);
  b.pumpkin(-3.8, pz + 0.8, 0.45, true, 0.1);
  b.halo(-2.6, 0.4, pz + 2.5, 1.6, 0xffb040, 0.35);
  b.halo(-3.8, 0.5, pz + 1.1, 1.8, 0xffb040, 0.35);

  // ---------------------------------------------------------------- yard
  b.picketFence(-14, -6.8, -1.9, -6.6, FENCE, 1.05);
  b.picketFence(0.3, -6.6, 14, -6.9, FENCE, 1.05);
  b.lampPost(2.4, -5.6, 3.1, 0x2a2233, 0xffb347);
  b.pumpkin(-2.6, -5.5, 0.42, true, 0.1);
  b.pumpkin(-3.3, -5.3, 0.28, false, 0, 0xffa23a);

  // Bare trees framing the yard. Explicit branches double as spider perches.
  b.bareTree(-11, -15.9, 1.45, BARK, 21, 0.25);
  b.bareTree(12, -16, 1.55, BARK, 22, -0.3);
  b.segment([-10.6, 5.2, -15.9], [-6.2, 7.6, -15.2], 0.12, BARK);
  b.segment([11.5, 5.4, -16], [7.8, 8.0, -15.4], 0.12, BARK);

  // Side graves and bushes
  b.tombstone(-9.5, -8.3, 0.8, 0x8d879c, 0.12, 0.3);
  b.tombstone(-12.5, -8.4, 0.9, 0x7a7488, -0.1, 0.2);
  b.tombstone(10.6, -8.3, 0.85, 0x8d879c, -0.15, -0.3);
  for (const [x, z, s] of [[-7, -17, 1.4], [8.2, -18.5, 1.6], [-15, -18, 2], [17, -11, 1.8], [-16, -8, 1.5]] as const) {
    b.add(new THREE.IcosahedronGeometry(1, 0), 0x2a4a2e, { pos: [x, s * 0.55, z], scale: [s, s * 0.75, s] });
  }

  // Background: a crooked shed and more trees fading into the fog.
  b.box([4, 3, 3], 0x4a3b5e, { pos: [-14, 1.5, -28], rot: [0, 0.3, 0.05] });
  b.add(gableGeometry(4, 1.6, 3.4, 0.3), ROOF, { pos: [-14, 3, -28], rot: [0, 0.3, 0.08] });
  b.bareTree(-22, -30, 1.8, 0x2a2233, 23);
  b.bareTree(20, -34, 2.0, 0x2a2233, 24, 0.2);
  b.bareTree(-4, -40, 1.7, 0x2a2233, 25);

  return b.finish(
    'Haunted House',
    {
      frankLanes: [
        { z: -10, xMin: -11.5, xMax: 11.5 },
        { z: -13.2, xMin: -12.5, xMax: 12.5 },
      ],
      witchLanes: [
        { y: 9.2, z: -15.5, xMin: -20, xMax: 20 },
        { y: 12, z: -22, xMin: -26, xMax: 26 },
      ],
      spiderAnchors: [
        { x: -3.8, y: 6.9, z: hz + 3.5, minHang: 4.4 },
        { x: 0.6, y: 6.9, z: hz + 3.5, minHang: 4.4 },
        { x: 3.2, y: 6.9, z: hz + 3.5, minHang: 4.4 },
        { x: 5.6, y: 9.3, z: hz + 3.7, minHang: 4.2 },
        { x: -6.4, y: 7.5, z: -15.2 },
        { x: 8.0, y: 7.9, z: -15.4 },
      ],
      candySpots: [
        { x: -7.5, z: -8.4 },
        { x: -4.2, z: -11.6 },
        { x: 4.4, z: -8.6 },
        { x: 7.8, z: -11.8 },
        { x: 0.8, z: -11.8 },
        { x: -9.0, z: -15.2 },
        { x: 9.2, z: -14.6 },
      ],
    },
    { color: 0x7a4480, near: 32, far: 150 },
  );
}
