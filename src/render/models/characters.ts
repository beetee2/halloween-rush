import * as THREE from 'three';
import { PartBuilder } from '../builder';
import { materials } from '../materials';
import {
  COLORS,
  candyCornGeometry,
  exclamationGeometry,
  jackFaceGeometry,
  pumpkinGeometry,
  pumpkinWithStem,
  suckerGeometry,
} from './shapes';

/**
 * Procedural low-poly characters. Geometry for each rigid part is merged once and shared
 * by every instance; instances are just small groups of meshes that can be animated.
 */

const SKIN_GREEN = 0x8fd46a;
const SKIN_GREEN_DARK = 0x5f9e43;
const JACKET = 0x4a3a78;
const PANTS = 0x2f3550;
const BOOT = 0x241a1a;
const HAIR = 0x16121c;
const BOLT = 0xb8c0cc;
const EYE_WHITE = 0xfbfbf2;
const PUPIL = 0x141018;

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const sphere = (r: number, w = 12, h = 8) => new THREE.SphereGeometry(r, w, h);
const cyl = (rt: number, rb: number, h: number, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s);
const cone = (r: number, h: number, s = 8) => new THREE.ConeGeometry(r, h, s);

interface FrankGeoms {
  head: THREE.BufferGeometry;
  torso: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;
  leg: THREE.BufferGeometry;
}

interface WitchGeoms {
  body: THREE.BufferGeometry;
  cape: THREE.BufferGeometry;
  hat: THREE.BufferGeometry;
}

interface SpiderGeoms {
  body: THREE.BufferGeometry;
  legsLeft: THREE.BufferGeometry;
  legsRight: THREE.BufferGeometry;
  frontLeg: THREE.BufferGeometry;
  web: THREE.BufferGeometry;
  thread: THREE.BufferGeometry;
}

export interface FrankInstance {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Mesh;
  armL: THREE.Mesh;
  armR: THREE.Mesh;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
}

export interface WitchInstance {
  root: THREE.Group;
  rider: THREE.Group;
  cape: THREE.Mesh;
  hat: THREE.Mesh;
}

export interface SpiderInstance {
  root: THREE.Group;
  body: THREE.Group;
  legsLeft: THREE.Mesh;
  legsRight: THREE.Mesh;
  frontL: THREE.Mesh;
  frontR: THREE.Mesh;
  glow: THREE.Sprite;
  marker: THREE.Mesh;
  /** Thread hangs from the anchor; lives in world space next to the spider. */
  thread: THREE.Mesh;
  web: THREE.Mesh;
}

export interface JackInstance {
  root: THREE.Group;
  ring: THREE.Sprite;
}

export type MiniKind = 'frankenstein' | 'witch' | 'spider' | 'pumpkin' | 'candyCorn' | 'sucker';

export class ModelLibrary {
  private frankG?: FrankGeoms;
  private witchG?: WitchGeoms;
  private spiderG?: SpiderGeoms;
  private pumpkinG?: THREE.BufferGeometry;
  private jackFaceG?: THREE.BufferGeometry;
  private candyCornG?: THREE.BufferGeometry;
  private suckerG?: THREE.BufferGeometry;
  private exclaimG?: THREE.BufferGeometry;
  private miniG = new Map<MiniKind, THREE.BufferGeometry>();
  readonly shadowGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

  // ---------------------------------------------------------------- Frankenstein
  private frankGeoms(): FrankGeoms {
    if (this.frankG) return this.frankG;
    // Head: pivot at the neck (y=0 is the neck joint).
    const head = new PartBuilder()
      .add(box(0.64, 0.7, 0.6), SKIN_GREEN, { pos: [0, 0.42, 0] })
      .add(box(0.7, 0.16, 0.66), HAIR, { pos: [0, 0.82, 0] })
      // Jagged fringe
      .add(box(0.14, 0.14, 0.06), HAIR, { pos: [-0.22, 0.72, 0.31], rot: [0, 0, 0.3] })
      .add(box(0.14, 0.16, 0.06), HAIR, { pos: [-0.05, 0.71, 0.31], rot: [0, 0, -0.2] })
      .add(box(0.14, 0.13, 0.06), HAIR, { pos: [0.12, 0.72, 0.31], rot: [0, 0, 0.25] })
      .add(box(0.12, 0.15, 0.06), HAIR, { pos: [0.26, 0.71, 0.31], rot: [0, 0, -0.3] })
      // Heavy brow
      .add(box(0.58, 0.08, 0.1), SKIN_GREEN_DARK, { pos: [0, 0.55, 0.3] })
      // Goofy mismatched eyes
      .add(sphere(0.085), EYE_WHITE, { pos: [-0.14, 0.45, 0.3] })
      .add(sphere(0.07), EYE_WHITE, { pos: [0.15, 0.46, 0.3] })
      .add(sphere(0.035, 8, 6), PUPIL, { pos: [-0.12, 0.44, 0.38] })
      .add(sphere(0.03, 8, 6), PUPIL, { pos: [0.17, 0.47, 0.36] })
      // Nose, stitched grin, forehead scar
      .add(box(0.08, 0.12, 0.08), SKIN_GREEN_DARK, { pos: [0, 0.35, 0.33] })
      .add(box(0.36, 0.05, 0.04), PUPIL, { pos: [0, 0.21, 0.31], rot: [0, 0, 0.08] })
      .add(box(0.03, 0.1, 0.03), PUPIL, { pos: [-0.12, 0.21, 0.32] })
      .add(box(0.03, 0.1, 0.03), PUPIL, { pos: [0, 0.22, 0.32] })
      .add(box(0.03, 0.1, 0.03), PUPIL, { pos: [0.12, 0.23, 0.32] })
      .add(box(0.2, 0.03, 0.03), 0x3c6b2c, { pos: [0.12, 0.64, 0.31], rot: [0, 0, -0.3] })
      // Neck and bolts
      .add(cyl(0.16, 0.18, 0.18, 8), SKIN_GREEN_DARK, { pos: [0, 0.05, 0] })
      .add(cyl(0.05, 0.05, 0.24, 8), BOLT, { pos: [-0.3, 0.12, 0], rot: [0, 0, Math.PI / 2] })
      .add(cyl(0.05, 0.05, 0.24, 8), BOLT, { pos: [0.3, 0.12, 0], rot: [0, 0, Math.PI / 2] })
      .add(cyl(0.075, 0.075, 0.05, 6), BOLT, { pos: [-0.43, 0.12, 0], rot: [0, 0, Math.PI / 2] })
      .add(cyl(0.075, 0.075, 0.05, 6), BOLT, { pos: [0.43, 0.12, 0], rot: [0, 0, Math.PI / 2] })
      .build();
    // Torso: from hips (y=0) up to shoulders.
    const torso = new PartBuilder()
      .add(box(0.95, 0.95, 0.5), JACKET, { pos: [0, 0.5, 0] })
      .add(box(0.36, 0.8, 0.04), 0x9aa06a, { pos: [0, 0.52, 0.25] })
      .add(box(0.16, 0.5, 0.05), 0x5c4a92, { pos: [-0.24, 0.72, 0.26], rot: [0, 0, 0.35] })
      .add(box(0.16, 0.5, 0.05), 0x5c4a92, { pos: [0.24, 0.72, 0.26], rot: [0, 0, -0.35] })
      .add(box(0.98, 0.12, 0.54), 0x2a2030, { pos: [0, 0.06, 0] })
      .add(box(0.16, 0.1, 0.05), 0xd8b84a, { pos: [0, 0.06, 0.27] })
      // Patch on the jacket
      .add(box(0.18, 0.16, 0.03), 0xff8a1c, { pos: [0.3, 0.3, 0.26], rot: [0, 0, 0.2] })
      .build();
    // Arm: pivot at the shoulder, reaching forward (+z) zombie style.
    const arm = new PartBuilder()
      .add(box(0.26, 0.26, 0.72), JACKET, { pos: [0, 0, 0.3] })
      .add(box(0.3, 0.3, 0.12), 0x3a2d60, { pos: [0, 0, 0.62] })
      .add(box(0.2, 0.18, 0.24), SKIN_GREEN, { pos: [0, -0.02, 0.8] })
      .add(box(0.2, 0.06, 0.12), SKIN_GREEN, { pos: [0, -0.02, 0.96] })
      .build();
    // Leg: pivot at the hip, hanging down.
    const leg = new PartBuilder()
      .add(box(0.32, 0.86, 0.34), PANTS, { pos: [0, -0.43, 0] })
      .add(box(0.4, 0.24, 0.5), BOOT, { pos: [0, -0.86, 0.06] })
      .add(box(0.42, 0.06, 0.54), 0x3b2b2b, { pos: [0, -0.97, 0.06] })
      .build();
    this.frankG = { head, torso, arm, leg };
    return this.frankG;
  }

  frankenstein(): FrankInstance {
    const g = this.frankGeoms();
    const m = materials().lit;
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const hipY = 0.98;
    const torso = new THREE.Mesh(g.torso, m);
    torso.position.y = hipY;
    const head = new THREE.Mesh(g.head, m);
    head.position.y = hipY + 0.95;
    const armL = new THREE.Mesh(g.arm, m);
    armL.position.set(-0.6, hipY + 0.8, 0);
    const armR = new THREE.Mesh(g.arm, m);
    armR.position.set(0.6, hipY + 0.8, 0);
    const legL = new THREE.Mesh(g.leg, m);
    legL.position.set(-0.22, hipY, 0);
    const legR = new THREE.Mesh(g.leg, m);
    legR.position.set(0.22, hipY, 0);
    body.add(torso, head, armL, armR, legL, legR);
    root.add(this.shadow(1.3));
    return { root, body, head, armL, armR, legL, legR };
  }

  // ---------------------------------------------------------------- Witch
  private witchGeoms(): WitchGeoms {
    if (this.witchG) return this.witchG;
    const ROBE = 0x6a2fa0;
    const STRAW = 0xe8b04a;
    const body = new PartBuilder()
      // Broom along z (forward is +z)
      .add(cyl(0.045, 0.045, 2.4, 6), 0x7a4a24, { pos: [0, 0, 0.1], rot: [Math.PI / 2, 0, 0] })
      .add(cone(0.3, 0.75, 10), STRAW, { pos: [0, 0, -1.35], rot: [Math.PI / 2, 0, 0] })
      .add(cyl(0.12, 0.12, 0.1, 8), 0xc0392b, { pos: [0, 0, -0.98], rot: [Math.PI / 2, 0, 0] })
      // Robe (seated)
      .add(cyl(0.2, 0.42, 0.85, 10), ROBE, { pos: [0, 0.42, -0.05] })
      .add(cyl(0.44, 0.44, 0.06, 10), 0x9b59d0, { pos: [0, 0.02, -0.05] })
      // Striped stockings + pointy shoes reaching forward
      .add(cyl(0.07, 0.07, 0.55, 6), 0xff8a1c, { pos: [-0.12, 0.05, 0.4], rot: [Math.PI / 2 - 0.3, 0, 0] })
      .add(cyl(0.07, 0.07, 0.55, 6), 0xff8a1c, { pos: [0.12, 0.05, 0.4], rot: [Math.PI / 2 - 0.3, 0, 0] })
      .add(cyl(0.075, 0.075, 0.12, 6), HAIR, { pos: [-0.12, 0.02, 0.5], rot: [Math.PI / 2 - 0.3, 0, 0] })
      .add(cyl(0.075, 0.075, 0.12, 6), HAIR, { pos: [0.12, 0.02, 0.5], rot: [Math.PI / 2 - 0.3, 0, 0] })
      .add(cone(0.08, 0.3, 6), HAIR, { pos: [-0.12, -0.08, 0.78], rot: [Math.PI / 2 + 0.3, 0, 0] })
      .add(cone(0.08, 0.3, 6), HAIR, { pos: [0.12, -0.08, 0.78], rot: [Math.PI / 2 + 0.3, 0, 0] })
      // Arms gripping the broom
      .add(box(0.12, 0.12, 0.5), ROBE, { pos: [-0.2, 0.5, 0.25], rot: [0.7, 0, 0] })
      .add(box(0.12, 0.12, 0.5), ROBE, { pos: [0.2, 0.5, 0.25], rot: [0.7, 0, 0] })
      .add(sphere(0.08), SKIN_GREEN, { pos: [-0.12, 0.08, 0.48] })
      .add(sphere(0.08), SKIN_GREEN, { pos: [0.12, 0.08, 0.48] })
      // Head
      .add(sphere(0.25, 14, 10), SKIN_GREEN, { pos: [0, 1.05, 0.02] })
      .add(cone(0.07, 0.34, 8), SKIN_GREEN_DARK, { pos: [0, 1.0, 0.34], rot: [Math.PI / 2 + 0.35, 0, 0] })
      .add(sphere(0.035, 6, 4), 0x4e8a34, { pos: [0.04, 0.95, 0.4] })
      .add(sphere(0.06, 8, 6), EYE_WHITE, { pos: [-0.09, 1.12, 0.21] })
      .add(sphere(0.06, 8, 6), EYE_WHITE, { pos: [0.09, 1.12, 0.21] })
      .add(sphere(0.03, 6, 4), PUPIL, { pos: [-0.08, 1.12, 0.26] })
      .add(sphere(0.03, 6, 4), PUPIL, { pos: [0.1, 1.12, 0.26] })
      .add(box(0.2, 0.05, 0.05), 0x3a1030, { pos: [0, 0.9, 0.22], rot: [0.2, 0, 0] })
      // Wild orange hair
      .add(box(0.5, 0.36, 0.1), 0xff6a13, { pos: [0, 1.05, -0.2], rot: [0.3, 0, 0] })
      .add(box(0.14, 0.4, 0.1), 0xff6a13, { pos: [-0.25, 0.92, -0.05], rot: [0, 0, 0.4] })
      .add(box(0.14, 0.4, 0.1), 0xff6a13, { pos: [0.25, 0.92, -0.05], rot: [0, 0, -0.4] })
      .build();
    const cape = new PartBuilder()
      .add(box(0.62, 0.9, 0.05), 0x2b1340, { pos: [0, -0.45, 0] })
      .add(box(0.5, 0.2, 0.05), 0x2b1340, { pos: [0, -0.95, -0.04], rot: [0.3, 0, 0] })
      .build();
    // Hat: pivot at the brim.
    const hat = new PartBuilder()
      .add(cyl(0.48, 0.48, 0.04, 16), HAIR, { pos: [0, 0, 0] })
      .add(cyl(0.2, 0.26, 0.12, 12), 0xff8a1c, { pos: [0, 0.07, 0] })
      .add(box(0.1, 0.09, 0.02), 0xffd23a, { pos: [0, 0.07, 0.26] })
      .add(cyl(0.12, 0.25, 0.4, 12), HAIR, { pos: [0, 0.3, 0] })
      .add(cone(0.12, 0.4, 12), HAIR, { pos: [0.06, 0.66, -0.06], rot: [-0.35, 0, -0.3] })
      .build();
    this.witchG = { body, cape, hat };
    return this.witchG;
  }

  witch(): WitchInstance {
    const g = this.witchGeoms();
    const m = materials().lit;
    const root = new THREE.Group();
    const rider = new THREE.Group();
    root.add(rider);
    rider.add(new THREE.Mesh(g.body, m));
    const cape = new THREE.Mesh(g.cape, m);
    cape.position.set(0, 0.85, -0.2);
    cape.rotation.x = 0.5;
    const hat = new THREE.Mesh(g.hat, m);
    hat.position.set(0, 1.22, 0);
    hat.rotation.x = -0.15;
    rider.add(cape, hat);
    return { root, rider, cape, hat };
  }

  // ---------------------------------------------------------------- Spider
  private spiderGeoms(): SpiderGeoms {
    if (this.spiderG) return this.spiderG;
    const BODY = 0x3a1f55;
    const BODY_LIGHT = 0x5a3380;
    const STRIPE = 0xff8a1c;
    const LEG = 0x22142e;
    const body = new PartBuilder()
      .add(sphere(0.3, 14, 10), BODY, { pos: [0, 0.02, -0.2], scale: [1, 0.85, 1.1] })
      .add(sphere(0.2, 12, 8), STRIPE, { pos: [0, 0.2, -0.22], scale: [0.9, 0.25, 1.1] })
      .add(sphere(0.12, 10, 6), 0xffd23a, { pos: [0, 0.26, -0.2], scale: [1, 0.2, 0.7] })
      .add(sphere(0.2, 12, 8), BODY_LIGHT, { pos: [0, 0.02, 0.12] })
      // Big goofy eyes + small eyes
      .add(sphere(0.085, 10, 8), EYE_WHITE, { pos: [-0.08, 0.1, 0.27] })
      .add(sphere(0.085, 10, 8), EYE_WHITE, { pos: [0.08, 0.1, 0.27] })
      .add(sphere(0.04, 8, 6), PUPIL, { pos: [-0.07, 0.09, 0.35] })
      .add(sphere(0.04, 8, 6), PUPIL, { pos: [0.07, 0.09, 0.35] })
      .add(sphere(0.025, 6, 4), 0xff3b3b, { pos: [-0.14, 0.17, 0.2] })
      .add(sphere(0.025, 6, 4), 0xff3b3b, { pos: [0.14, 0.17, 0.2] })
      // Fangs
      .add(cone(0.025, 0.09, 5), EYE_WHITE, { pos: [-0.04, -0.07, 0.29], rot: [Math.PI, 0, 0] })
      .add(cone(0.025, 0.09, 5), EYE_WHITE, { pos: [0.04, -0.07, 0.29], rot: [Math.PI, 0, 0] })
      .build();
    const leg = (side: 1 | -1, angle: number, b: PartBuilder) => {
      // Upper segment rises outward, lower segment drops down.
      const dirX = Math.cos(angle) * side;
      const dirZ = Math.sin(angle);
      const knee = new THREE.Vector3(dirX * 0.34, 0.2, dirZ * 0.34);
      const foot = new THREE.Vector3(dirX * 0.58, -0.22, dirZ * 0.58);
      const hip = new THREE.Vector3(dirX * 0.1, 0.02, dirZ * 0.1 - 0.02);
      addSegment(b, hip, knee, 0.03, LEG);
      addSegment(b, knee, foot, 0.024, LEG);
    };
    const legsLeft = new PartBuilder();
    const legsRight = new PartBuilder();
    for (const a of [0.15, -0.35, -0.85]) {
      leg(-1, a, legsLeft);
      leg(1, a, legsRight);
    }
    const front = new PartBuilder();
    leg(1, 0.65, front);
    const web = new PartBuilder();
    const spokes = 8;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      web.add(box(0.02, 0.9, 0.01), 0xeeeeff, { pos: [Math.sin(a) * 0.45, Math.cos(a) * 0.45, 0], rot: [0, 0, -a] });
    }
    for (const r of [0.18, 0.34, 0.5, 0.66, 0.82]) {
      for (let i = 0; i < spokes; i++) {
        const a0 = (i / spokes) * Math.PI * 2;
        const a1 = ((i + 1) / spokes) * Math.PI * 2;
        const p0 = new THREE.Vector3(Math.sin(a0) * r, Math.cos(a0) * r, 0);
        const p1 = new THREE.Vector3(Math.sin(a1) * r, Math.cos(a1) * r, 0);
        addSegment(web, p0, p1, 0.008, 0xeeeeff);
      }
    }
    const thread = new THREE.CylinderGeometry(0.018, 0.018, 1, 4).translate(0, -0.5, 0);
    this.spiderG = {
      body,
      legsLeft: legsLeft.build(),
      legsRight: legsRight.build(),
      frontLeg: front.build(),
      web: web.build(),
      thread,
    };
    return this.spiderG;
  }

  spider(): SpiderInstance {
    const g = this.spiderGeoms();
    const mats = materials();
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    body.add(new THREE.Mesh(g.body, mats.lit));
    const legsLeft = new THREE.Mesh(g.legsLeft, mats.lit);
    const legsRight = new THREE.Mesh(g.legsRight, mats.lit);
    const frontR = new THREE.Mesh(g.frontLeg, mats.lit);
    const frontL = new THREE.Mesh(g.frontLeg, mats.lit);
    frontL.scale.x = -1;
    body.add(legsLeft, legsRight, frontL, frontR);
    const glow = new THREE.Sprite(mats.spiderGlow);
    glow.visible = false;
    const marker = new THREE.Mesh(this.exclamation(), mats.glow);
    marker.position.y = 0.55;
    marker.scale.setScalar(0.9);
    marker.visible = false;
    body.add(marker);
    const thread = new THREE.Mesh(g.thread, mats.glow);
    const web = new THREE.Mesh(g.web, mats.glow);
    return { root, body, legsLeft, legsRight, frontL, frontR, glow, marker, thread, web };
  }

  // ---------------------------------------------------------------- Pumpkins & candy
  pumpkinGeometry(): THREE.BufferGeometry {
    if (!this.pumpkinG) this.pumpkinG = pumpkinWithStem();
    return this.pumpkinG;
  }

  private jackFace(): THREE.BufferGeometry {
    if (!this.jackFaceG) this.jackFaceG = jackFaceGeometry();
    return this.jackFaceG;
  }

  /** Carved glowing jack-o'-lantern, radius 1 (scale the root). */
  jackOLantern(): JackInstance {
    const mats = materials();
    const root = new THREE.Group();
    root.add(new THREE.Mesh(this.pumpkinGeometry(), mats.lit));
    root.add(new THREE.Mesh(this.jackFace(), mats.glow));
    const ring = new THREE.Sprite(mats.warnRing);
    ring.scale.setScalar(3.2);
    ring.renderOrder = 10;
    root.add(ring);
    return { root, ring };
  }

  /** Small uncarved pumpkin used as the player's projectile. */
  projectile(): THREE.Mesh {
    return new THREE.Mesh(this.pumpkinGeometry(), materials().lit);
  }

  candyCornGeometry(): THREE.BufferGeometry {
    if (!this.candyCornG) this.candyCornG = candyCornGeometry();
    return this.candyCornG;
  }

  suckerGeometry(): THREE.BufferGeometry {
    if (!this.suckerG) this.suckerG = suckerGeometry();
    return this.suckerG;
  }

  exclamation(): THREE.BufferGeometry {
    if (!this.exclaimG) this.exclaimG = exclamationGeometry();
    return this.exclaimG;
  }

  shadow(size: number): THREE.Mesh {
    const s = new THREE.Mesh(this.shadowGeometry, materials().shadow);
    s.scale.set(size, 1, size);
    s.position.y = 0.02;
    s.renderOrder = -1;
    return s;
  }

  /**
   * Miniature candy geometry for the bag, ~1 unit across. Each shot target type has its
   * own recognizable candy shape.
   */
  miniGeometry(kind: MiniKind): THREE.BufferGeometry {
    const cached = this.miniG.get(kind);
    if (cached) return cached;
    let g: THREE.BufferGeometry;
    switch (kind) {
      case 'frankenstein':
        g = new PartBuilder()
          .add(box(0.7, 0.8, 0.5), SKIN_GREEN, { pos: [0, 0, 0] })
          .add(box(0.74, 0.2, 0.54), HAIR, { pos: [0, 0.45, 0] })
          .add(box(0.2, 0.12, 0.08), HAIR, { pos: [-0.15, 0.3, 0.26] })
          .add(box(0.2, 0.12, 0.08), HAIR, { pos: [0.17, 0.3, 0.26] })
          .add(sphere(0.1, 8, 6), EYE_WHITE, { pos: [-0.16, 0.08, 0.25] })
          .add(sphere(0.1, 8, 6), EYE_WHITE, { pos: [0.16, 0.08, 0.25] })
          .add(sphere(0.05, 6, 4), PUPIL, { pos: [-0.16, 0.08, 0.33] })
          .add(sphere(0.05, 6, 4), PUPIL, { pos: [0.16, 0.08, 0.33] })
          .add(box(0.4, 0.06, 0.05), PUPIL, { pos: [0, -0.22, 0.26] })
          .add(cyl(0.07, 0.07, 1.0, 6), BOLT, { pos: [0, -0.3, 0], rot: [0, 0, Math.PI / 2] })
          .build();
        break;
      case 'witch':
        g = new PartBuilder()
          .add(sphere(0.34, 12, 8), SKIN_GREEN, { pos: [0, -0.1, 0] })
          .add(cone(0.1, 0.3, 6), SKIN_GREEN_DARK, { pos: [0, -0.12, 0.38], rot: [Math.PI / 2, 0, 0] })
          .add(sphere(0.07, 6, 4), EYE_WHITE, { pos: [-0.12, 0.0, 0.29] })
          .add(sphere(0.07, 6, 4), EYE_WHITE, { pos: [0.12, 0.0, 0.29] })
          .add(cyl(0.6, 0.6, 0.06, 14), 0x2b1340, { pos: [0, 0.2, 0] })
          .add(cyl(0.3, 0.33, 0.12, 12), 0xff8a1c, { pos: [0, 0.28, 0] })
          .add(cone(0.3, 0.75, 12), 0x2b1340, { pos: [0.05, 0.68, 0], rot: [0, 0, -0.2] })
          .build();
        break;
      case 'spider': {
        const b = new PartBuilder()
          .add(sphere(0.34, 12, 8), 0x2a1838, { pos: [0, 0, -0.08] })
          .add(sphere(0.22, 10, 6), 0x5a3380, { pos: [0, 0, 0.26] })
          .add(sphere(0.2, 8, 6), 0xff8a1c, { pos: [0, 0.22, -0.1], scale: [1, 0.3, 1.2] })
          .add(sphere(0.09, 8, 6), EYE_WHITE, { pos: [-0.09, 0.08, 0.43] })
          .add(sphere(0.09, 8, 6), EYE_WHITE, { pos: [0.09, 0.08, 0.43] });
        for (const side of [-1, 1] as const) {
          for (const a of [0.5, 0.1, -0.3, -0.7]) {
            const dir = new THREE.Vector3(Math.cos(a) * side, 0, Math.sin(a));
            addSegment(b, dir.clone().multiplyScalar(0.15), dir.clone().multiplyScalar(0.62).setY(-0.18), 0.05, 0x2a1838);
          }
        }
        g = b.build();
        break;
      }
      case 'pumpkin':
        g = new PartBuilder().add(pumpkinGeometry(8, 12, 8), COLORS.pumpkin, { scale: 0.5 })
          .add(cyl(0.06, 0.09, 0.25, 5), COLORS.stem, { pos: [0, 0.45, 0] })
          .add(new THREE.SphereGeometry(0.12, 6, 4), COLORS.stem, { pos: [0.1, 0.5, 0], scale: [1.4, 0.4, 0.8] })
          .build();
        break;
      case 'candyCorn':
        g = new PartBuilder().addColored(this.candyCornGeometry(), { pos: [0, -0.45, 0] }).build();
        break;
      case 'sucker':
        g = new PartBuilder().addColored(this.suckerGeometry(), { pos: [0, 0.3, 0], scale: 0.62 }).build();
        break;
    }
    this.miniG.set(kind, g);
    return g;
  }
}

/** Add a thin cylinder between two points. */
export function addSegment(b: PartBuilder, a: THREE.Vector3, c: THREE.Vector3, radius: number, color: number): void {
  const dir = new THREE.Vector3().subVectors(c, a);
  const len = dir.length();
  const geom = new THREE.CylinderGeometry(radius, radius, len, 5);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  const e = new THREE.Euler().setFromQuaternion(q);
  const mid = new THREE.Vector3().addVectors(a, c).multiplyScalar(0.5);
  b.add(geom, color, { pos: [mid.x, mid.y, mid.z], rot: [e.x, e.y, e.z] });
}
