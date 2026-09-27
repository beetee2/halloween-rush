/**
 * Swept collision helpers. Projectiles test the whole segment they travel each step, so
 * a fast shot at a low frame rate cannot tunnel through a thin target or wall.
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface Aabb {
  min: Vec3Like;
  max: Vec3Like;
}

/**
 * First parameter t∈[0,1] where segment p0→p1 touches a sphere, or null. Returns 0 when
 * p0 already starts inside the sphere.
 */
export function segmentSphere(p0: Vec3Like, p1: Vec3Like, c: Vec3Like, r: number): number | null {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const dz = p1.z - p0.z;
  const fx = p0.x - c.x;
  const fy = p0.y - c.y;
  const fz = p0.z - c.z;
  const cc = fx * fx + fy * fy + fz * fz - r * r;
  if (cc <= 0) return 0;
  const a = dx * dx + dy * dy + dz * dz;
  if (a < 1e-12) return null;
  const b = 2 * (fx * dx + fy * dy + fz * dz);
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

/** First parameter t∈[0,1] where segment p0→p1 enters an axis-aligned box, or null. */
export function segmentAabb(p0: Vec3Like, p1: Vec3Like, box: Aabb, inflate = 0): number | null {
  let tMin = 0;
  let tMax = 1;
  const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
  for (const ax of axes) {
    const o = p0[ax];
    const d = p1[ax] - o;
    const lo = box.min[ax] - inflate;
    const hi = box.max[ax] + inflate;
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }
  return tMin;
}

/** First parameter where the segment crosses down through the horizontal plane y = h. */
export function segmentGround(p0: Vec3Like, p1: Vec3Like, h: number): number | null {
  if (p0.y < h) return 0;
  if (p1.y >= h) return null;
  return (p0.y - h) / (p0.y - p1.y);
}
