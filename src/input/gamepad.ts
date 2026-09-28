import { CONFIG } from '../config';

/** Standard Gamepad API button indices, named for the Xbox controller. */
export const PAD = {
  A: 0,
  B: 1,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  VIEW: 8,
  MENU: 9,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
} as const;

/** A, both bumpers and both triggers all fire. */
const FIRE_BUTTONS = [PAD.A, PAD.LB, PAD.RB, PAD.LT, PAD.RT];

export type PadMenuAction = 'up' | 'down' | 'left' | 'right' | 'select';
type Dir = Exclude<PadMenuAction, 'select'>;

const DPAD: ReadonlyArray<[number, Dir]> = [
  [PAD.UP, 'up'],
  [PAD.DOWN, 'down'],
  [PAD.LEFT, 'left'],
  [PAD.RIGHT, 'right'],
];

/** Left-stick push that counts as a menu move, and how far back it must come to end it. */
const NAV_ON = 0.6;
const NAV_OFF = 0.35;
/** A held menu direction repeats after this long, then at this interval (seconds). */
const REPEAT_DELAY = 0.45;
const REPEAT_EVERY = 0.12;

/** The parts of a `Gamepad` this reads (tests pass plain objects). */
export interface PadLike {
  readonly mapping: string;
  readonly buttons: ReadonlyArray<{ readonly pressed: boolean }>;
  readonly axes: ReadonlyArray<number>;
}

export interface PadFrame {
  /** Aim from both sticks after the dead zone, each -1..1; +x is right and +y is down, like screen pixels. */
  aimX: number;
  aimY: number;
  fireHeld: boolean;
  /** A fire button went down since the last read. */
  firePressed: boolean;
  /** The Menu (☰) button went down since the last read. */
  pause: boolean;
  /** Menu moves from the D-pad or left stick (repeating while held) and A presses. */
  menu: PadMenuAction[];
  /** A button is down or a stick is off centre. */
  active: boolean;
}

/**
 * Radial dead zone with a squared response: small pushes aim finely, a full push turns at
 * full speed. Returns the stick scaled to 0..1 in the same direction.
 */
export function shapeStick(x: number, y: number, deadZone: number = CONFIG.aim.padDeadZone): [number, number] {
  const m = Math.hypot(x, y);
  if (m <= deadZone) return [0, 0];
  const n = Math.min(1, (m - deadZone) / (1 - deadZone));
  const k = (n * n) / m;
  return [x * k, y * k];
}

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

/**
 * Turns polled controller state into aim, fire and menu input. Only controllers with the
 * standard (Xbox-style) layout are read; every connected one counts, so any pad can play.
 */
export class GamepadReader {
  private down: boolean[] = [];
  private nav: { dir: Dir; stick: boolean; next: number } | null = null;

  /** `now` in seconds, for menu auto-repeat. */
  read(pads: ArrayLike<PadLike | null>, now: number): PadFrame {
    const down: boolean[] = [];
    let aimX = 0;
    let aimY = 0;
    let navX = 0;
    let navY = 0;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (!p || p.mapping !== 'standard') continue;
      p.buttons.forEach((b, j) => {
        if (b.pressed) down[j] = true;
      });
      const [lx, ly] = shapeStick(p.axes[0] ?? 0, p.axes[1] ?? 0);
      const [rx, ry] = shapeStick(p.axes[2] ?? 0, p.axes[3] ?? 0);
      aimX += lx + rx;
      aimY += ly + ry;
      navX += p.axes[0] ?? 0;
      navY += p.axes[1] ?? 0;
    }
    const was = this.down;
    this.down = down;
    const pressed = (b: number) => down[b] === true && was[b] !== true;
    const menu: PadMenuAction[] = [];
    const dir = this.navDir(down, navX, navY);
    if (!dir) this.nav = null;
    else if (!this.nav || this.nav.dir !== dir.dir) {
      this.nav = { ...dir, next: now + REPEAT_DELAY };
      menu.push(dir.dir);
    } else {
      this.nav.stick = dir.stick;
      if (now >= this.nav.next) {
        this.nav.next = now + REPEAT_EVERY;
        menu.push(dir.dir);
      }
    }
    if (pressed(PAD.A)) menu.push('select');
    return {
      aimX: clamp1(aimX),
      aimY: clamp1(aimY),
      fireHeld: FIRE_BUTTONS.some((b) => down[b] === true),
      firePressed: FIRE_BUTTONS.some(pressed),
      pause: pressed(PAD.MENU),
      menu,
      active: aimX !== 0 || aimY !== 0 || down.some(Boolean),
    };
  }

  /** The held menu direction: a D-pad button, else the left stick (with hysteresis). */
  private navDir(down: boolean[], x: number, y: number): { dir: Dir; stick: boolean } | null {
    for (const [b, dir] of DPAD) if (down[b]) return { dir, stick: false };
    const held = this.nav?.stick ? this.nav.dir : null;
    const along = (d: Dir) => (d === 'up' ? -y : d === 'down' ? y : d === 'left' ? -x : x);
    if (held && along(held) > NAV_OFF) return { dir: held, stick: true };
    if (Math.max(Math.abs(x), Math.abs(y)) < NAV_ON) return null;
    const dir: Dir = Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : y > 0 ? 'down' : 'up';
    return { dir, stick: true };
  }
}
