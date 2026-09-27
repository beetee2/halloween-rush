import * as THREE from 'three';
import { CONFIG } from '../config';
import { materials } from './materials';

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
}

const dummy = new THREE.Object3D();
const color = new THREE.Color();

/**
 * Pooled splat particles: one instanced mesh with a hard cap. When the pool is full the
 * oldest particles are recycled, so busy late levels can never grow the effect count.
 */
export class Effects {
  readonly mesh: THREE.InstancedMesh;
  private readonly particles: Particle[] = [];
  private next = 0;
  private live = 0;

  constructor() {
    const cap = CONFIG.caps.maxParticles;
    const geo = new THREE.IcosahedronGeometry(1, 0);
    this.mesh = new THREE.InstancedMesh(geo, materials().particle, cap);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < cap; i++) {
      this.particles.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, maxLife: 1, size: 0 });
      this.mesh.setColorAt(i, color.set(0xffffff));
      dummy.scale.setScalar(0);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    this.mesh.count = cap;
  }

  get activeCount(): number {
    return this.live;
  }

  /** Burst of chunky goo/candy bits at a point. */
  burst(at: THREE.Vector3, palette: readonly number[], count: number, speed = 4, size = 0.09): void {
    const cap = this.particles.length;
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % cap;
      const p = this.particles[i]!;
      if (p.life <= 0) this.live++;
      p.pos.copy(at);
      p.vel.set(Math.random() * 2 - 1, Math.random() * 1.4 - 0.2, Math.random() * 2 - 1).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      p.vel.y += speed * 0.4;
      p.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      p.spin.set(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5);
      p.maxLife = p.life = 0.55 + Math.random() * 0.45;
      p.size = size * (0.6 + Math.random() * 0.8);
      this.mesh.setColorAt(i, color.set(palette[n % palette.length] as number));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    if (this.live === 0) return;
    let live = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]!;
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        dummy.scale.setScalar(0);
      } else {
        live++;
        p.vel.y -= 9 * dt;
        p.vel.multiplyScalar(1 - dt * 0.8);
        p.pos.addScaledVector(p.vel, dt);
        if (p.pos.y < 0.03) {
          p.pos.y = 0.03;
          p.vel.set(p.vel.x * 0.4, 0, p.vel.z * 0.4);
        }
        p.rot.addScaledVector(p.spin, dt);
        const k = p.life / p.maxLife;
        dummy.position.copy(p.pos);
        dummy.rotation.set(p.rot.x, p.rot.y, p.rot.z);
        dummy.scale.set(p.size, p.size * 0.6, p.size).multiplyScalar(Math.min(1, k * 2.5));
      }
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    this.live = live;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    for (let i = 0; i < this.particles.length; i++) {
      this.particles[i]!.life = 0;
      dummy.scale.setScalar(0);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    this.live = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export const SPLAT_COLORS: Record<string, readonly number[]> = {
  frankenstein: [0x8fd46a, 0x4a3a78, 0xff8a1c, 0xfff2c0],
  witch: [0x6a2fa0, 0xff6a13, 0x8fd46a, 0xfff2c0],
  spider: [0x5a3380, 0xff8a1c, 0xffd23a, 0xffffff],
  incomingPumpkin: [0xff7a18, 0xffd84a, 0xfff2c0, 0xd9540b],
  candyCorn: [0xffd23a, 0xff8a1c, 0xfff7e6],
  sucker: [0xff8a1c, 0x7b3fb8, 0xfff7e6],
  scenery: [0xff7a18, 0xd9540b, 0xfff2c0],
};
