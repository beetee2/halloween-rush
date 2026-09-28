import * as THREE from 'three';
import type { AudioEngine, Sfx } from './audio/audio';
import { CONFIG } from './config';
import { levelParams } from './core/difficulty';
import { FireControl } from './core/fireControl';
import { emptyInventory, inventoryTotal } from './core/inventory';
import type { SaveStore } from './core/persistence';
import { Rng, randomSeed } from './core/rng';
import { RunModel } from './core/run';
import { approvedName, nameProblem } from './core/names.mjs';
import { addScore, careerRank, cleanName, DEFAULT_NAME, mapRank } from './core/scoreboard';
import { InputManager } from './input/input';
import { newId } from './net/device';
import { shotTuple, type Boards, type ScoreSync } from './net/scoreSync';
import { Effects, SPLAT_COLORS } from './render/effects';
import { ENVIRONMENTS, environmentName, type Environment } from './render/environments';
import { CandyBag, Launcher } from './render/hud3d';
import { ModelLibrary } from './render/models/characters';
import { Stage } from './render/stage';
import { IncomingPumpkin, SpiderTarget, type Target } from './sim/targets';
import { World } from './sim/world';
import { CANDY_FOR_TARGET, type ScoreEntry, type Settings, type TargetKind } from './types';
import type { BoardsView } from './ui/boards';
import type { UI } from './ui/ui';

/** Sound played when each kind of shootable target appears. */
const SPAWN_SFX: Readonly<Record<TargetKind, Sfx>> = {
  frankenstein: 'frankenstein',
  witch: 'cackle',
  spider: 'spider',
  incomingPumpkin: 'pumpkin',
  candyCorn: 'candyCorn',
  sucker: 'sucker',
};

export interface GameOptions {
  canvas: HTMLCanvasElement;
  ui: UI;
  audio: AudioEngine;
  store: SaveStore;
  /** Reports runs to the household scores database and brings back the leaderboards. */
  scores: ScoreSync;
  touchDevice: boolean;
  seed?: number;
}

const tmpDir = new THREE.Vector3();
const tmpAim = new THREE.Vector3();
const tmpMuzzle = new THREE.Vector3();
const tmpLocal = new THREE.Vector3();
const screenPos = { x: 0, y: 0 };

/**
 * Orchestrates one player's session: state machine (RunModel), simulation (World),
 * rendering (Stage), input, audio and UI. Each browser tab owns an independent Game;
 * gameplay is never shared, only finished levels and names go to the host's scores database.
 */
export class Game {
  readonly stage: Stage;
  readonly lib = new ModelLibrary();
  readonly run: RunModel;
  readonly world: World;
  readonly input: InputManager;
  readonly effects = new Effects();
  readonly launcher: Launcher;
  readonly bag: CandyBag;
  readonly fire = new FireControl(CONFIG.weapon.fireIntervalSec);
  private env: Environment;
  private envIndex = 0;
  private settings: Settings;
  /** This device's own best runs: shown when the game host can't be reached. */
  private scoreboard: ScoreEntry[];
  /** Best completed score per level number, merged from the host's boards. */
  private levelBests: number[];
  private playerName: string;
  /** Id of the current run in the scores database. */
  runId = '';
  /** A name was typed during this run, so it isn't asked for again. */
  private runNamed = false;
  /** Board the finished level made, e.g. "Best score ever on Level 3" (null if none). */
  private levelHonor: string | null = null;
  /** The results screen is waiting for a name after the level made a board. */
  private askingLevelName = false;
  /** The run that just ended made a board and is waiting for a name. */
  private pendingScore: ScoreEntry | null = null;
  readonly scores: ScoreSync;
  private teleport: { t: number; swapped: boolean; envIndex: number } | null = null;
  private lastFrame = 0;
  private rafId = 0;
  private time = 0;
  private lastCountdown = 0;
  private goTimer = 0;
  private shake = 0;
  private pendingPause = false;
  private stopped = false;
  private portraitBlocked = false;
  private readonly ui: UI;
  private readonly audio: AudioEngine;
  private readonly store: SaveStore;
  private readonly cleanup: Array<() => void> = [];
  /** Total pumpkins launched this session (diagnostics and automated tests). */
  shotsFired = 0;

  constructor(opts: GameOptions) {
    this.ui = opts.ui;
    this.audio = opts.audio;
    this.store = opts.store;
    const saved = this.store.load();
    this.settings = saved.settings;
    this.scoreboard = saved.scoreboard;
    this.levelBests = saved.levelBests;
    this.playerName = saved.playerName;
    this.scores = opts.scores;
    this.scores.onBoards = (b) => this.onBoards(b);
    this.run = new RunModel(saved.bests);

    this.stage = new Stage(opts.canvas, { touchDevice: opts.touchDevice });
    this.env = ENVIRONMENTS[0]!.build();
    this.stage.scene.add(this.env.group);
    this.applyFog();

    this.world = new World(this.lib, new Rng(opts.seed ?? randomSeed()), {
      targetHit: (t, p, pts, headshot) => this.onTargetHit(t, p, pts, headshot),
      sceneryHit: (p) => {
        this.effects.burst(p, SPLAT_COLORS.scenery!, 10, 3, 0.07);
        this.audio.play('scenery', this.pan(p));
      },
      playerHit: (damaged) => this.onPlayerHit(damaged),
      spiderPrepare: (s) => this.audio.play('hiss', this.pan(s.position)),
      spiderThrow: (from) => {
        this.audio.play('throw', this.pan(from));
        this.audio.play('pumpkin', this.pan(from));
      },
      targetSpawned: (t) => this.audio.play(SPAWN_SFX[t.kind], this.pan(t.position)),
    });
    this.stage.scene.add(this.world.root, this.effects.mesh);

    this.launcher = new Launcher(this.lib);
    this.bag = new CandyBag(this.lib);
    this.bag.onLand = () => {
      this.audio.play('candy');
      this.bag.setContents(this.run.totalInventory);
    };
    this.stage.hud3d.add(this.launcher.root, this.bag.root);
    this.stage.hud3d.visible = false;
    this.stage.onResize = (hw, hh) => {
      this.launcher.layout(hw, hh);
      this.bag.layout(hw, hh);
    };
    this.stage.resize(true);

    this.input = new InputManager(
      opts.canvas,
      document.getElementById('btn-fire')!,
      {
        onPauseRequest: () => this.togglePause(),
        onLockLost: () => this.autoPause('The mouse was released. Click Resume to keep playing.'),
        onModeChange: (m) => {
          this.ui.setTouchMode(m === 'touch');
          this.checkOrientation();
        },
        onGesture: () => this.audio.unlock(),
      },
      opts.touchDevice,
    );
    this.ui.setTouchMode(opts.touchDevice);
    this.applySettings(this.settings, false);
    this.bindUi();
    this.bindWindow(opts.canvas);
    this.ui.setTitleBests(this.run.bests);
    this.ui.setDevice(this.scores.device.label, this.scores.device.id);
    this.ui.show('title');
    this.checkOrientation();
    // Fetch the leaderboards, and deliver anything left over from last time.
    void this.scores.flush();
  }

  // ------------------------------------------------------------------ lifecycle
  start(): void {
    this.lastFrame = performance.now();
    const frame = (now: number) => {
      if (this.stopped) return;
      this.rafId = requestAnimationFrame(frame);
      try {
        this.tick(now);
      } catch (err) {
        this.fatal(err);
      }
    };
    this.rafId = requestAnimationFrame(frame);
  }

  fatal(err: unknown): void {
    this.stopped = true;
    cancelAnimationFrame(this.rafId);
    console.error(err);
    this.input.exitLock();
    this.audio.suspend();
    this.ui.showError('Something went wrong while running the game.', [
      'Reload the page to start again.',
      'If it keeps happening, try another browser or close other heavy tabs.',
      `Details: ${err instanceof Error ? err.message : String(err)}`,
    ]);
  }

  private bindUi(): void {
    const ui = this.ui;
    const click = (id: string, fn: () => void) =>
      ui.on(id, () => {
        this.audio.unlock();
        this.audio.play('click');
        fn();
      });
    click('btn-start', () => this.startNewRun());
    click('btn-newrun', () => this.startNewRun());
    click('btn-next', () => this.nextLevel());
    click('btn-replay', () => this.replayLevel());
    click('btn-resume', () => this.resume());
    click('btn-quit', () => this.quitToTitle());
    click('btn-title', () => this.quitToTitle());
    click('btn-settings-title', () => ui.openSettings());
    click('btn-boards', () => this.openBoards());
    click('btn-boards-done', () => ui.show('title'));
    click('btn-settings-pause', () => ui.openSettings());
    click('btn-settings-done', () => ui.closeSettings());
    const pauseBtn = document.getElementById('btn-pause')!;
    pauseBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    click('btn-pause', () => this.togglePause());
    ui.bindSettings(this.settings, this.store.available, (s) => this.applySettings(s, true));
    ui.onSaveScore((name) => this.saveScore(name));
    ui.onSaveLevelName((name) => this.saveLevelName(name));
  }

  private bindWindow(canvas: HTMLCanvasElement): void {
    const on = (t: EventTarget, type: string, fn: (e: Event) => void) => {
      t.addEventListener(type, fn);
      this.cleanup.push(() => t.removeEventListener(type, fn));
    };
    on(window, 'resize', () => {
      this.stage.resize();
      this.checkOrientation();
    });
    on(window, 'orientationchange', () => this.checkOrientation());
    on(document, 'visibilitychange', () => {
      if (document.hidden) this.autoPause('Paused while the game was hidden.');
    });
    on(window, 'blur', () => this.autoPause('Paused because the window lost focus.'));
    on(window, 'pagehide', () => this.autoPause('Paused.'));
    on(canvas, 'webglcontextlost', (e) => {
      e.preventDefault();
      this.autoPause('Graphics were interrupted. Waiting for them to come back…');
    });
    on(canvas, 'webglcontextrestored', () => this.ui.setPauseMessage('Graphics are back. Resume when ready.'));
  }

  private applySettings(s: Settings, persist: boolean): void {
    this.settings = { ...s };
    this.audio.setVolume(s.volume, s.muted);
    this.input.sensitivity = s.aimSensitivity;
    if (persist) this.persist();
  }

  private persist(): void {
    this.store.save({ settings: this.settings, bests: this.run.bests, scoreboard: this.scoreboard, playerName: this.playerName, levelBests: this.levelBests });
  }

  private applyFog(): void {
    this.stage.scene.fog = new THREE.Fog(this.env.fog.color, this.env.fog.near, this.env.fog.far);
    this.stage.scene.background = new THREE.Color(this.env.fog.color);
  }

  // ------------------------------------------------------------------ flows
  startNewRun(): void {
    if (this.portraitBlocked) return;
    if (!this.run.startNewRun()) return;
    this.runId = newId();
    this.runNamed = false;
    this.pendingScore = null;
    this.scores.record({ type: 'run', id: this.runId, player: this.playerName });
    this.world.clear();
    this.effects.clear();
    this.bag.clearFlights();
    this.bag.setContents(emptyInventory());
    this.enterRunUi();
    this.audio.startMusic();
    this.beginTeleport();
  }

  nextLevel(): void {
    if (this.portraitBlocked || !this.run.nextLevel()) return;
    this.enterRunUi();
    this.beginTeleport();
  }

  replayLevel(): void {
    if (this.portraitBlocked || !this.run.replayLevel()) return;
    this.enterRunUi();
    this.beginTeleport();
  }

  private enterRunUi(): void {
    this.ui.show(null);
    this.ui.setHudVisible(true);
    this.ui.resetHudCache();
    this.stage.hud3d.visible = true;
    this.input.requestLock();
    this.audio.resume();
  }

  quitToTitle(): void {
    if (!this.run.quitToTitle()) return;
    this.world.clear();
    this.effects.clear();
    this.bag.clearFlights();
    this.bag.setContents(emptyInventory());
    this.teleport = null;
    this.ui.teleport(null);
    this.ui.countdown(null);
    this.ui.setHint(null);
    this.ui.setWarnings([]);
    this.ui.setHudVisible(false);
    this.stage.hud3d.visible = false;
    this.input.enabled = false;
    this.input.clearHeld();
    this.input.exitLock();
    this.audio.stopMusic();
    this.ui.setTitleBests(this.run.bests);
    this.ui.show('title');
  }

  private beginTeleport(): void {
    const envIndex = levelParams(this.run.levelIndex).environmentIndex;
    this.teleport = { t: 0, swapped: false, envIndex };
    this.input.enabled = false;
    this.input.clearHeld();
    this.fire.reset();
    this.ui.countdown(null);
    this.ui.setWarnings([]);
    const p = levelParams(this.run.levelIndex);
    this.ui.teleport('in', `Level ${this.run.levelIndex + 1}: ${environmentName(envIndex)}${p.night > 1 ? ` · Night ${p.night}` : ''}`);
    this.audio.play('teleport');
  }

  private updateTeleport(dt: number): void {
    const tp = this.teleport;
    if (!tp) return;
    tp.t += dt;
    if (!tp.swapped && tp.t >= CONFIG.teleport.inSec) {
      this.swapScene(tp.envIndex);
      tp.swapped = true;
      this.ui.teleport('out', document.getElementById('teleport-label')?.textContent ?? '');
    }
    if (tp.swapped && tp.t >= CONFIG.teleport.inSec + CONFIG.teleport.outSec) this.finishTeleport();
  }

  private swapScene(envIndex: number): void {
    this.world.clear();
    this.effects.clear();
    this.bag.clearFlights();
    if (envIndex !== this.envIndex) {
      this.env.dispose();
      this.env = ENVIRONMENTS[envIndex]!.build();
      this.stage.scene.add(this.env.group);
      this.envIndex = envIndex;
      this.applyFog();
    }
    this.world.reset(levelParams(this.run.levelIndex), this.env.layout);
    this.bag.setContents(this.run.totalInventory);
    this.input.resetAim();
    this.ui.resetHudCache();
  }

  private finishTeleport(): void {
    this.teleport = null;
    this.ui.teleport(null);
    if (!this.run.sceneReady()) return;
    this.lastCountdown = 0;
    this.input.enabled = true;
    if (this.pendingPause || document.hidden || this.portraitBlocked) {
      this.pendingPause = false;
      this.pause('Paused. Resume when you are ready.');
    }
  }

  togglePause(): void {
    if (this.run.phase === 'paused') this.resume();
    else if (this.run.phase === 'playing' || this.run.phase === 'countdown') this.pause('Take a breather — the monsters will wait.');
  }

  private autoPause(message: string): void {
    this.input.clearHeld();
    this.fire.cancel();
    if (this.run.phase === 'teleporting') this.pendingPause = true;
    else this.pause(message);
  }

  pause(message: string): void {
    if (!this.run.pause()) return;
    this.input.clearHeld();
    this.fire.cancel();
    this.input.enabled = false;
    this.input.exitLock();
    this.audio.suspend();
    this.ui.countdown(null);
    this.ui.setWarnings([]);
    this.ui.setPauseMessage(message);
    this.ui.show('pause');
  }

  resume(): void {
    if (this.portraitBlocked || this.run.phase !== 'paused') return;
    this.audio.resume();
    this.input.requestLock();
    if (!this.run.resume()) return;
    this.ui.show(null);
    this.input.enabled = true;
    this.lastCountdown = 0;
    this.lastFrame = performance.now();
  }

  private onLevelComplete(): void {
    this.endOfLevelInput();
    this.recordAttempt(true);
    const levelNumber = this.run.levelIndex + 1;
    const map = environmentName(this.envIndex);
    const levelBest = this.raiseLevelBest(levelNumber, this.run.levelScore);
    const mapPlace = this.scores.boards ? mapRank(this.scores.boards.maps, map, this.run.levelScore) : null;
    this.levelHonor = levelBest ? `Best score ever on Level ${levelNumber}` : mapPlace !== null ? `#${mapPlace + 1} on the ${map} board` : null;
    this.askingLevelName = this.levelHonor !== null && !this.runNamed;
    this.persist();
    this.audio.play('complete');
    const next = levelParams(this.run.levelIndex + 1);
    this.ui.showResults({
      envName: map,
      levelNumber,
      levelScore: this.run.levelScore,
      hits: this.run.levelHits,
      shots: this.run.shots.length,
      total: this.run.totalScore,
      levelCandy: this.run.levelInventory,
      newBest: this.run.newBest,
      nextEnvName: environmentName(next.environmentIndex),
      honor: this.levelHonor,
      askName: this.askingLevelName,
      name: this.playerName,
    });
  }

  private saveLevelName(raw: string): void {
    if (!this.askingLevelName || !this.levelHonor || this.run.phase !== 'levelComplete') return;
    const typed = this.acceptName(raw, 'results');
    if (typed === null) return;
    this.askingLevelName = false;
    const name = this.nameRun(typed);
    this.audio.unlock();
    this.audio.play('candy');
    this.ui.showLevelNameSaved(this.levelHonor, name);
  }

  private onGameOver(): void {
    this.endOfLevelInput();
    this.recordAttempt(false);
    this.persist();
    this.audio.play('gameOver');
    const run = this.run;
    const entry: ScoreEntry = { name: this.playerName || DEFAULT_NAME, score: run.totalScore, level: run.levelIndex + 1, runId: this.runId, shots: run.runShots, hits: run.runHits };
    const board = this.runBoard();
    const preview = addScore(board.runs, entry);
    const honor = this.runHonor(preview.rank, entry.score, this.playerName);
    const asking = honor !== null && !this.runNamed;
    this.pendingScore = asking ? entry : null;
    if (!asking) this.addLocalScore(entry);
    this.ui.showGameOver({
      levelNumber: run.levelIndex + 1,
      envName: environmentName(this.envIndex),
      total: run.totalScore,
      hits: run.runHits,
      shots: run.runShots,
      candy: run.totalInventory,
      newBest: run.newBest,
      honor,
      asking,
      name: this.playerName,
      boards: this.boardsView(preview.board, board.shared, this.runId, asking ? entry.name : null),
    });
  }

  /** Put the finished run on the scoreboard under the typed name (once per run). */
  private saveScore(raw: string): void {
    const entry = this.pendingScore;
    if (!entry || this.run.phase !== 'gameOver') return;
    const typed = this.acceptName(raw, 'gameOver');
    if (typed === null) return;
    this.pendingScore = null;
    const name = this.nameRun(typed);
    const named = { ...entry, name: name || DEFAULT_NAME };
    this.addLocalScore(named);
    const board = this.runBoard();
    const { board: runs, rank } = addScore(board.runs, named);
    this.audio.unlock();
    this.audio.play('complete');
    this.ui.showSavedScore(this.boardsView(runs, board.shared, this.runId), this.runHonor(rank, named.score, name));
  }

  /**
   * The board a finished run made, for its badge and name prompt: its place on the scoreboard,
   * else on the career board (host only), else null. `name` is the run's name ('' = guest).
   */
  private runHonor(scoreboardRank: number | null, score: number, name: string): string | null {
    if (scoreboardRank !== null) return `#${scoreboardRank + 1} on the scoreboard`;
    const career = this.scores.boards?.career;
    const place = career ? careerRank(career, name || `Guest (${this.scores.device.label})`, score) : null;
    return place === null ? null : `#${place + 1} in career points`;
  }

  /**
   * The typed name if it may go on the scoreboard ('' if the box was left empty). Otherwise the
   * name box stays up and says why, and this returns null.
   */
  private acceptName(raw: string, screen: 'results' | 'gameOver'): string | null {
    const typed = cleanName(raw);
    const problem = typed ? nameProblem(typed) : '';
    if (!problem) return approvedName(typed);
    this.ui.rejectName(screen, problem);
    return null;
  }

  /** The player saved a name: it belongs to this whole run and is offered again next time. */
  private nameRun(name: string): string {
    this.playerName = name;
    this.runNamed = true;
    this.scores.record({ type: 'name', runId: this.runId, name: this.playerName });
    this.persist();
    return this.playerName;
  }

  private recordAttempt(completed: boolean): void {
    const run = this.run;
    this.scores.record({
      type: 'attempt',
      runId: this.runId,
      attempt: run.attempt,
      level: run.levelIndex + 1,
      map: environmentName(this.envIndex),
      score: run.levelScore,
      completed,
      shots: run.shots.map(shotTuple),
    });
  }

  /** Remember a level's best score; true if `score` beats everyone's so far. */
  private raiseLevelBest(levelNumber: number, score: number): boolean {
    if (!(score > (this.levelBests[levelNumber - 1] ?? 0))) return false;
    while (this.levelBests.length < levelNumber) this.levelBests.push(0);
    this.levelBests[levelNumber - 1] = score;
    return true;
  }

  private addLocalScore(entry: ScoreEntry): void {
    this.scoreboard = addScore(this.scoreboard, entry).board;
    this.persist();
  }

  /** Everyone's best runs once the host has answered, else this device's own; never the current run. */
  private runBoard(): { runs: ScoreEntry[]; shared: boolean } {
    const b = this.scores.boards;
    const others = (e: ScoreEntry) => e.runId !== this.runId;
    return b ? { runs: b.runs.filter(others), shared: true } : { runs: this.scoreboard.filter(others), shared: false };
  }

  private boardsView(runs: readonly ScoreEntry[], shared: boolean, highlight: string | null, pendingName: string | null = null): BoardsView {
    const b = this.scores.boards;
    const order = (map: string) => ENVIRONMENTS.findIndex((e) => e.name === map);
    return {
      runs,
      shared,
      highlight,
      pendingName,
      levels: b?.levels ?? null,
      maps: b ? [...b.maps].sort((x, y) => order(x.map) - order(y.map)) : null,
      career: b ? b.career.map((c) => ({ ...c, maps: [...c.maps].sort((x, y) => order(x.map) - order(y.map)) })) : null,
    };
  }

  private openBoards(): void {
    const b = this.scores.boards;
    this.ui.openBoards(this.boardsView(b ? b.runs : this.scoreboard, b !== null, null));
    void this.scores.flush();
  }

  private onBoards(b: Boards): void {
    let raised = false;
    for (const l of b.levels) if (l.level <= 500) raised = this.raiseLevelBest(l.level, l.score) || raised;
    if (raised) this.persist();
    // Keep the board still while someone is typing their name.
    if (this.pendingScore) return;
    this.ui.refreshBoards(this.boardsView(b.runs, true, this.ui.current === 'gameOver' ? this.runId : null));
  }

  private endOfLevelInput(): void {
    this.input.enabled = false;
    this.input.clearHeld();
    this.fire.cancel();
    this.input.exitLock();
    this.ui.setWarnings([]);
    this.ui.setHint(null);
  }

  private checkOrientation(): void {
    const portrait = window.innerHeight > window.innerWidth * 1.05;
    const blocked = portrait && this.input.mode === 'touch';
    this.portraitBlocked = blocked;
    this.ui.setRotatePrompt(blocked);
    if (blocked) this.autoPause('Turn your device sideways, then tap Resume.');
  }

  // ------------------------------------------------------------------ frame
  private tick(now: number): void {
    const dt = Math.min(CONFIG.sim.maxFrameSec, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.time += dt;
    const phase = this.run.phase;

    if (phase === 'title') {
      this.stage.yaw = Math.sin(this.time * 0.15) * 0.3;
      this.stage.pitch = 0.1 + Math.sin(this.time * 0.1) * 0.03;
    } else {
      this.stage.yaw = this.input.yaw;
      this.stage.pitch = this.input.pitch;
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      this.stage.yaw += (Math.random() - 0.5) * this.shake * 0.08;
      this.stage.pitch += (Math.random() - 0.5) * this.shake * 0.08;
    }
    this.stage.applyAim();

    if (this.teleport) this.updateTeleport(dt);
    if (phase === 'countdown' || phase === 'playing') this.simulate(dt);

    if (this.run.phase !== 'paused') {
      this.effects.update(dt);
      this.bag.update(dt, this.time);
      if (this.run.phase !== 'playing') this.world.sweep(dt);
    }
    this.launcher.update(dt, this.fire.remaining <= 0, this.time);
    this.env.update(this.time);

    if (this.goTimer > 0) {
      this.goTimer -= dt;
      if (this.goTimer <= 0) this.ui.countdown(null);
    }
    if (this.run.phase !== 'title') this.updateHud();
    this.stage.render();
  }

  /** Split the frame into bounded simulation steps so collisions and timers stay exact. */
  private simulate(dt: number): void {
    let remaining = dt;
    while (remaining > 1e-9) {
      const phase = this.run.phase;
      if (phase !== 'countdown' && phase !== 'playing') break;
      const h = Math.min(CONFIG.sim.maxStepSec, remaining);
      remaining -= h;
      this.fixedStep(h);
    }
  }

  /** One simulation step. Public so e2e fixtures can fast-forward deterministically. */
  fixedStep(h: number): void {
    const run = this.run;
    if (run.phase === 'countdown') {
      this.input.consumePress(); // presses during the countdown never queue a shot
      const outcome = run.advance(h);
      const v = Math.ceil(run.countdownRemaining);
      if (outcome === 'started') {
        this.ui.countdown('RUSH!');
        this.goTimer = 0.7;
        this.audio.play('go');
      } else if (v !== this.lastCountdown && v > 0) {
        this.lastCountdown = v;
        this.ui.countdown(String(v));
        this.audio.play('beep');
      }
      return;
    }
    if (run.phase !== 'playing') return;
    if (this.input.consumePress()) this.fire.press();
    if (this.fire.update(h, this.input.fireHeld)) this.shoot();
    this.world.step(h, run);
    const outcome = run.advance(h);
    if (outcome === 'levelComplete') this.onLevelComplete();
    else if (outcome === 'gameOver') this.onGameOver();
  }

  private shoot(): void {
    const cam = this.stage.camera;
    cam.getWorldDirection(tmpDir);
    this.world.aimPoint(cam.position, tmpDir, tmpAim);
    this.launcher.muzzleWorld(tmpMuzzle);
    const shot = this.run.fireShot(this.input.yaw, this.input.pitch);
    this.world.fire(tmpMuzzle, tmpAim, this.run, shot);
    this.shotsFired++;
    this.launcher.fire();
    this.audio.play('fire');
    this.effects.burst(tmpMuzzle, [0xffb04a, 0xfff2c0], 4, 1.2, 0.025);
  }

  private onTargetHit(t: Target, point: THREE.Vector3, points: number, headshot: boolean): void {
    this.effects.burst(point, SPLAT_COLORS[t.kind] ?? SPLAT_COLORS.scenery!, t.kind === 'frankenstein' ? 22 : 16, 5, t.kind === 'spider' ? 0.07 : 0.1);
    this.audio.play('splat', this.pan(point));
    if (points > 0 && this.stage.project(point, screenPos)) this.ui.popup(screenPos.x, screenPos.y, points, t.size, headshot);
    // Fly a miniature candy from where the target was into the bag.
    tmpLocal.copy(point);
    this.stage.camera.worldToLocal(tmpLocal);
    if (tmpLocal.z < -0.1) {
      tmpLocal.multiplyScalar(0.9 / -tmpLocal.z);
      this.bag.launch(CANDY_FOR_TARGET[t.kind], tmpLocal);
    } else {
      this.bag.launch(CANDY_FOR_TARGET[t.kind], new THREE.Vector3(0, 0, -0.9));
    }
  }

  private onPlayerHit(damaged: boolean): void {
    this.ui.damageFlash(damaged);
    if (damaged) {
      this.audio.play('hurt');
      this.shake = 0.45;
    } else this.audio.play('block');
    this.effects.burst(this.world.eye.clone().add(tmpDir.set(0, -0.3, -1.2).applyQuaternion(this.stage.camera.quaternion)), SPLAT_COLORS.incomingPumpkin!, 12, 2, 0.05);
  }

  private pan(p: THREE.Vector3): number {
    tmpLocal.copy(p);
    this.stage.camera.worldToLocal(tmpLocal);
    return Math.max(-1, Math.min(1, tmpLocal.x / Math.max(2, -tmpLocal.z)));
  }

  private updateHud(): void {
    const run = this.run;
    const p = levelParams(run.levelIndex);
    this.ui.updateHud({
      levelNumber: run.levelIndex + 1,
      envName: environmentName(p.environmentIndex),
      night: p.night,
      time: run.timeRemaining,
      hearts: run.hearts,
      levelScore: run.levelScore,
      total: run.totalScore,
      candy: inventoryTotal(run.totalInventory),
    });
    this.ui.setCrosshair(this.fire.remaining > 0);
    const playing = run.phase === 'playing' || run.phase === 'countdown';
    this.ui.setHint(playing && this.input.mode === 'mouse' && !this.input.locked ? 'Drag to aim · click or press Space to fire' : null);
    this.ui.setWarnings(playing ? this.offscreenThreats() : []);
  }

  /** Edge arrows for incoming pumpkins and winding-up spiders outside the view. */
  private offscreenThreats(): Array<{ x: number; y: number; angleDeg: number }> {
    const out: Array<{ x: number; y: number; angleDeg: number }> = [];
    const { width, height } = this.stage.size;
    const margin = 40;
    for (const t of this.world.targets) {
      if (!t.alive) continue;
      if (!(t instanceof IncomingPumpkin) && !(t instanceof SpiderTarget && t.preparing)) continue;
      tmpLocal.copy(t.position).project(this.stage.camera);
      let nx = tmpLocal.x;
      let ny = tmpLocal.y;
      const behind = tmpLocal.z > 1;
      if (behind) {
        nx = -nx;
        ny = -ny;
      }
      if (!behind && Math.abs(nx) <= 1 && Math.abs(ny) <= 1) continue;
      const s = 1 / Math.max(Math.abs(nx), Math.abs(ny), 1e-6);
      const ex = nx * s;
      const ey = ny * s;
      const x = Math.min(width - margin, Math.max(margin, (ex * 0.5 + 0.5) * width));
      const y = Math.min(height - margin, Math.max(margin, (-ey * 0.5 + 0.5) * height));
      out.push({ x, y, angleDeg: (Math.atan2(nx, ny) * 180) / Math.PI });
      if (out.length >= 6) break;
    }
    return out;
  }

  /** Current environment (for tests and debugging). */
  get environment(): Environment {
    return this.env;
  }

  get teleporting(): boolean {
    return this.teleport !== null;
  }
}
