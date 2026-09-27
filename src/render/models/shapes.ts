import * as THREE from 'three';
import { PartBuilder } from '../builder';

export const COLORS = {
  pumpkin: 0xff7a18,
  pumpkinDark: 0xd9540b,
  stem: 0x4d7a2a,
  glowYellow: 0xffd84a,
  candyWhite: 0xfff7e6,
  candyOrange: 0xff8a1c,
  candyYellow: 0xffd23a,
  purple: 0x7b3fb8,
  purpleDark: 0x3d1f5c,
  green: 0x7ed957,
  black: 0x1b1420,
} as const;

/** Ribbed, slightly squashed pumpkin of radius ~1 centred at the origin. */
export function pumpkinGeometry(ribs = 8, widthSeg = 24, heightSeg = 14): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, widthSeg, heightSeg);
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const az = Math.atan2(v.z, v.x);
    const groove = 1 - 0.09 * Math.pow(Math.abs(Math.sin((ribs / 2) * (az - Math.PI / 2))), 0.6);
    // Flatten top/bottom and dimple the poles like a real pumpkin.
    const pole = Math.abs(v.y);
    v.x *= groove;
    v.z *= groove;
    v.y *= 0.78;
    if (pole > 0.9) v.y *= 0.9;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Carved face (eyes, nose, toothy grin) on the +z side of a unit pumpkin. */
export function jackFaceGeometry(color: THREE.ColorRepresentation = COLORS.glowYellow): THREE.BufferGeometry {
  const b = new PartBuilder();
  const tri = (w: number, h: number) => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, -h / 2);
    s.lineTo(w / 2, -h / 2);
    s.lineTo(0, h / 2);
    s.closePath();
    return new THREE.ShapeGeometry(s);
  };
  // Eyes (tilted triangles) and nose.
  b.add(tri(0.34, 0.3), color, { pos: [-0.32, 0.22, 0.97], rot: [-0.2, -0.3, 0.25] });
  b.add(tri(0.34, 0.3), color, { pos: [0.32, 0.22, 0.97], rot: [-0.2, 0.3, -0.25] });
  b.add(tri(0.16, 0.14), color, { pos: [0, 0.0, 1.0], rot: [0, 0, 0] });
  // Grin with teeth: a wide crescent made of a zigzag polygon.
  const m = new THREE.Shape();
  const w = 0.62;
  m.moveTo(-w, 0.06);
  const teeth = 5;
  for (let i = 1; i <= teeth * 2; i++) {
    const x = -w + (2 * w * i) / (teeth * 2);
    const y = i % 2 === 1 ? -0.05 : 0.06;
    m.lineTo(x, y + 0.08 * Math.cos((x / w) * 1.3) - 0.08);
  }
  m.quadraticCurveTo(0, -0.42, -w, 0.06);
  b.add(new THREE.ShapeGeometry(m), color, { pos: [0, -0.2, 0.95], rot: [0.15, 0, 0] });
  return b.build();
}

/** Upright pumpkin with stem, radius 1. `face` adds a glowing carved face as a second geometry. */
export function pumpkinWithStem(color: number = COLORS.pumpkin): THREE.BufferGeometry {
  return new PartBuilder()
    .add(pumpkinGeometry(), color)
    .add(new THREE.CylinderGeometry(0.08, 0.13, 0.4, 6), COLORS.stem, { pos: [0.03, 0.88, 0], rot: [0, 0, -0.25] })
    .add(new THREE.SphereGeometry(0.12, 6, 4), COLORS.stem, { pos: [0.16, 1.02, 0.05], scale: [1.4, 0.5, 0.8] })
    .build();
}

/** Classic three-band candy corn, about 1 unit tall, base at y=0. */
export function candyCornGeometry(): THREE.BufferGeometry {
  const b = new PartBuilder();
  const flat: [number, number, number] = [1, 1, 0.62];
  b.add(new THREE.CylinderGeometry(0.4, 0.5, 0.36, 8), COLORS.candyYellow, { pos: [0, 0.18, 0], scale: flat });
  b.add(new THREE.CylinderGeometry(0.24, 0.4, 0.36, 8), COLORS.candyOrange, { pos: [0, 0.54, 0], scale: flat });
  b.add(new THREE.CylinderGeometry(0.03, 0.24, 0.3, 8), COLORS.candyWhite, { pos: [0, 0.87, 0], scale: flat });
  b.add(new THREE.SphereGeometry(0.5, 8, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), COLORS.candyYellow, {
    pos: [0, 0.0, 0],
    scale: [1, 0.12, 0.62],
  });
  return b.build();
}

/** Flat swirl disc with per-face colours, radius 1, facing ±z. */
function swirlDisc(colors: number[], thickness: number): THREE.BufferGeometry {
  const rings = 6;
  const segs = 36;
  const twist = 2.4;
  const positions: number[] = [];
  const cols: number[] = [];
  const c = new THREE.Color();
  const palette = colors.map((h) => new THREE.Color(h));
  const pushTri = (a: number[], bb: number[], cc: number[], col: THREE.Color) => {
    positions.push(...a, ...bb, ...cc);
    for (let k = 0; k < 3; k++) cols.push(col.r, col.g, col.b);
  };
  for (const side of [1, -1]) {
    const z = (side * thickness) / 2;
    for (let r = 0; r < rings; r++) {
      const r0 = r / rings;
      const r1 = (r + 1) / rings;
      for (let s = 0; s < segs; s++) {
        const a0 = (s / segs) * Math.PI * 2;
        const a1 = ((s + 1) / segs) * Math.PI * 2;
        const band = Math.floor(((a0 + a1) / 2 / (Math.PI * 2)) * colors.length * 2 + ((r0 + r1) / 2) * twist * colors.length);
        c.copy(palette[((band % palette.length) + palette.length) % palette.length] as THREE.Color);
        const p00 = [Math.cos(a0) * r0, Math.sin(a0) * r0, z];
        const p01 = [Math.cos(a1) * r0, Math.sin(a1) * r0, z];
        const p10 = [Math.cos(a0) * r1, Math.sin(a0) * r1, z];
        const p11 = [Math.cos(a1) * r1, Math.sin(a1) * r1, z];
        if (side > 0) {
          pushTri(p00, p10, p11, c);
          if (r > 0) pushTri(p00, p11, p01, c);
        } else {
          pushTri(p00, p11, p10, c);
          if (r > 0) pushTri(p00, p01, p11, c);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}

/** Lollipop: swirl disc on a white stick. Disc centre at origin, stick hangs down. */
export function suckerGeometry(): THREE.BufferGeometry {
  const b = new PartBuilder();
  b.addColored(swirlDisc([COLORS.candyOrange, COLORS.candyWhite, COLORS.purple, COLORS.candyWhite], 0.22), { scale: 0.5 });
  b.add(new THREE.CylinderGeometry(0.5, 0.5, 0.11, 36, 1, true), COLORS.candyOrange, { rot: [Math.PI / 2, 0, 0] });
  b.add(new THREE.CylinderGeometry(0.035, 0.035, 0.95, 6), COLORS.candyWhite, { pos: [0, -0.9, 0] });
  // Little ribbon bow where the stick meets the candy.
  b.add(new THREE.ConeGeometry(0.1, 0.18, 4), COLORS.purple, { pos: [-0.09, -0.52, 0], rot: [0, 0, Math.PI / 2] });
  b.add(new THREE.ConeGeometry(0.1, 0.18, 4), COLORS.purple, { pos: [0.09, -0.52, 0], rot: [0, 0, -Math.PI / 2] });
  return b.build();
}

/** "!" warning marker (unit height), used above a spider preparing to throw. */
export function exclamationGeometry(): THREE.BufferGeometry {
  return new PartBuilder()
    .add(new THREE.CylinderGeometry(0.09, 0.05, 0.55, 6), 0xffe14d, { pos: [0, 0.45, 0] })
    .add(new THREE.SphereGeometry(0.08, 8, 6), 0xffe14d, { pos: [0, 0.06, 0] })
    .build();
}
