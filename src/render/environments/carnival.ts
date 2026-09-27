import * as THREE from 'three';
import { PartBuilder } from '../builder';
import { materials } from '../materials';
import { EnvBuilder, addStriped, mulberry, type Environment } from './common';

const BULBS = [0xff4d6d, 0xffd23a, 0x5dffb0, 0x5fb8ff, 0xd07bff] as const;
const POLE = 0x2a2233;

/** Point on a sagging string between a and b (t∈[0,1]). */
function catenary(a: THREE.Vector3, b: THREE.Vector3, sag: number, t: number): THREE.Vector3 {
  return new THREE.Vector3().lerpVectors(a, b, t).setY(a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t));
}

function booth(b: EnvBuilder, x: number, z: number, yaw: number, stripeA: number, stripeB: number, seed: number): void {
  const rand = mulberry(seed);
  const p = new PartBuilder();
  p.add(new THREE.BoxGeometry(3.4, 1.1, 0.9), 0x7a3b2a, { pos: [0, 0.55, 0.9] })
    .add(new THREE.BoxGeometry(3.6, 0.12, 1.1), 0xe8d2a8, { pos: [0, 1.15, 0.9] })
    .add(new THREE.BoxGeometry(3.4, 2.8, 0.15), 0x3a2448, { pos: [0, 1.4, -0.6] });
  for (const dx of [-1.65, 1.65]) p.add(new THREE.BoxGeometry(0.14, 3.2, 0.14), 0xe8d2a8, { pos: [dx, 1.6, 0.95] });
  // Striped awning
  for (let i = 0; i < 8; i++) {
    p.add(new THREE.BoxGeometry(0.45, 0.08, 1.9), i % 2 ? stripeA : stripeB, { pos: [-1.58 + i * 0.45, 3.25, 0.55], rot: [0.32, 0, 0] });
    p.add(new THREE.ConeGeometry(0.23, 0.35, 3), i % 2 ? stripeA : stripeB, { pos: [-1.58 + i * 0.45, 2.85, 1.5], rot: [Math.PI, 0, 0], scale: [1, 1, 0.3] });
  }
  // Prize shelves with plush blobs (abandoned, a bit dusty)
  for (const y of [1.6, 2.3]) {
    p.add(new THREE.BoxGeometry(3.2, 0.08, 0.4), 0x5a3a2a, { pos: [0, y, -0.4] });
    for (let i = 0; i < 5; i++) {
      const c = [0xff7eb6, 0x7ed957, 0xffd23a, 0x6fa8ff, 0xff8a1c][Math.floor(rand() * 5)] as number;
      p.add(new THREE.SphereGeometry(0.18, 8, 6), c, { pos: [-1.2 + i * 0.6, y + 0.2, -0.4], scale: [1, 1.2, 0.9] });
      p.add(new THREE.SphereGeometry(0.07, 6, 4), c, { pos: [-1.3 + i * 0.6, y + 0.42, -0.4] });
      p.add(new THREE.SphereGeometry(0.07, 6, 4), c, { pos: [-1.1 + i * 0.6, y + 0.42, -0.4] });
    }
  }
  // Knocked-over milk bottles on the counter
  for (let i = 0; i < 4; i++) {
    p.add(new THREE.CylinderGeometry(0.08, 0.12, 0.35, 8), 0xf0f0f5, { pos: [-0.8 + i * 0.5, 1.38, 0.9], rot: [0, 0, i === 2 ? 1.4 : 0] });
  }
  b.lit.addColored(p.build(), { pos: [x, 0, z], rot: [0, yaw, 0] });
  const sign = new PartBuilder().add(new THREE.BoxGeometry(2.2, 0.55, 0.1), 0xffe07a, { pos: [0, 3.85, 1.2], rot: [0.2, 0, 0] }).build();
  b.glow.addColored(sign, { pos: [x, 0, z], rot: [0, yaw, 0] });
  b.blocker([x - 1.9, 0, z - 1.3], [x + 1.9, 1.25, z + 1.5]);
}

function tent(b: EnvBuilder, x: number, z: number, r: number, h: number, colors: readonly number[], flag: number): void {
  addStriped(b.lit, r, r, h, 16, colors, { pos: [x, h / 2, z] });
  addStriped(b.lit, 0.15, r * 1.08, h * 1.1, 16, colors, { pos: [x, h + (h * 1.1) / 2, z] });
  b.add(new THREE.TorusGeometry(r * 1.02, 0.12, 5, 24), 0xffd23a, { pos: [x, h + 0.02, z], rot: [Math.PI / 2, 0, 0] });
  b.add(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 5), POLE, { pos: [x, h * 2.1 + 0.7, z] });
  b.add(new THREE.ConeGeometry(0.35, 0.9, 3), flag, { pos: [x + 0.4, h * 2.1 + 1.25, z], rot: [0, 0, -Math.PI / 2], scale: [1, 1, 0.15] });
  b.box([r * 0.7, h * 0.85, 0.1], 0x1a0f22, { pos: [x, h * 0.42, z + r * 0.98] });
  b.box([r * 0.5, h * 0.7, 0.06], 0xffb86a, { pos: [x, h * 0.35, z + r * 1.0] }, 'glow');
  b.halo(x, h * 0.4, z + r + 0.6, r * 1.2, 0xffa040, 0.25);
  b.blocker([x - r, 0, z - r], [x + r, h * 2, z + r]);
}

export function buildCarnival(): Environment {
  const b = new EnvBuilder('haunted-carnival');
  const rand = mulberry(91);

  b.sky({ top: 0x170838, horizon: 0xc2408e, bottom: 0x160a22 })
    .stars(240, 21, 0xffe8ff)
    .moon([-40, 55, -118], 6, 0xfff0f8, 0xff9ad8, 6)
    .hills(0x26143a, 22, 11, 105)
    .lights({ sky: 0xe0b0ff, ground: 0x2a1a30, hemi: 1.3, moon: 0xffe0f0, moonIntensity: 1.35, moonDir: [-3, 9, 6], fill: 0xa0e0ff, fillIntensity: 0.45 })
    .ground(0x2f2640);

  // Checkered midway leading to the big top.
  for (let i = 0; i < 12; i++) {
    for (let j = -2; j <= 2; j++) {
      b.box([1.05, 0.04, 1.05], (i + j) % 2 === 0 ? 0x4c3f66 : 0x2b2240, { pos: [j * 1.05, 0.02, -2.5 - i * 1.05] });
    }
  }
  // Scattered popcorn and tickets
  for (let i = 0; i < 60; i++) {
    b.add(new THREE.IcosahedronGeometry(0.06, 0), rand() < 0.7 ? 0xfff2c0 : 0xff5a6a, { pos: [-12 + rand() * 24, 0.05, -3 - rand() * 18] });
  }

  // ---------------------------------------------------------------- tents & booths
  tent(b, 0, -32, 7, 4.2, [0xd8283f, 0xfff2de], 0xff8a1c);
  tent(b, -15, -21, 3.2, 3.0, [0x7a3fb8, 0xff8a1c], 0x7ed957);
  tent(b, 15.5, -24, 3.6, 3.2, [0x2f9e6a, 0xfff2de], 0xd8283f);
  booth(b, -8.4, -7.2, 0.45, 0xd8283f, 0xfff2de, 3);
  booth(b, 8.6, -7.4, -0.45, 0x2f7fd8, 0xffd23a, 4);
  // Ticket kiosk + popcorn cart
  b.box([1.6, 2.4, 1.6], 0x8e2c4a, { pos: [-4.2, 1.2, -20.8], rot: [0, 0.3, 0] });
  b.add(new THREE.ConeGeometry(1.4, 1.0, 4), 0xffd23a, { pos: [-4.2, 2.9, -20.8], rot: [0, 0.3 + Math.PI / 4, 0] });
  b.box([0.9, 0.7, 0.05], 0xffe9a0, { pos: [-4.0, 1.5, -20.0], rot: [0, 0.3, 0] }, 'glow');
  b.blocker([-5.2, 0, -21.8], [-3.2, 3.2, -19.8]);
  b.box([1.2, 1.0, 0.8], 0xd8283f, { pos: [4.8, 0.9, -20.5] });
  b.box([1.0, 0.9, 0.7], 0xfff2c0, { pos: [4.8, 1.85, -20.5] }, 'glow');
  b.add(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 10), 0x1a1a1a, { pos: [4.3, 0.3, -20.1], rot: [Math.PI / 2, 0, 0] });
  b.add(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 10), 0x1a1a1a, { pos: [5.3, 0.3, -20.1], rot: [Math.PI / 2, 0, 0] });

  // Balloons tied to the booths, gently bobbing.
  const balloonGroup = new THREE.Group();
  const balloonGeo = b.tracker.track(new PartBuilder().add(new THREE.SphereGeometry(0.28, 10, 8), 0xffffff, { scale: [1, 1.2, 1] }).build());
  const balloonMats = [0xff4d6d, 0xffd23a, 0x5fb8ff, 0x9b59ff].map((c) => b.tracker.track(new THREE.MeshLambertMaterial({ color: c })));
  const balloons: Array<{ mesh: THREE.Mesh; base: THREE.Vector3; phase: number }> = [];
  for (let i = 0; i < 8; i++) {
    const side = i < 4 ? -1 : 1;
    const bx = side * (8.4 + (i % 4) * 0.35 - 0.5) + (side > 0 ? 0.2 : 0);
    const base = new THREE.Vector3(bx, 4.4 + (i % 3) * 0.35, side < 0 ? -6.2 : -6.4);
    const mesh = new THREE.Mesh(balloonGeo, balloonMats[i % 4]);
    mesh.position.copy(base);
    balloonGroup.add(mesh);
    balloons.push({ mesh, base, phase: i * 1.3 });
  }
  b.group.add(balloonGroup);
  b.animate((t) => {
    for (const bl of balloons) {
      bl.mesh.position.set(bl.base.x + Math.sin(t * 0.8 + bl.phase) * 0.12, bl.base.y + Math.sin(t * 1.3 + bl.phase) * 0.1, bl.base.z);
    }
  });

  // ---------------------------------------------------------------- string lights
  const poles: Array<[number, number]> = [[-9.5, -9.4], [9.5, -9.4], [-10.5, -16.8], [10.5, -16.8]];
  for (const [px, pz] of poles) {
    b.add(new THREE.CylinderGeometry(0.1, 0.14, 7.6, 6), POLE, { pos: [px, 3.8, pz] });
    b.add(new THREE.SphereGeometry(0.2, 8, 6), 0xffd23a, { pos: [px, 7.7, pz] }, 'glow');
    b.blocker([px - 0.15, 0, pz - 0.15], [px + 0.15, 7.6, pz + 0.15]);
  }
  const strings: Array<[THREE.Vector3, THREE.Vector3, number]> = [
    [new THREE.Vector3(-9.5, 7.4, -9.4), new THREE.Vector3(9.5, 7.4, -9.4), 1.3],
    [new THREE.Vector3(-10.5, 7.4, -16.8), new THREE.Vector3(10.5, 7.4, -16.8), 1.2],
    [new THREE.Vector3(-9.5, 7.4, -9.4), new THREE.Vector3(10.5, 7.4, -16.8), 1.5],
    [new THREE.Vector3(9.5, 7.4, -9.4), new THREE.Vector3(-10.5, 7.4, -16.8), 1.5],
  ];
  // Bulbs alternate between two meshes so they can "chase" like a marquee.
  const bulbsA = new PartBuilder();
  const bulbsB = new PartBuilder();
  const bulbGeo = new THREE.SphereGeometry(0.11, 6, 4);
  let k = 0;
  for (const [a, c, sag] of strings) {
    const n = Math.round(a.distanceTo(c) / 0.8);
    let prev = a;
    for (let i = 1; i <= n; i++) {
      const p = catenary(a, c, sag, i / n);
      b.segment([prev.x, prev.y, prev.z], [p.x, p.y, p.z], 0.02, 0x14101a);
      if (i < n) {
        (k % 2 ? bulbsA : bulbsB).add(bulbGeo, BULBS[k % BULBS.length] as number, { pos: [p.x, p.y - 0.12, p.z] });
        k++;
      }
      prev = p;
    }
  }
  const matA = b.tracker.track(new THREE.MeshBasicMaterial({ vertexColors: true }));
  const matB = b.tracker.track(new THREE.MeshBasicMaterial({ vertexColors: true }));
  b.group.add(new THREE.Mesh(b.tracker.track(bulbsA.build()), matA), new THREE.Mesh(b.tracker.track(bulbsB.build()), matB));
  b.animate((t) => {
    const on = Math.floor(t * 2.2) % 2 === 0;
    matA.color.setScalar(on ? 1 : 0.35);
    matB.color.setScalar(on ? 0.35 : 1);
  });

  // ---------------------------------------------------------------- Ferris wheel
  const wheel = new THREE.Group();
  wheel.position.set(19, 13.5, -52);
  const wr = 11;
  const frame = new PartBuilder();
  for (const dz of [-0.9, 0.9]) {
    frame.add(new THREE.TorusGeometry(wr, 0.18, 6, 48), 0xd8d0e8, { pos: [0, 0, dz] });
    frame.add(new THREE.TorusGeometry(wr * 0.35, 0.12, 6, 24), 0xd8d0e8, { pos: [0, 0, dz] });
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    for (const dz of [-0.9, 0.9]) {
      frame.add(new THREE.CylinderGeometry(0.08, 0.08, wr, 4), 0xd8d0e8, { pos: [Math.cos(a) * wr * 0.5, Math.sin(a) * wr * 0.5, dz], rot: [0, 0, a - Math.PI / 2] });
    }
  }
  frame.add(new THREE.CylinderGeometry(0.6, 0.6, 2.2, 10), 0x8a8098, { rot: [Math.PI / 2, 0, 0] });
  const rimBulbs = new PartBuilder();
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    rimBulbs.add(new THREE.SphereGeometry(0.22, 6, 4), BULBS[i % BULBS.length] as number, { pos: [Math.cos(a) * wr, Math.sin(a) * wr, 1.1] });
  }
  const spin = new THREE.Group();
  spin.add(new THREE.Mesh(b.tracker.track(frame.build()), materials().lit));
  spin.add(new THREE.Mesh(b.tracker.track(rimBulbs.build()), materials().glow));
  wheel.add(spin);
  // Cabins stay upright while the wheel turns.
  const cabinGeo = b.tracker.track(
    new PartBuilder()
      .add(new THREE.BoxGeometry(1.6, 1.3, 1.4), 0xffffff, { pos: [0, -1.1, 0] })
      .add(new THREE.CylinderGeometry(0.1, 0.1, 0.6, 4), 0x444444, { pos: [0, -0.3, 0] })
      .build(),
  );
  const cabinColors = [0xff4d6d, 0xffd23a, 0x5fb8ff, 0x9b59ff, 0x5dffb0, 0xff8a1c];
  const cabins = new THREE.InstancedMesh(cabinGeo, b.tracker.track(new THREE.MeshLambertMaterial({ color: 0xffffff })), 12);
  const col = new THREE.Color();
  for (let i = 0; i < 12; i++) cabins.setColorAt(i, col.set(cabinColors[i % cabinColors.length] as number));
  wheel.add(cabins);
  const legs = new PartBuilder();
  for (const dz of [-1.8, 1.8]) {
    legs.add(new THREE.CylinderGeometry(0.25, 0.35, 15.5, 6), 0x8a8098, { pos: [-4.2, -6.8, dz], rot: [0, 0, -0.3] });
    legs.add(new THREE.CylinderGeometry(0.25, 0.35, 15.5, 6), 0x8a8098, { pos: [4.2, -6.8, dz], rot: [0, 0, 0.3] });
  }
  wheel.add(new THREE.Mesh(b.tracker.track(legs.build()), materials().litFlat));
  b.group.add(wheel);
  const m4 = new THREE.Matrix4();
  b.animate((t) => {
    const rot = t * 0.12;
    spin.rotation.z = rot;
    for (let i = 0; i < 12; i++) {
      const a = rot + (i / 12) * Math.PI * 2;
      m4.makeTranslation(Math.cos(a) * wr, Math.sin(a) * wr, 0);
      cabins.setMatrixAt(i, m4);
    }
    cabins.instanceMatrix.needsUpdate = true;
  });
  b.halo(19, 13.5, -50, 30, 0xff70c0, 0.12);

  // Carousel canopy peeking out on the left, far back.
  addStriped(b.lit, 0.2, 5, 2.2, 16, [0xffd23a, 0x9b59ff], { pos: [-20, 5.6, -36] });
  b.add(new THREE.CylinderGeometry(5, 5, 0.5, 16), 0xd8283f, { pos: [-20, 4.4, -36] });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.add(new THREE.CylinderGeometry(0.06, 0.06, 4.2, 4), 0xffd23a, { pos: [-20 + Math.cos(a) * 4.3, 2.1, -36 + Math.sin(a) * 4.3] });
  }
  b.add(new THREE.CylinderGeometry(5.2, 5.2, 0.4, 16), 0x5a3a6a, { pos: [-20, 0.2, -36] });

  // Anchors along the light strings, where spiders dangle between the bulbs.
  const [s0, s1] = strings as [(typeof strings)[0], (typeof strings)[0]];
  const anchorAt = (s: (typeof strings)[0], t: number) => {
    const p = catenary(s[0], s[1], s[2], t);
    return { x: p.x, y: p.y - 0.1, z: p.z };
  };

  return b.finish(
    'Haunted Carnival',
    {
      frankLanes: [
        { z: -11.6, xMin: -11, xMax: 11 },
        { z: -14.6, xMin: -12, xMax: 12 },
      ],
      witchLanes: [
        { y: 10.2, z: -19.5, xMin: -21, xMax: 21 },
        { y: 12.6, z: -26, xMin: -28, xMax: 28 },
      ],
      spiderAnchors: [anchorAt(s0, 0.3), anchorAt(s0, 0.55), anchorAt(s0, 0.75), anchorAt(s1, 0.25), anchorAt(s1, 0.5), anchorAt(s1, 0.78)],
      candySpots: [
        { x: -4, z: -9.5 },
        { x: 4.2, z: -9.6 },
        { x: 0, z: -13.2 },
        { x: -6.8, z: -13.1 },
        { x: 6.9, z: -13.1 },
        { x: -2.5, z: -17.5 },
        { x: 2.8, z: -18.2 },
      ],
    },
    { color: 0x5a2a6e, near: 26, far: 135 },
  );
}
