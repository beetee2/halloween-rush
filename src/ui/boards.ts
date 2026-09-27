import { accuracy } from '../core/scoreboard';
import type { CareerRow, LevelRow, MapRow } from '../net/scoreSync';
import type { ScoreEntry } from '../types';

export type BoardTab = 'runs' | 'career' | 'maps' | 'levels';

export interface BoardsView {
  runs: readonly ScoreEntry[];
  /** The runs came from the host (everyone who plays there), not just this device. */
  shared: boolean;
  /** Run to highlight: the one that just ended. */
  highlight: string | null;
  /** Shown for the highlighted run while it still waits for its name (null once named). */
  pendingName: string | null;
  /** Host-only boards; null when the host can't be reached. */
  career: readonly CareerRow[] | null;
  /** Top 10 finished levels per map, grouped by map in play order. */
  maps: readonly MapRow[] | null;
  levels: readonly LevelRow[] | null;
}

const TABS: ReadonlyArray<[BoardTab, string]> = [
  ['runs', 'Scoreboard'],
  ['career', 'Career'],
  ['maps', 'Maps'],
  ['levels', 'Level bests'],
];

const OFFLINE = "This shows up when this device can reach the game's scores server.";

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
/** "Haunted House" → "House", "Pumpkin Patch" → "Patch". */
const shortMap = (map: string) => map.split(' ').at(-1) ?? map;
/** " · 62%", or nothing before the first recorded shot. */
const hitRate = (hits = 0, shots = 0) => {
  const pct = accuracy(hits, shots);
  return pct === null ? '' : ` · ${pct}%`;
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

/** Scoreboard / Career / Maps / Level bests, as tabs. Names are always set as text, never HTML. */
export class BoardPanel {
  private tab: BoardTab = 'runs';
  private readonly tabs = new Map<BoardTab, HTMLButtonElement>();
  /** One list per tab; Maps holds a heading and a list per map instead. */
  private readonly lists = new Map<BoardTab, HTMLElement>();
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
      const list = id === 'maps' ? el('div', 'map-boards') : el('ol', id === 'levels' ? 'scoreboard' : 'scoreboard ranked');
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
    this.renderMaps(v.maps);
    this.renderLevels(v.levels);
    this.updateNote();
  }

  private updateNote(): void {
    const v = this.view;
    const text: Record<BoardTab, string> = {
      runs: v?.shared ? 'Best runs by everyone who plays here' : 'Best runs on this device',
      career: v?.career ? 'Most points over every game · accuracy · average points per level on each map' : '',
      maps: v?.maps ? 'Best 10 finished levels on each map · accuracy' : '',
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
      li.append(el('span', 'rank', String(i + 1)), name, el('span', 'lvl', s.level > 0 ? `Lv ${s.level}${hitRate(s.hits, s.shots)}` : ''), el('b', '', fmt(s.score)));
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
      const games = `${fmt(c.games)} ${c.games === 1 ? 'game' : 'games'} · best ${fmt(c.best)} · Lv ${c.furthest}${hitRate(c.hits, c.shots)}`;
      const maps = c.maps.length ? `Avg/map: ${c.maps.map((m) => `${shortMap(m.map)} ${fmt(m.avg)}`).join(' · ')}` : '';
      who.append(el('span', 'name', c.name), el('span', 'detail', games));
      if (maps) who.append(el('span', 'detail maps', maps));
      li.append(el('span', 'rank', String(i + 1)), who, el('b', '', fmt(c.points)));
      return li;
    });
    this.fill('career', rows, 'No games yet.');
  }

  private renderMaps(maps: readonly MapRow[] | null): void {
    const box = this.lists.get('maps')!;
    const empty = (text: string) => {
      const list = el('ol', 'scoreboard');
      list.append(el('li', 'empty', text));
      box.replaceChildren(list);
    };
    if (!maps) return empty(OFFLINE);
    if (!maps.length) return empty('No levels finished yet.');
    const sections: HTMLElement[] = [];
    for (const map of new Set(maps.map((m) => m.map))) {
      const list = el('ol', 'scoreboard ranked');
      list.setAttribute('aria-label', `${map} top 10`);
      maps
        .filter((m) => m.map === map)
        .forEach((m, i) => {
          const li = el('li', '');
          li.append(el('span', 'rank', String(i + 1)), el('span', 'name', m.name), el('span', 'lvl', `Lv ${m.level}${hitRate(m.hits, m.shots)}`), el('b', '', fmt(m.score)));
          list.append(li);
        });
      sections.push(el('h3', 'map-name', map), list);
    }
    box.replaceChildren(...sections);
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
