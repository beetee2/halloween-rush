import { CONFIG } from '../config';
import { accuracy, DEFAULT_NAME, scoreboardName } from '../core/scoreboard';
import type { PadMenuAction } from '../input/gamepad';
import type { InputMode } from '../input/input';
import type { Bests, CandyKind, Inventory, Settings, SizeClass } from '../types';
import { CANDY_KINDS } from '../types';
import { BoardPanel, type BoardsView } from './boards';

export type Screen = 'title' | 'pause' | 'results' | 'gameOver' | 'boards' | 'settings' | null;

export interface HudState {
  levelNumber: number;
  envName: string;
  night: number;
  time: number;
  hearts: number;
  levelScore: number;
  total: number;
  candy: number;
}

const CANDY_LABEL: Record<CandyKind, string> = {
  frankenstein: 'Frankenstein gummies',
  witch: 'Witch chocolates',
  spider: 'Spider gummies',
  pumpkin: 'Pumpkin creams',
  candyCorn: 'Candy corn',
  sucker: 'Suckers',
};

const HEART_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.8 8.3 3 4.5 6.7 4.5c2.1 0 3.6 1.2 5.3 3.1 1.7-1.9 3.2-3.1 5.3-3.1 3.7 0 5.9 3.8 4.3 7.3C19.5 16.4 12 21 12 21z" fill="#ff4d6d" stroke="#2a0f1a" stroke-width="1.5"/><ellipse cx="8" cy="9" rx="2" ry="1.3" fill="#fff" opacity=".6"/></svg>';

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

const fmt = (n: number) => n.toLocaleString('en-US');

/** "62% (31/50)" */
function hitText(hits: number, shots: number): string {
  const pct = accuracy(hits, shots);
  return pct === null ? 'No shots' : `${pct}% (${fmt(hits)}/${fmt(shots)})`;
}

/** Thin DOM layer: screens, HUD, popups and warnings. No game rules live here. */
export class UI {
  private readonly screens: Record<Exclude<Screen, null>, HTMLElement>;
  private last: Partial<HudState> = {};
  private readonly popups: HTMLElement[] = [];
  private popupNext = 0;
  private readonly warns: HTMLElement[] = [];
  private settingsReturn: Screen = null;
  /** Lowest y a warning marker may use so it never covers the timer or scores (null = re-measure). */
  private warnTop: number | null = null;
  /** Screen whose buttons are briefly ignoring the pointer (see lockClicks). */
  private clickLocked: { screen: HTMLElement; timer: ReturnType<typeof setTimeout> } | null = null;
  private readonly nameInput: HTMLInputElement;
  private readonly levelNameInput: HTMLInputElement;
  private readonly gameOverBoards: BoardPanel;
  private readonly titleBoards: BoardPanel;
  private readonly fullscreenButtons = [$('btn-fullscreen-title'), $('btn-fullscreen-pause')];
  current: Screen = 'title';

  constructor() {
    this.screens = {
      title: $('screen-title'),
      pause: $('screen-pause'),
      results: $('screen-results'),
      gameOver: $('screen-gameover'),
      boards: $('screen-boards'),
      settings: $('screen-settings'),
    };
    const pops = $('popups');
    for (let i = 0; i < CONFIG.caps.maxScorePopups; i++) {
      const el = document.createElement('div');
      el.className = 'pop';
      el.hidden = true;
      el.addEventListener('animationend', () => (el.hidden = true));
      pops.appendChild(el);
      this.popups.push(el);
    }
    const warn = $('warnings');
    for (let i = 0; i < 6; i++) {
      const el = document.createElement('div');
      el.className = 'warn';
      el.textContent = '!';
      el.hidden = true;
      warn.appendChild(el);
      this.warns.push(el);
    }
    $('btn-reload').addEventListener('click', () => location.reload());
    // Not every browser can (iPhone Safari can't): offer full screen only where it works.
    const canFullscreen = document.fullscreenEnabled === true && typeof document.documentElement.requestFullscreen === 'function';
    for (const b of this.fullscreenButtons) b.hidden = !canFullscreen;
    document.addEventListener('fullscreenchange', () => {
      for (const b of this.fullscreenButtons) b.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
    });
    window.addEventListener('resize', () => (this.warnTop = null));
    this.gameOverBoards = new BoardPanel($('gameover-boards'));
    this.titleBoards = new BoardPanel($('title-boards'));
    this.nameInput = $('gameover-name') as HTMLInputElement;
    this.levelNameInput = $('results-name') as HTMLInputElement;
    for (const screen of ['results', 'gameOver'] as const) {
      const { input, error } = this.nameEntry(screen);
      input.maxLength = CONFIG.scoreboard.nameMaxChars;
      input.addEventListener('input', () => (error.hidden = true));
    }
    // The scoreboard row only shows the typed name once it's one that can go there.
    this.nameInput.addEventListener('input', () => {
      const cell = this.gameOverBoards.pendingCell;
      if (cell) cell.textContent = scoreboardName(this.nameInput.value) || DEFAULT_NAME;
    });
  }

  private nameEntry(screen: 'results' | 'gameOver'): { input: HTMLInputElement; error: HTMLElement } {
    return screen === 'results' ? { input: this.levelNameInput, error: $('results-name-error') } : { input: this.nameInput, error: $('gameover-name-error') };
  }

  /** The typed name can't go on the scoreboard: say why and let the player try another. */
  rejectName(screen: 'results' | 'gameOver', problem: 'name' | 'number'): void {
    const { input, error } = this.nameEntry(screen);
    error.textContent =
      problem === 'number'
        ? "That number isn't allowed with that name. Try another one, or Skip."
        : "That name isn't allowed. Try a first name, Mom, Pumpkin or Player, plus a number if you like (Brad2), or Skip.";
    error.hidden = false;
    // The card scrolls on short phone screens.
    error.scrollIntoView({ block: 'nearest' });
    input.focus({ preventScroll: true });
    input.select();
  }

  /** The player submitted a name for the run waiting on the scoreboard ('' = skipped). */
  onSaveScore(handler: (name: string) => void): void {
    this.onSubmit('gameover-entry', () => handler(this.nameInput.value));
    this.on('btn-skip-score', () => handler(''));
  }

  /** The player submitted a name on the level results, a level best or a map top 10 ('' = skipped). */
  onSaveLevelName(handler: (name: string) => void): void {
    this.onSubmit('results-entry', () => handler(this.levelNameInput.value));
    this.on('btn-skip-level', () => handler(''));
  }

  private onSubmit(formId: string, fn: () => void): void {
    $(formId).addEventListener('submit', (e) => {
      e.preventDefault();
      fn();
    });
  }

  /** Keyboard players can type straight away; on touch, tapping the box brings up the keyboard. */
  private focusName(input: HTMLInputElement): void {
    if (document.body.classList.contains('touch')) return;
    input.focus({ preventScroll: true });
    input.select();
  }

  on(id: string, handler: () => void): void {
    $(id).addEventListener('click', (e) => {
      e.preventDefault();
      handler();
    });
  }

  show(screen: Screen): void {
    this.unlockClicks();
    this.current = screen;
    for (const [name, el] of Object.entries(this.screens)) el.hidden = name !== screen;
    const buttons = screen ? Array.from(this.screens[screen].querySelectorAll<HTMLElement>('.btn.primary')) : [];
    const focusable = buttons.find((b) => !b.closest('[hidden]'));
    // Focus the main action for keyboard players without scrolling the page.
    focusable?.focus({ preventScroll: true });
  }

  /**
   * A level ending mid-fire: for a moment the current screen's buttons ignore the pointer, so
   * clicks and taps still coming from play can't press Next Level or New Run unseen. Keys are
   * unaffected (a held Space is already stopped by the input manager).
   */
  private lockClicks(): void {
    const screen = this.current && this.screens[this.current];
    if (!screen) return;
    screen.classList.add('click-lock');
    this.clickLocked = { screen, timer: setTimeout(() => this.unlockClicks(), CONFIG.screens.clickLockSec * 1000) };
  }

  private unlockClicks(): void {
    if (!this.clickLocked) return;
    clearTimeout(this.clickLocked.timer);
    this.clickLocked.screen.classList.remove('click-lock');
    this.clickLocked = null;
  }

  openSettings(): void {
    this.settingsReturn = this.current;
    this.show('settings');
  }

  closeSettings(): void {
    this.show(this.settingsReturn ?? 'title');
  }

  openBoards(view: BoardsView): void {
    this.titleBoards.select('runs');
    this.titleBoards.render(view);
    this.show('boards');
  }

  /** Fresh leaderboards arrived while one of the panels is on screen. */
  refreshBoards(view: BoardsView): void {
    if (this.current === 'boards') this.titleBoards.render(view);
    if (this.current === 'gameOver') this.gameOverBoards.render(view);
  }

  setHudVisible(v: boolean): void {
    $('hud').hidden = !v;
  }

  setInputMode(mode: InputMode): void {
    document.body.classList.toggle('touch', mode === 'touch');
    document.body.classList.toggle('pad', mode === 'gamepad');
  }

  /**
   * Controller menu navigation: the D-pad or left stick moves focus through the current
   * screen's controls (left/right adjust a slider) and A presses the focused one.
   */
  padMenu(action: PadMenuAction): void {
    const screen = this.current && this.screens[this.current];
    if (!screen) return;
    const items = Array.from(screen.querySelectorAll<HTMLElement>('button, input, a[href]'))
      // Laid out (not hidden) and enabled.
      .filter((el) => el.getClientRects().length > 0 && !(el as HTMLButtonElement).disabled);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const focused = items[at];
    if (action === 'select') {
      // Same guard as for clicks: a press as the level ends can't skip the screen unseen.
      if (focused && !this.clickLocked) focused.click();
      return;
    }
    if (focused instanceof HTMLInputElement && focused.type === 'range' && (action === 'left' || action === 'right')) {
      if (action === 'right') focused.stepUp();
      else focused.stepDown();
      focused.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (!items.length) return;
    const step = action === 'up' || action === 'left' ? -1 : 1;
    const next = at < 0 ? (step > 0 ? 0 : items.length - 1) : (at + step + items.length) % items.length;
    items[next]!.focus();
  }

  /** Whole page full screen (HUD and menus too), e.g. to hide a TV browser's bars. Needs a click or tap. */
  toggleFullscreen(): void {
    try {
      const done = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      done.catch(() => {
        /* refused without a click or tap, or not allowed here */
      });
    } catch {
      /* ignore */
    }
  }

  updateHud(s: HudState): void {
    const l = this.last;
    if (l.levelNumber !== s.levelNumber || l.night !== s.night) {
      $('hud-level-num').textContent = `Level ${s.levelNumber}${s.night > 1 ? ` · Night ${s.night}` : ''}`;
    }
    if (l.envName !== s.envName) $('hud-env').textContent = s.envName;
    const secs = Math.ceil(s.time);
    if (Math.ceil(l.time ?? -1) !== secs) {
      const t = $('hud-timer');
      t.textContent = String(secs);
      t.classList.toggle('low', secs <= 10);
    }
    if (l.hearts !== s.hearts) {
      const box = $('hud-hearts');
      if (box.children.length !== CONFIG.level.startingHearts) {
        box.innerHTML = HEART_SVG.repeat(CONFIG.level.startingHearts);
      }
      Array.from(box.children).forEach((svg, i) => {
        const lost = i >= s.hearts;
        const wasLost = svg.classList.contains('lost');
        svg.classList.toggle('lost', lost);
        if (lost && !wasLost && l.hearts !== undefined) {
          svg.classList.remove('pop');
          void (svg as HTMLElement).getBoundingClientRect();
          svg.classList.add('pop');
        }
      });
      box.setAttribute('aria-label', `${s.hearts} hearts left`);
    }
    if (l.levelScore !== s.levelScore) $('hud-level-score').textContent = fmt(s.levelScore);
    if (l.total !== s.total) $('hud-total').textContent = fmt(s.total);
    if (l.candy !== s.candy) {
      $('hud-candy-count').textContent = fmt(s.candy);
      if (l.candy !== undefined && s.candy > l.candy) this.bump($('hud-candy'));
    }
    this.last = { ...s };
  }

  resetHudCache(): void {
    this.last = {};
  }

  private bump(el: HTMLElement): void {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  setCrosshair(cooling: boolean): void {
    $('crosshair').classList.toggle('cooling', cooling);
  }

  setHint(text: string | null): void {
    const el = $('hud-hint');
    el.hidden = !text;
    if (text) el.textContent = text;
  }

  countdown(value: string | null): void {
    const el = $('countdown');
    if (value === null) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    el.hidden = false;
    const span = document.createElement('span');
    span.textContent = value;
    el.replaceChildren(span);
  }

  teleport(state: 'in' | 'out' | null, label = ''): void {
    const el = $('teleport');
    if (state === null) {
      el.hidden = true;
      el.classList.remove('in');
      return;
    }
    el.hidden = false;
    $('teleport-label').textContent = label;
    // Force a style flush so the opacity transition runs.
    void el.offsetWidth;
    el.classList.toggle('in', state === 'in');
  }

  popup(x: number, y: number, points: number, size: SizeClass, headshot = false): void {
    const el = this.popups[this.popupNext]!;
    this.popupNext = (this.popupNext + 1) % this.popups.length;
    el.hidden = true;
    void el.offsetWidth;
    el.className = headshot ? `pop ${size} headshot` : `pop ${size}`;
    el.textContent = headshot ? `Headshot! +${points}` : `+${points}`;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.hidden = false;
  }

  damageFlash(real: boolean): void {
    const el = $('damage-flash');
    el.classList.remove('on', 'soft');
    void el.offsetWidth;
    el.classList.add(real ? 'on' : 'soft');
  }

  /** Edge-of-screen arrows for threats outside the current view. */
  setWarnings(list: Array<{ x: number; y: number; angleDeg: number }>): void {
    if (list.length > 0 && this.warnTop === null) {
      // Marker circle plus its arrow reach ~36 px above the centre.
      this.warnTop = (document.querySelector('.hud-scores')?.getBoundingClientRect().bottom ?? 0) + 40;
    }
    this.warns.forEach((el, i) => {
      const w = list[i];
      el.hidden = !w;
      if (w) {
        el.style.left = `${w.x}px`;
        el.style.top = `${Math.max(w.y, this.warnTop ?? 0)}px`;
        el.style.setProperty('--angle', `${w.angleDeg}deg`);
      }
    });
  }

  setTitleBests(b: Bests): void {
    $('title-bests').textContent = b.bestRunScore > 0 ? `Best run: ${fmt(b.bestRunScore)} · Furthest level: ${b.furthestLevel}` : '';
  }

  /**
   * `honor`: the level made a leaderboard ("Best score ever on Level 3", "#2 on the Graveyard
   * board"). If the run has no name yet (`askName`), the name box replaces Replay/Next until saved.
   */
  showResults(d: { envName: string; levelNumber: number; levelScore: number; hits: number; shots: number; total: number; levelCandy: Inventory; newBest: boolean; nextEnvName: string; honor: string | null; askName: boolean; name: string }): void {
    $('results-env').textContent = `Level ${d.levelNumber} · ${d.envName}`;
    $('results-level').textContent = fmt(d.levelScore);
    $('results-accuracy').textContent = hitText(d.hits, d.shots);
    $('results-total').textContent = fmt(d.total);
    this.fillCandy($('results-candy'), d.levelCandy, 'No candy this time — keep shooting!');
    $('results-best').hidden = !d.newBest;
    this.setLevelBadge(d.askName ? null : d.honor, d.name);
    $('results-entry').hidden = !d.askName;
    $('results-name-error').hidden = true;
    $('results-actions').hidden = d.askName;
    $('results-why').textContent = d.honor ?? '';
    this.levelNameInput.value = d.name;
    $('btn-next').textContent = `Next: ${d.nextEnvName}`;
    this.show('results');
    this.lockClicks();
    if (d.askName) this.focusName(this.levelNameInput);
  }

  showLevelNameSaved(honor: string, name: string): void {
    $('results-entry').hidden = true;
    $('results-actions').hidden = false;
    this.setLevelBadge(honor, name);
    $('btn-next').focus({ preventScroll: true });
  }

  private setLevelBadge(honor: string | null, name: string): void {
    const badge = $('results-levelbest');
    badge.hidden = honor === null;
    badge.textContent = honor === null ? '' : `${honor}${name ? `, ${name}` : ''}!`;
  }

  /**
   * `boards.runs` already includes this run when it made the scoreboard. `honor` says which
   * board it made ("#3 on the scoreboard", "#2 in career points"). If the run has no name yet
   * (`asking`), the name box replaces Title/New Run until saved.
   */
  showGameOver(d: { levelNumber: number; envName: string; total: number; hits: number; shots: number; candy: Inventory; newBest: boolean; honor: string | null; asking: boolean; name: string; boards: BoardsView }): void {
    $('gameover-sub').textContent = `The jack-o'-lanterns got you on level ${d.levelNumber} (${d.envName}).`;
    $('gameover-total').textContent = fmt(d.total);
    $('gameover-accuracy').textContent = hitText(d.hits, d.shots);
    this.fillCandy($('gameover-candy'), d.candy, 'Your bag was empty this run.');
    $('gameover-newbest').hidden = !d.newBest;
    this.setRankBadge(d.asking ? null : d.honor);
    $('gameover-entry').hidden = !d.asking;
    $('gameover-name-error').hidden = true;
    $('gameover-actions').hidden = d.asking;
    $('gameover-why').textContent = d.honor ?? '';
    this.nameInput.value = d.name;
    this.gameOverBoards.select('runs');
    this.gameOverBoards.render(d.boards);
    this.show('gameOver');
    this.lockClicks();
    if (d.asking) this.focusName(this.nameInput);
  }

  /** The name was saved: show the final boards and bring back the buttons. */
  showSavedScore(boards: BoardsView, honor: string | null): void {
    $('gameover-entry').hidden = true;
    $('gameover-actions').hidden = false;
    this.setRankBadge(honor);
    this.gameOverBoards.render(boards);
    $('btn-newrun').focus({ preventScroll: true });
  }

  private setRankBadge(honor: string | null): void {
    const badge = $('gameover-rankbadge');
    badge.hidden = honor === null;
    badge.textContent = honor === null ? '' : `${honor}!`;
  }

  private fillCandy(el: HTMLElement, inv: Inventory, empty: string): void {
    el.replaceChildren();
    const kinds = CANDY_KINDS.filter((k) => inv[k] > 0);
    if (!kinds.length) {
      const s = document.createElement('span');
      s.textContent = empty;
      el.appendChild(s);
      return;
    }
    for (const k of kinds) {
      const s = document.createElement('span');
      s.textContent = `${CANDY_LABEL[k]} × ${inv[k]}`;
      el.appendChild(s);
    }
  }

  showError(message: string, tips: string[]): void {
    $('error-msg').textContent = message;
    const ul = $('error-tips');
    ul.replaceChildren(
      ...tips.map((t) => {
        const li = document.createElement('li');
        li.textContent = t;
        return li;
      }),
    );
    // Stay on the title card so the page still shows what the game is. Search engines render
    // pages without WebGL and index what's left on screen.
    $('title-error').hidden = false;
    $('btn-start').hidden = true;
    $('title-actions').hidden = true;
    this.setHudVisible(false);
    $('rotate').hidden = true;
    this.show('title');
  }

  setRotatePrompt(visible: boolean): void {
    $('rotate').hidden = !visible;
  }

  setDevice(label: string, id: string): void {
    $('set-device').textContent = `This device: ${label} (ID ${id.slice(0, 8)})`;
  }

  setPauseMessage(text: string): void {
    $('pause-sub').textContent = text;
  }

  bindSettings(initial: Settings, storageOk: boolean, onChange: (s: Settings) => void): void {
    const vol = $('set-volume') as HTMLInputElement;
    const mute = $('set-mute') as HTMLInputElement;
    const sens = $('set-sens') as HTMLInputElement;
    const invertY = $('set-invert-y') as HTMLInputElement;
    const invertX = $('set-invert-x') as HTMLInputElement;
    const out = $('set-sens-out');
    vol.value = String(initial.volume);
    mute.checked = initial.muted;
    sens.value = String(initial.aimSensitivity);
    invertY.checked = initial.invertPadY;
    invertX.checked = initial.invertPadX;
    out.textContent = `${initial.aimSensitivity.toFixed(2)}×`;
    $('set-storage').textContent = storageOk
      ? 'Settings, best scores and the scoreboard are saved in this browser for this address.'
      : 'This browser is not allowing saves, so settings and scores last until you close the page.';
    const emit = () => {
      out.textContent = `${Number(sens.value).toFixed(2)}×`;
      onChange({ volume: Number(vol.value), muted: mute.checked, aimSensitivity: Number(sens.value), invertPadY: invertY.checked, invertPadX: invertX.checked });
    };
    vol.addEventListener('input', emit);
    mute.addEventListener('change', emit);
    sens.addEventListener('input', emit);
    invertY.addEventListener('change', emit);
    invertX.addEventListener('change', emit);
  }
}
