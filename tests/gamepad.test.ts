import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { GamepadReader, PAD, shapeStick, type PadLike } from '../src/input/gamepad';

/** A standard-mapping pad with the given buttons held and stick axes [lx, ly, rx, ry]. */
function pad(held: number[] = [], axes: number[] = [0, 0, 0, 0], mapping = 'standard'): PadLike {
  return { mapping, axes, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: held.includes(i) })) };
}

describe('controller input', () => {
  it('ignores a resting stick and reaches full speed at full push', () => {
    const dz = CONFIG.aim.padDeadZone;
    expect(shapeStick(dz * 0.9, 0)).toEqual([0, 0]);
    expect(shapeStick(0, -1)[1]).toBeCloseTo(-1, 9);
    const [x, y] = shapeStick(0.7071, 0.7071);
    expect(Math.hypot(x, y)).toBeCloseTo(1, 3);
    // Squared response: half-way past the dead zone gives a quarter speed.
    expect(shapeStick(dz + (1 - dz) / 2, 0)[0]).toBeCloseTo(0.25, 9);
  });

  it('aims with the right stick in screen directions (push right = right, push up = up)', () => {
    const r = new GamepadReader();
    expect(r.read([pad([], [0, 0, 1, 0])], 0)).toMatchObject({ aimX: 1, aimY: 0, active: true });
    expect(r.read([pad([], [0, 0, 0, -1])], 0.1)).toMatchObject({ aimX: 0, aimY: -1, active: true });
  });

  it('flips up/down for a browser that reports stick up as positive (Edge on Xbox)', () => {
    const r = new GamepadReader(true);
    expect(r.read([pad([], [0, 0, 0, 1])], 0).aimY).toBe(-1);
    expect(r.read([pad([], [0, 0, 1, 0])], 0.1).aimX).toBe(1);
    expect(r.read([pad([], [0, 0.9, 0, 0])], 0.2).menu).toEqual(['up']);
  });

  it('fires from A, bumpers and triggers, reporting fresh presses once', () => {
    for (const b of [PAD.A, PAD.LB, PAD.RB, PAD.LT, PAD.RT]) {
      const r = new GamepadReader();
      const first = r.read([pad([b])], 0);
      expect(first).toMatchObject({ fireHeld: true, firePressed: true });
      expect(r.read([pad([b])], 0.016)).toMatchObject({ fireHeld: true, firePressed: false });
      expect(r.read([pad()], 0.032)).toMatchObject({ fireHeld: false, firePressed: false, active: false });
    }
  });

  it('Menu pauses once per press', () => {
    const r = new GamepadReader();
    expect(r.read([pad([PAD.MENU])], 0).pause).toBe(true);
    expect(r.read([pad([PAD.MENU])], 0.1).pause).toBe(false);
  });

  it('menus: D-pad and left stick move, repeating while held; A selects', () => {
    const r = new GamepadReader();
    expect(r.read([pad([PAD.DOWN])], 0).menu).toEqual(['down']);
    expect(r.read([pad([PAD.DOWN])], 0.3).menu).toEqual([]);
    expect(r.read([pad([PAD.DOWN])], 0.46).menu).toEqual(['down']);
    expect(r.read([pad([PAD.DOWN])], 0.5).menu).toEqual([]);
    expect(r.read([pad([PAD.DOWN])], 0.59).menu).toEqual(['down']);
    expect(r.read([pad()], 0.6).menu).toEqual([]);
    // Left stick flick, with hysteresis: easing off a little doesn't count as a new move.
    expect(r.read([pad([], [-0.8, 0.1])], 1).menu).toEqual(['left']);
    expect(r.read([pad([], [-0.5, 0])], 1.1).menu).toEqual([]);
    expect(r.read([pad([], [-0.8, 0])], 1.2).menu).toEqual([]);
    expect(r.read([pad([], [-0.2, 0])], 1.3).menu).toEqual([]);
    expect(r.read([pad([], [0, -0.9])], 1.4).menu).toEqual(['up']);
    expect(r.read([pad([PAD.A])], 2).menu).toEqual(['select']);
    expect(r.read([pad([PAD.A])], 2.1).menu).toEqual([]);
  });

  it('reads every standard controller and skips other devices', () => {
    const r = new GamepadReader();
    expect(r.read([null, pad([PAD.RT])], 0).fireHeld).toBe(true);
    expect(r.read([pad([PAD.RT], [0, 0, 1, 1], '')], 0.1)).toMatchObject({ fireHeld: false, aimX: 0, aimY: 0, active: false });
  });
});
