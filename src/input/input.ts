import { CONFIG } from '../config';

export type InputMode = 'mouse' | 'touch';

export interface InputCallbacks {
  /** Escape/P key or the pause button. */
  onPauseRequest(): void;
  /** Pointer lock was lost while the game wanted it (e.g. Escape pressed by the browser). */
  onLockLost(): void;
  onModeChange(mode: InputMode): void;
  /** Any user gesture (used to unlock audio). */
  onGesture(): void;
}

interface AimPointer {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startT: number;
  mouse: boolean;
}

const deg = (d: number) => (d * Math.PI) / 180;

/**
 * Mouse, keyboard and touch input.
 * - Desktop: pointer lock when granted (click/hold to fire); otherwise drag-to-aim with
 *   click or Space to fire.
 * - Touch: drag anywhere on the play area to aim, hold the separate fire button to fire.
 *   Pointers are tracked by id so aiming and firing work simultaneously.
 */
export class InputManager {
  mode: InputMode;
  /** When false, aim and fire input is ignored (menus, results, teleport). */
  enabled = false;
  sensitivity = 1;
  yaw = 0;
  pitch = 0;
  locked = false;
  /** Pointer lock was refused or is unsupported: use drag-to-aim. */
  lockUnavailable: boolean;
  private pressLatch = false;
  private mouseFire = false;
  private keyFire = false;
  private touchFireId: number | null = null;
  /** A Space/F press that started during play and has not been released yet. */
  private fireKeyFromPlay = false;
  private aim: AimPointer | null = null;
  private readonly lockSupported: boolean;
  /** The game currently wants pointer lock (a request may still be pending). */
  private wantLock = false;
  private readonly cleanup: Array<() => void> = [];

  constructor(
    private readonly surface: HTMLElement,
    private readonly fireButton: HTMLElement,
    private readonly cb: InputCallbacks,
    touchDevice: boolean,
  ) {
    this.mode = touchDevice ? 'touch' : 'mouse';
    this.lockSupported = typeof surface.requestPointerLock === 'function' && 'pointerLockElement' in document;
    this.lockUnavailable = !this.lockSupported;

    this.listen(surface, 'pointerdown', (e) => this.onSurfaceDown(e as PointerEvent));
    this.listen(surface, 'pointermove', (e) => this.onSurfaceMove(e as PointerEvent));
    this.listen(surface, 'pointerup', (e) => this.onSurfaceUp(e as PointerEvent));
    this.listen(surface, 'pointercancel', (e) => this.endAim((e as PointerEvent).pointerId, false));
    this.listen(surface, 'lostpointercapture', (e) => this.endAim((e as PointerEvent).pointerId, false));
    this.listen(surface, 'contextmenu', (e) => e.preventDefault());
    this.listen(window, 'pointerup', (e) => {
      if ((e as PointerEvent).pointerType === 'mouse') this.mouseFire = false;
    });

    this.listen(fireButton, 'pointerdown', (e) => {
      const pe = e as PointerEvent;
      pe.preventDefault();
      pe.stopPropagation();
      this.cb.onGesture();
      if (pe.pointerType !== 'mouse') this.setMode('touch');
      if (!this.enabled) return;
      this.touchFireId = pe.pointerId;
      this.pressLatch = true;
      try {
        fireButton.setPointerCapture(pe.pointerId);
      } catch {
        /* capture is best-effort */
      }
    });
    const releaseFire = (e: Event) => {
      if ((e as PointerEvent).pointerId === this.touchFireId) this.touchFireId = null;
    };
    this.listen(fireButton, 'pointerup', releaseFire);
    this.listen(fireButton, 'pointercancel', releaseFire);
    this.listen(fireButton, 'lostpointercapture', releaseFire);
    this.listen(fireButton, 'contextmenu', (e) => e.preventDefault());

    this.listen(window, 'keydown', (e) => this.onKey(e as KeyboardEvent, true));
    this.listen(window, 'keyup', (e) => this.onKey(e as KeyboardEvent, false));
    this.listen(document, 'pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.surface;
      if (this.locked && !this.wantLock) {
        // Granted after the game stopped wanting it (paused or ended while the request was pending).
        this.exitLock();
        return;
      }
      if (was && !this.locked) {
        this.clearHeld();
        if (this.wantLock) this.cb.onLockLost();
      }
    });
    this.listen(document, 'pointerlockerror', () => {
      this.lockUnavailable = true;
    });
  }

  private listen(target: EventTarget, type: string, fn: (e: Event) => void): void {
    const active = type === 'contextmenu' || type === 'pointerdown' || type === 'keydown' || type === 'keyup';
    const opts: AddEventListenerOptions = { passive: !active };
    target.addEventListener(type, fn, opts);
    this.cleanup.push(() => target.removeEventListener(type, fn, opts));
  }

  dispose(): void {
    for (const c of this.cleanup) c();
    this.cleanup.length = 0;
  }

  private setMode(mode: InputMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.cb.onModeChange(mode);
  }

  /** Request pointer lock. Must be called from a user gesture handler. */
  requestLock(): void {
    if (!this.lockSupported || this.mode !== 'mouse' || this.locked) return;
    this.wantLock = true;
    try {
      const result = this.surface.requestPointerLock() as unknown;
      if (result && typeof (result as Promise<void>).then === 'function') {
        (result as Promise<void>).then(
          () => {
            this.lockUnavailable = false;
          },
          () => {
            this.lockUnavailable = true;
          },
        );
      }
    } catch {
      this.lockUnavailable = true;
    }
  }

  exitLock(): void {
    this.wantLock = false;
    if (this.locked && typeof document.exitPointerLock === 'function') {
      try {
        document.exitPointerLock();
      } catch {
        /* ignore */
      }
    }
  }

  get fireHeld(): boolean {
    return this.enabled && (this.mouseFire || this.keyFire || this.touchFireId !== null);
  }

  /** Returns true once per fresh fire press. */
  consumePress(): boolean {
    const p = this.pressLatch;
    this.pressLatch = false;
    return p && this.enabled;
  }

  /** Drop every held button and drag (pause, blur, cancel, level end). */
  clearHeld(): void {
    this.mouseFire = false;
    this.keyFire = false;
    this.pressLatch = false;
    if (this.touchFireId !== null) {
      try {
        this.fireButton.releasePointerCapture(this.touchFireId);
      } catch {
        /* ignore */
      }
    }
    this.touchFireId = null;
    if (this.aim) {
      try {
        this.surface.releasePointerCapture(this.aim.id);
      } catch {
        /* ignore */
      }
    }
    this.aim = null;
  }

  resetAim(): void {
    this.yaw = 0;
    this.pitch = 0;
  }

  /** Rotate the view by a pixel delta. */
  private turn(dx: number, dy: number, radPerPx: number): void {
    const k = radPerPx * this.sensitivity;
    this.yaw -= dx * k;
    this.pitch -= dy * k;
    const yl = deg(CONFIG.aim.yawLimitDeg);
    this.yaw = Math.max(-yl, Math.min(yl, this.yaw));
    this.pitch = Math.max(deg(CONFIG.aim.pitchMinDeg), Math.min(deg(CONFIG.aim.pitchMaxDeg), this.pitch));
  }

  private onSurfaceDown(e: PointerEvent): void {
    this.cb.onGesture();
    if (e.pointerType === 'mouse') this.setMode('mouse');
    else this.setMode('touch');
    if (!this.enabled) return;
    if (e.pointerType === 'mouse') {
      if (this.locked) {
        if (e.button === 0) {
          this.mouseFire = true;
          this.pressLatch = true;
        }
        return;
      }
      if (e.button !== 0) return;
    }
    if (this.aim) return; // a second finger on the aim area is ignored
    e.preventDefault();
    this.aim = { id: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, startT: performance.now(), mouse: e.pointerType === 'mouse' };
    try {
      this.surface.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  private onSurfaceMove(e: PointerEvent): void {
    if (!this.enabled) return;
    if (this.locked && e.pointerType === 'mouse') {
      const m = CONFIG.aim.maxMouseDeltaPx;
      this.turn(Math.max(-m, Math.min(m, e.movementX)), Math.max(-m, Math.min(m, e.movementY)), CONFIG.aim.mouseRadPerPx);
      return;
    }
    const a = this.aim;
    if (!a || a.id !== e.pointerId) return;
    const rate = a.mouse ? CONFIG.aim.mouseRadPerPx * 1.6 : CONFIG.aim.touchRadPerPx;
    this.turn(e.clientX - a.x, e.clientY - a.y, rate);
    a.x = e.clientX;
    a.y = e.clientY;
  }

  private onSurfaceUp(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button === 0) this.mouseFire = false;
    this.endAim(e.pointerId, true);
  }

  private endAim(id: number, released: boolean): void {
    const a = this.aim;
    if (!a || a.id !== id) return;
    this.aim = null;
    // Drag-fallback click: a quick press without much movement fires once.
    if (released && a.mouse && this.enabled) {
      const moved = Math.hypot(a.x - a.startX, a.y - a.startY);
      if (moved <= CONFIG.aim.clickMoveTolerancePx && performance.now() - a.startT <= CONFIG.aim.clickMaxSec * 1000) {
        this.pressLatch = true;
      }
    }
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.code === 'Space' || e.code === 'KeyF') {
      if (down && !e.repeat) this.fireKeyFromPlay = this.enabled;
      // Space must not activate a focused menu button while playing, nor when a press that
      // began in play is still held (its auto-repeat and keyup would click Next Level/Resume).
      if (this.enabled || this.fireKeyFromPlay) e.preventDefault();
      if (!down) this.fireKeyFromPlay = false;
      if (down) this.cb.onGesture();
      if (down && !e.repeat && this.enabled) this.pressLatch = true;
      this.keyFire = down && this.enabled;
      return;
    }
    if (!down) return;
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (e.code === 'Escape' && this.locked) return; // the browser releases the lock; handled via pointerlockchange
      this.cb.onPauseRequest();
    }
  }
}
