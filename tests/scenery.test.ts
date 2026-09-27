import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { ENVIRONMENTS } from '../src/render/environments';

const eye = new THREE.Vector3(...CONFIG.camera.position);
/** Faces nearer than this along their normal count as coplanar: the depth buffer can't reliably order them. */
const COPLANAR_M = 0.001;

interface Face {
  pts: THREE.Vector3[];
  n: THREE.Vector3;
  d: number;
  /** Material type and colour: faces that look the same may overlap freely. */
  look: string;
  box: THREE.Box3;
}

/** Every depth-writing face of the scenery that the fixed eye can see, in world space. */
function visibleFaces(group: THREE.Object3D): Face[] {
  const faces: Face[] = [];
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    if (!mesh.isMesh || !mat.depthWrite) return;
    const geom = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const pos = geom.getAttribute('position');
    const col = geom.getAttribute('color');
    for (let k = 0; k + 2 < pos.count; k += 3) {
      const pts = [0, 1, 2].map((j) => new THREE.Vector3().fromBufferAttribute(pos, k + j).applyMatrix4(mesh.matrixWorld));
      const n = new THREE.Vector3().crossVectors(e1.subVectors(pts[1]!, pts[0]!), e2.subVectors(pts[2]!, pts[0]!));
      if (n.lengthSq() < 1e-18) continue;
      n.normalize();
      if (n.dot(e1.subVectors(eye, pts[0]!)) <= 0) continue; // turned away from the eye: culled
      const color = col ? new THREE.Color().fromBufferAttribute(col, k) : mat.color;
      faces.push({ pts, n, d: n.dot(pts[0]!), look: `${mat.type} #${color.getHexString()}`, box: new THREE.Box3().setFromPoints(pts).expandByScalar(COPLANAR_M / 2) });
    }
  });
  return faces;
}

/** Area shared by two coplanar triangles (Sutherland–Hodgman clip in their plane). */
function overlapArea(p: Face, q: Face): number {
  const u = new THREE.Vector3().crossVectors(p.n, Math.abs(p.n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
  const v = new THREE.Vector3().crossVectors(p.n, u);
  const flat = (f: Face) => {
    const pts = f.pts.map((x) => [x.dot(u), x.dot(v)] as const);
    return signedArea(pts) < 0 ? pts.reverse() : pts;
  };
  let poly: ReadonlyArray<readonly [number, number]> = flat(p);
  const clipper = flat(q);
  for (let e = 0; e < 3 && poly.length; e++) {
    const [a, b] = [clipper[e]!, clipper[(e + 1) % 3]!];
    const side = (x: readonly [number, number]) => (b[0] - a[0]) * (x[1] - a[1]) - (b[1] - a[1]) * (x[0] - a[0]);
    const next: Array<readonly [number, number]> = [];
    poly.forEach((cur, i) => {
      const prev = poly[(i + poly.length - 1) % poly.length]!;
      const [sc, sp] = [side(cur), side(prev)];
      const cross = () => {
        const t = sp / (sp - sc);
        return [prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])] as const;
      };
      if (sc >= 0) {
        if (sp < 0) next.push(cross());
        next.push(cur);
      } else if (sp >= 0) next.push(cross());
    });
    poly = next;
  }
  return poly.length >= 3 ? Math.abs(signedArea(poly)) : 0;
}

function signedArea(pts: ReadonlyArray<readonly [number, number]>): number {
  let s = 0;
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  });
  return s / 2;
}

describe('scenery', () => {
  // Two visible faces in (almost) the same plane z-fight: the pixels flicker between them as the
  // player aims. Faces that look identical are exempt, since swapping them changes nothing.
  it.each(ENVIRONMENTS.map((e, i) => [e.name, i] as const))('%s has no overlapping coplanar faces', (_name, i) => {
    const env = ENVIRONMENTS[i]!.build();
    env.update(0);
    // Group by normal, then sweep along an axis lying in that plane so each face is only
    // compared with faces whose bounds overlap its own.
    const groups = new Map<string, Face[]>();
    for (const f of visibleFaces(env.group)) {
      const key = `${f.n.x.toFixed(2)},${f.n.y.toFixed(2)},${f.n.z.toFixed(2)}`;
      const group = groups.get(key);
      if (group) group.push(f);
      else groups.set(key, [f]);
    }
    const fights = new Set<string>();
    for (const faces of groups.values()) {
      const n = faces[0]!.n;
      const axis = (['x', 'y', 'z'] as const).reduce((m, k) => (Math.abs(n[k]) < Math.abs(n[m]) ? k : m));
      faces.sort((p, q) => p.box.min[axis] - q.box.min[axis]);
      for (let a = 0; a < faces.length; a++) {
        const p = faces[a]!;
        for (let b = a + 1; b < faces.length && faces[b]!.box.min[axis] < p.box.max[axis]; b++) {
          const q = faces[b]!;
          if (p.look === q.look || Math.abs(p.d - q.d) > COPLANAR_M || p.n.dot(q.n) < 0.9999 || !p.box.intersectsBox(q.box)) continue;
          if (overlapArea(p, q) < 1e-4) continue;
          const at = p.pts[0]!;
          fights.add(`${[p.look, q.look].sort().join(' vs ')} near (${at.x.toFixed(0)}, ${at.y.toFixed(0)}, ${at.z.toFixed(0)})`);
        }
      }
    }
    expect([...fights]).toEqual([]);
    env.dispose();
  });
});
