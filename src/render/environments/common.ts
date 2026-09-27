import * as THREE from 'three';
import { CONFIG } from '../../config';
import type { Aabb } from '../../core/collision';
import { PartBuilder, ResourceTracker, type PartOptions, type V3 } from '../builder';
import { materials } from '../materials';
import { softDotTexture } from '../textures';
import { addSegment } from '../models/characters';
import { COLORS, jackFaceGeometry, pumpkinGeometry } from '../models/shapes';

export interface FrankLane {
  z: number;
  xMin: number;
  xMax: number;
}

export interface WitchLane {
  y: number;
  z: number;
  xMin: number;
  xMax: number;
}

export interface SpiderAnchor {
  x: number;
  y: number;
  z: number;
  /** Lowest the spider may hang (keeps it above porch roofs, gates, etc.). */
  minHang?: number;
}

export interface EnvironmentLayout {
  frankLanes: FrankLane[];
  witchLanes: WitchLane[];
  /** Points spiders descend from (roof eaves, branches, light strings...). */
  spiderAnchors: SpiderAnchor[];
  /** Ground spots where candy targets pop up or get tossed from. */
  candySpots: Array<{ x: number; z: number }>;
  /** Solid scenery that stops pumpkin shots. The ground plane (y=0) always blocks. */
  blockers: Aabb[];
}

export interface Environment {
  id: string;
  name: string;
  group: THREE.Group;
  layout: EnvironmentLayout;
  fog: { color: number; near: number; far: number };
  update(time: number): void;
  dispose(): void;
}

export interface SkyColors {
  top: number;
  horizon: number;
  bottom: number;
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitPlane = new THREE.PlaneGeometry(1, 1);
const eyePoint = new THREE.Vector3(...CONFIG.camera.position);

/**
 * Helper for authoring an environment: static props go into two merged vertex-coloured
 * batches (lit + glow = two draw calls), dynamic pieces are tracked for animation, and
 * every GPU resource created here is disposed with the environment.
 */
export class EnvBuilder {
  readonly group = new THREE.Group();
  readonly lit = new PartBuilder();
  readonly glow = new PartBuilder();
  readonly tracker = new ResourceTracker();
  readonly blockers: Aabb[] = [];
  private animators: Array<(t: number) => void> = [];

  constructor(readonly id: string) {
    this.group.name = `env-${id}`;
  }

  // ------------------------------------------------------------------ primitives
  box(size: V3, color: number, opts: PartOptions = {}, layer: 'lit' | 'glow' = 'lit'): this {
    (layer === 'lit' ? this.lit : this.glow).add(unitBox, color, { ...opts, scale: scaleMul(size, opts.scale) });
    return this;
  }

  add(geom: THREE.BufferGeometry, color: number, opts: PartOptions = {}, layer: 'lit' | 'glow' = 'lit'): this {
    (layer === 'lit' ? this.lit : this.glow).add(geom, color, opts);
    return this;
  }

  segment(a: V3, b: V3, radius: number, color: number): this {
    addSegment(this.lit, new THREE.Vector3(...a), new THREE.Vector3(...b), radius, color);
    return this;
  }

  blocker(min: V3, max: V3): this {
    this.blockers.push({ min: { x: min[0], y: min[1], z: min[2] }, max: { x: max[0], y: max[1], z: max[2] } });
    return this;
  }

  /** Solid box that is also a projectile blocker (axis-aligned bounds). */
  solidBox(size: V3, color: number, pos: V3, rotY = 0): this {
    this.box(size, color, { pos, rot: [0, rotY, 0] });
    const hx = size[0] / 2;
    const hz = size[2] / 2;
    const c = Math.abs(Math.cos(rotY));
    const s = Math.abs(Math.sin(rotY));
    const ex = hx * c + hz * s;
    const ez = hx * s + hz * c;
    return this.blocker([pos[0] - ex, pos[1] - size[1] / 2, pos[2] - ez], [pos[0] + ex, pos[1] + size[1] / 2, pos[2] + ez]);
  }

  animate(fn: (t: number) => void): this {
    this.animators.push(fn);
    return this;
  }

  /** Add a standalone object (animated or transparent) owned by this environment. */
  object<T extends THREE.Object3D>(obj: T): T {
    this.group.add(obj);
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) this.tracker.track(mesh.geometry);
    });
    return obj;
  }

  // ------------------------------------------------------------------ scenery
  sky(colors: SkyColors): this {
    const geom = this.tracker.track(new THREE.SphereGeometry(190, 32, 16));
    const mat = this.tracker.track(
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: new THREE.Color(colors.top) },
          horizon: { value: new THREE.Color(colors.horizon) },
          bottom: { value: new THREE.Color(colors.bottom) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 top;
          uniform vec3 horizon;
          uniform vec3 bottom;
          varying vec3 vDir;
          void main() {
            float h = vDir.y;
            vec3 c = h > 0.0
              ? mix(horizon, top, pow(smoothstep(0.0, 0.85, h), 0.7))
              : mix(horizon, bottom, smoothstep(0.0, -0.25, h));
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    const dome = new THREE.Mesh(geom, mat);
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.group.add(dome);
    return this;
  }

  stars(count: number, seed = 1, color = 0xfff8e0): this {
    const rand = mulberry(seed);
    const pts: number[] = [];
    for (let i = 0; i < count; i++) {
      const az = rand() * Math.PI * 2;
      const el = 0.12 + rand() * 1.3;
      const r = 170;
      pts.push(Math.cos(az) * Math.cos(el) * r, Math.sin(el) * r, Math.sin(az) * Math.cos(el) * r);
    }
    const geom = this.tracker.track(new THREE.BufferGeometry());
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const mat = this.tracker.track(new THREE.PointsMaterial({ color, size: 2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
    const points = new THREE.Points(geom, mat);
    points.renderOrder = -9;
    this.group.add(points);
    return this;
  }

  moon(pos: V3, radius: number, color: number, haloColor = 0xfff1b0, haloScale = 5): this {
    const geom = this.tracker.track(new THREE.SphereGeometry(radius, 20, 14));
    const mat = this.tracker.track(new THREE.MeshBasicMaterial({ color, fog: false }));
    const moon = new THREE.Mesh(geom, mat);
    moon.position.set(...pos);
    this.group.add(moon);
    const haloMat = this.tracker.track(
      new THREE.MeshBasicMaterial({ map: softDotTexture(), color: haloColor, opacity: 0.55, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
    );
    this.group.add(eyeCard(haloMat, pos, radius * haloScale));
    return this;
  }

  ground(color: number, radius = 140): this {
    // Keep the fan centre and rim vertices off the camera's axes. A vertex straight below the
    // eye has clip-space w = 0 at zero pitch (every level starts there); SwiftShader, Chrome's
    // software renderer, then smears the fan over the lower half of the view.
    this.lit.add(new THREE.CircleGeometry(radius, 40, Math.PI / 40), color, { pos: [0, 0, -12], rot: [-Math.PI / 2, 0, 0] });
    return this;
  }

  /** Flat coloured patch lying on the ground (paths, dirt, puddles of light). */
  patch(x: number, z: number, rx: number, rz: number, color: number, y = 0.01, rotY = 0): this {
    this.lit.add(new THREE.CircleGeometry(1, 18), color, { pos: [x, y, z], rot: [-Math.PI / 2, 0, rotY], scale: [rx, rz, 1] });
    return this;
  }

  /** Ring of distant silhouette hills behind the play area. */
  hills(color: number, seed = 3, count = 11, distance = 95): this {
    const rand = mulberry(seed);
    for (let i = 0; i < count; i++) {
      const a = Math.PI * (0.05 + (0.9 * i) / (count - 1)) + (rand() - 0.5) * 0.1;
      const r = distance + rand() * 20;
      const x = Math.cos(a) * r;
      const z = -Math.sin(a) * r;
      const w = 22 + rand() * 25;
      const h = 8 + rand() * 12;
      this.lit.add(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), color, { pos: [x, -1, z], scale: [w, h, w * 0.6] });
    }
    return this;
  }

  lights(opts: { sky: number; ground: number; hemi: number; moon: number; moonIntensity: number; moonDir: V3; fill?: number; fillIntensity?: number }): this {
    const hemi = new THREE.HemisphereLight(opts.sky, opts.ground, opts.hemi);
    const dir = new THREE.DirectionalLight(opts.moon, opts.moonIntensity);
    dir.position.set(...opts.moonDir);
    this.group.add(hemi, dir);
    if (opts.fill !== undefined) {
      // Soft frontal fill so characters facing the player stay readable.
      const fill = new THREE.DirectionalLight(opts.fill, opts.fillIntensity ?? 0.5);
      fill.position.set(0, 3, 10);
      this.group.add(fill);
    }
    return this;
  }

  /** Low drifting fog banks made from soft cards (see `eyeCard`). */
  fogBanks(count: number, color: number, opacity: number, area: { xMin: number; xMax: number; zMin: number; zMax: number }, seed = 7, height = 0.9): this {
    const rand = mulberry(seed);
    const mat = this.tracker.track(new THREE.MeshBasicMaterial({ map: softDotTexture(), color, transparent: true, opacity, depthWrite: false }));
    for (let i = 0; i < count; i++) {
      const x0 = area.xMin + rand() * (area.xMax - area.xMin);
      const z = area.zMin + rand() * (area.zMax - area.zMin);
      const w = 7 + rand() * 7;
      const s = eyeCard(mat, [x0, height * (0.5 + rand() * 0.6), z], w, w * 0.28);
      const speed = (0.2 + rand() * 0.35) * (rand() < 0.5 ? -1 : 1);
      const span = area.xMax - area.xMin;
      this.group.add(s);
      this.animate((t) => {
        let x = x0 + speed * t;
        x = area.xMin + ((((x - area.xMin) % span) + span) % span);
        s.position.x = x;
        s.lookAt(eyePoint);
      });
    }
    return this;
  }

  // ------------------------------------------------------------------ shared props
  bareTree(x: number, z: number, scale: number, color: number, seed: number, lean = 0): this {
    const rand = mulberry(seed);
    const trunkTop: V3 = [x + lean * scale, 4.2 * scale, z];
    this.lit.add(new THREE.CylinderGeometry(0.22 * scale, 0.5 * scale, 4.4 * scale, 7), color, {
      pos: [x + (lean * scale) / 2, 2.1 * scale, z],
      rot: [0, 0, -lean * 0.22],
    });
    // Roots
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + rand();
      this.segment([x, 0.35 * scale, z], [x + Math.cos(a) * 1.0 * scale, 0, z + Math.sin(a) * 1.0 * scale], 0.14 * scale, color);
    }
    const branch = (from: V3, angle: number, length: number, depth: number, rise: number) => {
      const to: V3 = [from[0] + Math.cos(angle) * length, from[1] + rise * length, from[2] + Math.sin(angle) * length * 0.5];
      this.segment(from, to, Math.max(0.03, 0.14 * scale * (depth / 3)), color);
      if (depth > 1) {
        branch(to, angle + 0.5 + rand() * 0.4, length * 0.6, depth - 1, rise * 0.8 + 0.2);
        branch(to, angle - 0.5 - rand() * 0.4, length * 0.6, depth - 1, rise * 0.6 + 0.1);
      }
    };
    branch(trunkTop, Math.PI * 0.15, 2.2 * scale, 3, 0.35);
    branch(trunkTop, Math.PI * 0.85, 2.0 * scale, 3, 0.4);
    branch([x + lean * scale * 0.6, 3.0 * scale, z], Math.PI * (rand() < 0.5 ? 0.05 : 0.95), 1.8 * scale, 2, 0.5);
    this.blocker([x - 0.45 * scale, 0, z - 0.45 * scale], [x + 0.45 * scale, 3.6 * scale, z + 0.45 * scale]);
    return this;
  }

  /** Pumpkin prop; `carved` adds a glowing face pointing at `faceYaw`. */
  pumpkin(x: number, z: number, radius: number, carved: boolean, faceYaw = 0, color: number = COLORS.pumpkin, solid = false, baseY = 0): this {
    const y = baseY + radius * 0.78;
    this.lit.addColored(pumpkinProp(color), { pos: [x, y, z], rot: [0, faceYaw, 0], scale: radius });
    if (carved) this.glow.add(sharedFace(), COLORS.glowYellow, { pos: [x, y, z], rot: [0, faceYaw, 0], scale: radius });
    if (solid) this.blocker([x - radius * 0.9, baseY, z - radius * 0.9], [x + radius * 0.9, baseY + radius * 1.6, z + radius * 0.9]);
    return this;
  }

  /** Straight run of fence pickets from (x0,z0) to (x1,z1). Blocks shots below `height`. */
  picketFence(x0: number, z0: number, x1: number, z1: number, color: number, height = 1.1, spacing = 0.32): this {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const yaw = -Math.atan2(dz, dx);
    const n = Math.max(2, Math.round(len / spacing));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const h = height * (0.92 + 0.16 * Math.sin(i * 1.7));
      const px = x0 + dx * t;
      const pz = z0 + dz * t;
      const tilt = Math.sin(i * 2.3) * 0.06;
      this.box([0.12, h, 0.05], color, { pos: [px, h / 2, pz], rot: [0, yaw, tilt] });
      this.lit.add(new THREE.ConeGeometry(0.085, 0.16, 4), color, { pos: [px, h + 0.07, pz], rot: [0, yaw + Math.PI / 4, tilt] });
    }
    for (const ry of [0.3, 0.75]) {
      this.box([len, 0.08, 0.04], color, { pos: [x0 + dx / 2, height * ry, z0 + dz / 2 - 0.04], rot: [0, yaw, 0] });
    }
    return this.blocker(
      [Math.min(x0, x1) - 0.05, 0, Math.min(z0, z1) - 0.08],
      [Math.max(x0, x1) + 0.05, height * 0.85, Math.max(z0, z1) + 0.08],
    );
  }

  lampPost(x: number, z: number, height: number, color: number, lightColor: number): this {
    this.lit.add(new THREE.CylinderGeometry(0.07, 0.12, height, 6), color, { pos: [x, height / 2, z] });
    this.lit.add(new THREE.CylinderGeometry(0.2, 0.25, 0.2, 6), color, { pos: [x, 0.1, z] });
    this.box([0.36, 0.06, 0.36], color, { pos: [x, height + 0.02, z] });
    this.glow.add(new THREE.CylinderGeometry(0.16, 0.12, 0.42, 6), lightColor, { pos: [x, height + 0.26, z] });
    this.lit.add(new THREE.ConeGeometry(0.28, 0.24, 6), color, { pos: [x, height + 0.6, z] });
    this.halo(x, height + 0.28, z, 2.2, lightColor, 0.5);
    return this;
  }

  /** Additive glow card (lamps, windows, mushrooms); see `eyeCard`. */
  halo(x: number, y: number, z: number, size: number, color: number, opacity = 0.5): this {
    const mat = this.tracker.track(
      new THREE.MeshBasicMaterial({ map: softDotTexture(), color, opacity, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.group.add(eyeCard(mat, [x, y, z], size));
    return this;
  }

  /** Rounded headstone, optionally leaning (`tilt` = sideways lean, `lean` = backwards). */
  tombstone(x: number, z: number, scale: number, color: number, tilt = 0, yaw = 0, lean = 0, solid = true): this {
    this.lit.addColored(tombstoneProp(color), { pos: [x, 0, z], rot: [lean, yaw, tilt], scale });
    if (solid) this.blocker([x - 0.42 * scale, 0, z - 0.2 * scale], [x + 0.42 * scale, 1.35 * scale, z + 0.2 * scale]);
    return this;
  }

  /** Stone cross grave marker. */
  graveCross(x: number, z: number, scale: number, color: number, tilt = 0): this {
    this.box([0.18, 1.5, 0.16], color, { pos: [x, 0.75 * scale, z], rot: [0, 0, tilt], scale })
      .box([0.8, 0.16, 0.16], color, { pos: [x - Math.sin(tilt) * 1.05 * scale, 1.05 * scale, z], rot: [0, 0, tilt], scale });
    return this.blocker([x - 0.1 * scale, 0, z - 0.1], [x + 0.1 * scale, 1.5 * scale, z + 0.1]);
  }

  finish(name: string, layout: Omit<EnvironmentLayout, 'blockers'>, fog: Environment['fog']): Environment {
    const mats = materials();
    if (!this.lit.isEmpty) {
      const mesh = new THREE.Mesh(this.tracker.track(this.lit.build()), mats.litFlat);
      mesh.name = 'static-lit';
      this.group.add(mesh);
    }
    if (!this.glow.isEmpty) {
      const mesh = new THREE.Mesh(this.tracker.track(this.glow.build()), mats.glow);
      mesh.name = 'static-glow';
      this.group.add(mesh);
    }
    const animators = this.animators;
    const tracker = this.tracker;
    const group = this.group;
    return {
      id: this.id,
      name,
      group,
      fog,
      layout: { ...layout, blockers: this.blockers },
      update(t: number) {
        for (const fn of animators) fn(t);
      },
      dispose() {
        group.removeFromParent();
        tracker.dispose();
      },
    };
  }
}

/**
 * Flat card turned to face the eye, which never moves. A sprite would re-orient with every
 * aim change, so whatever part of it nearby geometry cuts off would pop in and out.
 */
function eyeCard(mat: THREE.Material, pos: V3, width: number, height = width): THREE.Mesh {
  const card = new THREE.Mesh(unitPlane, mat);
  card.position.set(...pos);
  card.scale.set(width, height, 1);
  card.lookAt(eyePoint);
  return card;
}

function scaleMul(size: V3, s: PartOptions['scale']): V3 {
  if (s === undefined) return size;
  if (typeof s === 'number') return [size[0] * s, size[1] * s, size[2] * s];
  return [size[0] * s[0], size[1] * s[1], size[2] * s[2]];
}

const propCache = new Map<string, THREE.BufferGeometry>();
function cachedProp(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = propCache.get(key);
  if (!g) {
    g = build();
    propCache.set(key, g);
  }
  return g;
}

function pumpkinProp(color: number): THREE.BufferGeometry {
  return cachedProp(`pumpkin-${color}`, () =>
    new PartBuilder()
      .add(pumpkinGeometry(8, 16, 10), color)
      .add(new THREE.CylinderGeometry(0.08, 0.13, 0.4, 6), COLORS.stem, { pos: [0.03, 0.86, 0], rot: [0, 0, -0.25] })
      .build(),
  );
}

function sharedFace(): THREE.BufferGeometry {
  return cachedProp('jack-face', () => jackFaceGeometry());
}

/** Unit headstone standing on y=0, about 1.35 tall, face toward +z. */
function tombstoneProp(color: number): THREE.BufferGeometry {
  return cachedProp(`tomb-${color}`, () => {
    const shade = new THREE.Color(color).multiplyScalar(0.7).getHex();
    return new PartBuilder()
      .add(unitBox, color, { pos: [0, 0.5, 0], scale: [0.8, 1.0, 0.22] })
      .add(new THREE.CylinderGeometry(0.4, 0.4, 0.22, 14, 1, false, Math.PI / 2, Math.PI), color, { pos: [0, 1.0, 0], rot: [Math.PI / 2, 0, 0] })
      .add(unitBox, shade, { pos: [0, 0.95, 0.115], scale: [0.36, 0.06, 0.02] })
      .add(unitBox, shade, { pos: [0, 0.78, 0.115], scale: [0.46, 0.05, 0.02] })
      .add(unitBox, shade, { pos: [0, 0.66, 0.115], scale: [0.4, 0.05, 0.02] })
      .add(unitBox, 0x3f5a34, { pos: [0, 0.03, 0.12], scale: [1.0, 0.08, 0.6] })
      .build();
  });
}

/** Tiny deterministic PRNG for scenery placement (independent of gameplay RNG). */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


/** Triangular prism (gable roof): base width `w` on y=0, apex at `h`, depth `d`, centred. */
export function gableGeometry(w: number, h: number, d: number, overhang = 0): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 - overhang, -overhang * 0.6);
  s.lineTo(w / 2 + overhang, -overhang * 0.6);
  s.lineTo(0, h);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }).translate(0, 0, -d / 2);
}

/** Five-sided barn (gambrel) profile extruded to depth `d`, base on y=0. */
export function gambrelGeometry(w: number, wallH: number, roofH: number, d: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, wallH);
  s.lineTo(w * 0.32, wallH + roofH * 0.62);
  s.lineTo(0, wallH + roofH);
  s.lineTo(-w * 0.32, wallH + roofH * 0.62);
  s.lineTo(-w / 2, wallH);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }).translate(0, 0, -d / 2);
}

/** Cylinder/cone made of alternating coloured vertical stripes (tents, awnings). */
export function addStriped(
  b: PartBuilder,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  stripes: number,
  colors: readonly number[],
  opts: PartOptions,
  openEnded = true,
): void {
  const step = (Math.PI * 2) / stripes;
  for (let i = 0; i < stripes; i++) {
    b.add(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 2, 1, openEnded, i * step, step), colors[i % colors.length] as number, opts);
  }
}
