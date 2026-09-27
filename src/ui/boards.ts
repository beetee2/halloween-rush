import type { CareerRow, LevelRow } from '../net/scoreSync';
import type { ScoreEntry } from '../types';

export type BoardTab = 'runs' | 'career' | 'levels';

export interface BoardsView {
  runs: readonly ScoreEntry[];
  /** The runs came from the host (everyone on the network), not just this device. */
  shared: boolean;
  /** Run to highlight: the one that just ended. */
  highlight: string | null;
  /** Shown for the highlighted run while it still waits for its name (null once named). */
  pendingName: string | null;
  /** Host-only boards; null when the host can't be reached. */
  career: readonly CareerRow[] | null;
  levels: readonly LevelRow[] | null;
}

const TABS: ReadonlyArray<[BoardTab, string]> = [
  ['runs', 'Scoreboard'],
  ['career', 'Career'],
  ['levels', 'Level bests'],
];

const OFFLINE = "This shows up when this device can reach the game host (the computer running serve:lan).";

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
/** "Haunted House" → "House", "Pumpkin Patch" → "Patch". */
const shortMap = (map: string) => map.split(' ').at(-1) ?? map;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

/** Scoreboard / Career / Level bests, as tabs. Names are always set as text, never HTML. */
export class BoardPanel {
  private tab: BoardTab = 'runs';
  private readonly tabs = new Map<BoardTab, HTMLButtonElement>();
  private readonly lists = new Map<BoardTab, HTMLOListElement>();
  private readonly note: HTMLElement;
  private view: BoardsView | null = null;
  /** Name cell of the highlighted row while it waits for a name; mirrors the name box. */
  pendingCell: HTMLElement | null = null;

  constructor(root: HTMLElement) {
    const bar = el('div', 'tabs');
    bar.setAttribute('role', 'tablist');
    for (const [id, label] of TABS) {
      const b = el('button', '', label);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.addEventListener('click', () => this.select(id));
      bar.append(b);
      this.tabs.set(id, b);
      const list = el('ol', id === 'levels' ? 'scoreboard' : 'scoreboard ranked');
      list.setAttribute('aria-label', label);
      this.lists.set(id, list);
    }
    this.note = el('p', 'boards-note');
    root.append(bar, this.note, ...this.lists.values());
    this.select('runs');
  }

  select(tab: BoardTab): void {
    this.tab = tab;
    for (const [id, b] of this.tabs) b.setAttribute('aria-selected', String(id === tab));
    for (const [id, list] of this.lists) list.hidden = id !== tab;
    this.updateNote();
  }

  render(v: BoardsView): void {
    this.view = v;
    this.renderRuns(v);
    this.renderCareer(v.career);
    this.renderLevels(v.levels);
    this.updateNote();
  }

  private updateNote(): void {
    const v = this.view;
    const text: Record<BoardTab, string> = {
      runs: v?.shared ? 'Best runs by everyone on this network' : 'Best runs on this device',
      career: v?.career ? 'Most points over every game · average points per level on each map' : '',
      levels: v?.levels ? 'Best score for finishing each level' : '',
    };
    this.note.textContent = text[this.tab];
    this.note.hidden = !text[this.tab];
  }

  private fill(tab: BoardTab, rows: HTMLLIElement[], empty: string): void {
    this.lists.get(tab)!.replaceChildren(...(rows.length ? rows : [el('li', 'empty', empty)]));
  }

  private renderRuns(v: BoardsView): void {
    this.pendingCell = null;
    const rows = v.runs.map((s, i) => {
      const li = el('li', '');
      const name = el('span', 'name', s.name);
      li.append(el('span', 'rank', String(i + 1)), name, el('span', 'lvl', s.level > 0 ? `Lv ${s.level}` : ''), el('b', '', fmt(s.score)));
      if (v.highlight !== null && s.runId === v.highlight) {
        li.className = 'you';
        if (v.pendingName !== null) {
          name.textContent = v.pendingName;
          this.pendingCell = name;
        }
      }
      return li;
    });
    this.fill('runs', rows, 'No scores yet. Be the first!');
  }

  private renderCareer(career: readonly CareerRow[] | null): void {
    if (!career) return this.fill('career', [], OFFLINE);
    const rows = career.map((c, i) => {
      const li = el('li', 'career');
      const who = el('div', 'who');
      const games = `${fmt(c.games)} ${c.games === 1 ? 'game' : 'games'} · best ${fmt(c.best)} · Lv ${c.furthest}`;
      const maps = c.maps.length ? `Avg/map: ${c.maps.map((m) => `${shortMap(m.map)} ${fmt(m.avg)}`).join(' · ')}` : '';
      who.append(el('span', 'name', c.name), el('span', 'detail', games));
      if (maps) who.append(el('span', 'detail maps', maps));
      li.append(el('span', 'rank', String(i + 1)), who, el('b', '', fmt(c.points)));
      return li;
    });
    this.fill('career', rows, 'No games yet.');
  }

  private renderLevels(levels: readonly LevelRow[] | null): void {
    if (!levels) return this.fill('levels', [], OFFLINE);
    const rows = levels.map((l) => {
      const li = el('li', '');
      li.append(el('span', 'rank', String(l.level)), el('span', 'name', l.name), el('span', 'lvl', shortMap(l.map)), el('b', '', fmt(l.score)));
      return li;
    });
    this.fill('levels', rows, 'No levels finished yet.');
  }
}
