/**
 * Frame-rate independent fire limiter. A press fires immediately when ready; holding
 * repeats every `interval` seconds of simulation time. A press during cooldown is
 * buffered and fires as soon as the cooldown ends. Mouse, keyboard and touch all feed
 * the same limiter, so no input path can exceed the rate.
 */
export class FireControl {
  private cooldown = 0;
  private pendingPress = false;

  constructor(private readonly interval: number) {}

  /** Register a fresh press (edge), e.g. mousedown or touch on the fire button. */
  press(): void {
    this.pendingPress = true;
  }

  /**
   * Advance one simulation step of `dt` seconds (dt ≤ interval). `held` is whether any
   * fire input is currently held. Returns true if a shot fires at the start of this step.
   */
  update(dt: number, held: boolean): boolean {
    const wants = held || this.pendingPress;
    let fired = false;
    if (wants && this.cooldown <= 1e-9) {
      fired = true;
      this.pendingPress = false;
      // Carry any overshoot so held fire keeps an exact cadence at every frame rate.
      this.cooldown += this.interval;
    }
    this.cooldown -= dt;
    // Never bank readiness while idle: releasing and pressing later starts fresh.
    if (!wants && this.cooldown < 0) this.cooldown = 0;
    return fired;
  }

  /** 0 when ready, else seconds until the next shot may fire. */
  get remaining(): number {
    return Math.max(0, this.cooldown);
  }

  /** Drop buffered presses (pause, blur, level change). Keeps the cooldown. */
  cancel(): void {
    this.pendingPress = false;
  }

  reset(): void {
    this.cooldown = 0;
    this.pendingPress = false;
  }
}
