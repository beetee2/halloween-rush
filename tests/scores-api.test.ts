import { existsSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';
import { createScoresApi, openScores, type ScoresDb } from '../scripts/scores-api.mjs';
import { handleScores } from '../scripts/scores-core.mjs';
import { deviceLabel } from '../src/net/device';
import { ENVIRONMENTS } from '../src/render/environments';

const phone = { id: 'device-phone-0001', fingerprint: 'abc123', label: 'iPhone · Safari' };
const laptop = { id: 'device-laptop-0002', fingerprint: 'def456', label: 'Linux · Chrome' };

const run = (id: string, player = '') => ({ type: 'run', id, player });
const attempt = (runId: string, n: number, level: number, score: number, completed = true, map = 'Haunted House', shots?: unknown[]) => ({
  type: 'attempt',
  runId,
  attempt: n,
  level,
  map,
  score,
  completed,
  ...(shots ? { shots } : {}),
});
/** A shot log as the game sends it: `hits` far witch hits, then `misses` misses. */
const shotLog = (hits: number, misses: number) => [
  ...Array.from({ length: hits }, (_, i) => [1000 * i, 0.1, 0.05, 'witch', 'far', 45]),
  ...Array.from({ length: misses }, (_, i) => [500 + 1000 * i, -0.2, 0.3, null, null, 0]),
];

describe('scores database', () => {
  let db: ScoresDb;
  afterEach(() => db.close());

  it('totals a run the way the game does: Replay Level replaces the earlier attempt', async () => {
    db = openScores(':memory:');
    const r = await db.sync({
      device: phone,
      events: [run('run-aaaa-0001', 'Hudson'), attempt('run-aaaa-0001', 1, 1, 300), attempt('run-aaaa-0001', 2, 2, 500), attempt('run-aaaa-0001', 3, 2, 200), attempt('run-aaaa-0001', 4, 3, 40, false)],
    });
    expect(r).toEqual({ accepted: 5, rejected: 0 });
    const b = await db.boards();
    expect(b.runs).toEqual([{ runId: 'run-aaaa-0001', name: 'Hudson', score: 540, level: 3, shots: 0, hits: 0 }]);
    // Level bests count completed attempts, even one later replayed; a failed level never counts.
    expect(b.levels).toEqual([
      { level: 1, map: 'Haunted House', name: 'Hudson', score: 300, runId: 'run-aaaa-0001' },
      { level: 2, map: 'Haunted House', name: 'Hudson', score: 500, runId: 'run-aaaa-0001' },
    ]);
    expect(b.career).toHaveLength(1);
    expect(b.career[0]).toMatchObject({ name: 'Hudson', points: 540, games: 1, best: 540, furthest: 3 });
  });

  it('is idempotent, so a device can resend its outbox', async () => {
    db = openScores(':memory:');
    const events = [run('run-bbbb-0001'), attempt('run-bbbb-0001', 1, 1, 100)];
    await db.sync({ device: phone, events });
    await db.sync({ device: phone, events });
    expect((await db.boards()).runs).toEqual([{ runId: 'run-bbbb-0001', name: 'Guest (iPhone · Safari)', score: 100, level: 1, shots: 0, hits: 0 }]);
  });

  it('names a run afterwards and groups careers by name across devices', async () => {
    db = openScores(':memory:');
    await db.sync({ device: phone, events: [run('run-cccc-0001'), attempt('run-cccc-0001', 1, 1, 100), attempt('run-cccc-0001', 2, 2, 50, false, 'Graveyard')] });
    await db.sync({ device: phone, events: [{ type: 'name', runId: 'run-cccc-0001', name: '  Hudson ' }] });
    await db.sync({ device: laptop, events: [run('run-dddd-0001', 'hudson'), attempt('run-dddd-0001', 1, 1, 300)] });
    await db.sync({ device: laptop, events: [run('run-eeee-0001', 'Dad'), attempt('run-eeee-0001', 1, 1, 200)] });
    const { career, runs } = await db.boards();
    expect(runs.map((r) => r.name)).toEqual(['hudson', 'Dad', 'Hudson']);
    expect(career.map((c) => [c.name, c.points, c.games, c.best])).toEqual([
      ['hudson', 450, 2, 300],
      ['Dad', 200, 1, 200],
    ]);
    expect(career[0]!.maps).toEqual([
      { map: 'Graveyard', avg: 50, plays: 1 },
      { map: 'Haunted House', avg: 200, plays: 2 },
    ]);
  });

  it("rejects bad events and other devices' runs without failing the batch", async () => {
    db = openScores(':memory:');
    await db.sync({ device: phone, events: [run('run-ffff-0001', 'Hudson')] });
    const r = await db.sync({
      device: laptop,
      events: [
        attempt('run-ffff-0001', 1, 1, 999), // not the laptop's run
        { type: 'name', runId: 'run-ffff-0001', name: 'Hacker' },
        attempt('run-gggg-0001', 1, 1, 10), // run never created
        { type: 'attempt', runId: 'x', attempt: 1 },
        { type: 'mystery' },
        null,
        run('run-hhhh-0001'),
        attempt('run-hhhh-0001', 1, 1, 1.5),
        attempt('run-hhhh-0001', 2, 1, 20),
      ],
    });
    expect(r).toEqual({ accepted: 2, rejected: 7 });
    expect((await db.boards()).runs.map((x) => [x.name, x.score])).toEqual([['Guest (Linux · Chrome)', 20]]);
    expect(await db.sync({ device: { id: 'bad id!' }, events: [] })).toHaveProperty('error');
    expect(await db.sync({ device: phone, events: 'nope' })).toHaveProperty('error');
  });

  it('keeps the top ten runs, highest first, older first on ties', async () => {
    db = openScores(':memory:');
    const events: object[] = [];
    const names = ['Ava', 'Ben', 'Cora', 'Dan', 'Eli', 'Finn', 'Gia', 'Hugo', 'Ivy', 'Jack', 'Kai', 'Leo'];
    names.forEach((name, i) => events.push(run(`run-top-${String(i).padStart(4, '0')}`, name), attempt(`run-top-${String(i).padStart(4, '0')}`, 1, 1, i === 11 ? 50 : (i + 1) * 10)));
    await db.sync({ device: phone, events });
    const scores = (await db.boards()).runs.map((r) => `${r.name}:${r.score}`);
    expect(scores).toHaveLength(10);
    expect(scores.slice(0, 4)).toEqual(['Kai:110', 'Jack:100', 'Ivy:90', 'Hugo:80']);
    expect(scores.indexOf('Eli:50')).toBeLessThan(scores.indexOf('Leo:50'));
  });

  it('only puts approved names on the boards, whatever a client sends', async () => {
    db = openScores(':memory:');
    const r = await db.sync({
      device: phone,
      events: [
        run('run-mmmm-0001', 'Hudson'),
        attempt('run-mmmm-0001', 1, 1, 100),
        { type: 'name', runId: 'run-mmmm-0001', name: 'Poopy Pants' },
        { type: 'name', runId: 'run-mmmm-0001', name: 'Hudson69' },
        run('run-nnnn-0001', 'Buttface'),
        attempt('run-nnnn-0001', 1, 1, 50),
      ],
    });
    // The rude names are refused: the first run keeps its name, the second becomes a guest's.
    expect(r).toEqual({ accepted: 4, rejected: 2 });
    expect((await db.boards()).runs.map((x) => x.name)).toEqual(['Hudson', 'Guest (iPhone · Safari)']);
  });

  it('only shows device labels and maps the game makes', async () => {
    db = openScores(':memory:');
    const uas: Array<[string, number, boolean]> = [
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', 5, false],
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', 5, true],
      ['Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36', 5, false],
      ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 0, false],
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0', 0, false],
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/105.0.0.0', 0, false],
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:120.0) Gecko/20100101 Firefox/120.0', 0, false],
      ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 0, false],
      ['curl/8.5.0', 0, false],
    ];
    const labels = uas.map(([ua, touch, home]) => deviceLabel(ua, touch, home));
    for (const [i, label] of labels.entries()) {
      const id = `run-labl-000${i}`;
      await db.sync({ device: { id: `device-label-000${i}`, fingerprint: 'abc', label }, events: [run(id), attempt(id, 1, 1, 100 - i)] });
    }
    await db.sync({ device: { id: 'device-rude-0001', fingerprint: 'abc', label: 'Poop · Butt' }, events: [run('run-rude-0001'), attempt('run-rude-0001', 1, 1, 1)] });
    expect((await db.boards()).runs.map((x) => x.name)).toEqual([...labels, 'Unknown device'].map((l) => `Guest (${l})`));

    const maps = ENVIRONMENTS.map((e) => e.name);
    const r = await db.sync({ device: phone, events: [run('run-maps-0001'), ...maps.map((m, i) => attempt('run-maps-0001', i + 1, i + 1, 10, true, m)), attempt('run-maps-0001', 9, 9, 10, true, 'Poop Palace')] });
    expect(r).toEqual({ accepted: maps.length + 1, rejected: 1 });
    expect((await db.boards()).levels.map((l) => l.map)).toEqual(maps);
  });

  it('hides names saved before names were checked unless they are approved', async () => {
    const file = path.join(os.tmpdir(), `hr-old-names-${process.pid}.sqlite`);
    onTestFinished(() => {
      for (const ext of ['', '-wal', '-shm']) rmSync(file + ext, { force: true });
    });
    db = openScores(file);
    await db.sync({ device: phone, events: [run('run-oldn-0001', 'Hudson'), attempt('run-oldn-0001', 1, 1, 100), run('run-oldn-0002', 'Dad'), attempt('run-oldn-0002', 1, 1, 50)] });
    const raw = new DatabaseSync(file);
    raw.prepare('UPDATE runs SET player = ? WHERE id = ?').run('Stinky Butt', 'run-oldn-0002');
    raw.close();
    // Shown as a nameless player; the stored row is left alone.
    const { runs, career } = await db.boards();
    expect(runs.map((x) => x.name)).toEqual(['Hudson', 'Player']);
    expect(career.map((c) => c.name)).toEqual(['Hudson', 'Player']);
  });
});

describe('shots and the Maps board', () => {
  let db: ScoresDb;
  afterEach(() => db.close());

  it('records every shot and reports accuracy on the runs, maps and career boards', async () => {
    db = openScores(':memory:');
    await db.sync({
      device: phone,
      events: [
        run('run-shot-0001', 'Hudson'),
        attempt('run-shot-0001', 1, 1, 90, true, 'Haunted House', shotLog(2, 2)),
        attempt('run-shot-0001', 2, 1, 45, true, 'Haunted House', shotLog(1, 3)), // Replay Level
        attempt('run-shot-0001', 3, 2, 45, false, 'Graveyard', shotLog(1, 0)),
      ],
    });
    const b = await db.boards();
    // The score keeps only the replay, but accuracy counts every shot of the run.
    expect(b.runs).toEqual([{ runId: 'run-shot-0001', name: 'Hudson', score: 90, level: 2, shots: 9, hits: 4 }]);
    expect(b.career[0]).toMatchObject({ name: 'Hudson', points: 90, shots: 9, hits: 4 });
    // Maps list finished levels only, the replayed attempt included.
    expect(b.maps).toEqual([
      { map: 'Haunted House', name: 'Hudson', score: 90, level: 1, runId: 'run-shot-0001', shots: 4, hits: 2 },
      { map: 'Haunted House', name: 'Hudson', score: 45, level: 1, runId: 'run-shot-0001', shots: 4, hits: 1 },
    ]);
  });

  it('keeps the ten best finished levels on each map', async () => {
    db = openScores(':memory:');
    const events: object[] = [run('run-maps-0001', 'Hudson'), run('run-maps-0002', 'Dad')];
    for (let i = 1; i <= 12; i++) events.push(attempt('run-maps-0001', i, 1, i * 10));
    events.push(attempt('run-maps-0002', 1, 1, 999, false), attempt('run-maps-0002', 2, 2, 60, true, 'Graveyard'));
    await db.sync({ device: phone, events });
    const { maps } = await db.boards();
    expect(maps.filter((m) => m.map === 'Graveyard').map((m) => [m.name, m.score])).toEqual([['Dad', 60]]);
    const house = maps.filter((m) => m.map === 'Haunted House').map((m) => m.score);
    expect(house).toEqual([120, 110, 100, 90, 80, 70, 60, 50, 40, 30]); // Dad's 999 was a game over
  });

  it('rejects malformed shot logs, but takes levels from games before shot tracking', async () => {
    db = openScores(':memory:');
    const shots = (n: number, log: unknown) => ({ ...attempt('run-shot-0002', n, n, 10), shots: log });
    const r = await db.sync({
      device: phone,
      events: [
        run('run-shot-0002'),
        attempt('run-shot-0002', 1, 1, 10), // no shot log: an older game
        shots(2, [[0, 0, 0, 'witch', null, 5]]), // a hit without a range
        shots(3, [[0, 0, 0, null, null, 5]]), // points for a miss
        shots(4, [[0, 99, 0, null, null, 0]]), // impossible aim
        shots(5, [[0, 0, 0, '<b>', 'far', 5]]),
        shots(6, Array.from({ length: 1001 }, () => [0, 0, 0, null, null, 0])),
        shots(7, 'lots'),
      ],
    });
    expect(r).toEqual({ accepted: 2, rejected: 6 });
    expect((await db.boards()).runs[0]).toMatchObject({ score: 10, shots: 0, hits: 0 });
  });

  it('upgrades a database file from before shot tracking; the shots view lists every shot', async () => {
    const file = path.join(os.tmpdir(), `hr-upgrade-${process.pid}-${Date.now()}.sqlite`);
    try {
      const old = new DatabaseSync(file);
      old.exec(`
        CREATE TABLE devices (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, label TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL);
        CREATE TABLE runs (id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id), player TEXT NOT NULL DEFAULT '', started_at INTEGER NOT NULL);
        CREATE TABLE attempts (run_id TEXT NOT NULL REFERENCES runs(id), attempt INTEGER NOT NULL, level INTEGER NOT NULL, map TEXT NOT NULL, score INTEGER NOT NULL, completed INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (run_id, attempt));
        INSERT INTO devices VALUES ('device-phone-0001', 'abc123', 'iPhone · Safari', 'Hudson', 1, 1);
        INSERT INTO runs VALUES ('run-old0-0001', 'device-phone-0001', 'Hudson', 1);
        INSERT INTO attempts VALUES ('run-old0-0001', 1, 1, 'Haunted House', 300, 1, 1);
      `);
      old.close();

      db = openScores(file);
      expect((await db.boards()).runs).toEqual([{ runId: 'run-old0-0001', name: 'Hudson', score: 300, level: 1, shots: 0, hits: 0 }]);
      await db.sync({ device: phone, events: [attempt('run-old0-0001', 2, 2, 45, true, 'Graveyard', shotLog(1, 1))] });
      expect((await db.boards()).runs[0]).toMatchObject({ score: 345, shots: 2, hits: 1 });
      db.close();

      const raw = new DatabaseSync(file);
      expect(raw.prepare('SELECT attempt, shot, ms, yaw, pitch, target, zone, points FROM shots ORDER BY attempt, shot').all()).toEqual([
        { attempt: 2, shot: 1, ms: 0, yaw: 0.1, pitch: 0.05, target: 'witch', zone: 'far', points: 45 },
        { attempt: 2, shot: 2, ms: 500, yaw: -0.2, pitch: 0.3, target: null, zone: null, points: 0 },
      ]);
      raw.close();
    } finally {
      db.close();
      for (const f of [file, `${file}-wal`, `${file}-shm`]) rmSync(f, { force: true });
    }
  });
});

/**
 * The boards recomputed from the full history, the way the queries before the summary tables
 * did. Two deliberate differences: career ties fall back to the player key, and a career's name
 * comes from the player's latest run that has a level (not one just started).
 */
function referenceBoards(raw: DatabaseSync) {
  const q = (sql: string) => raw.prepare(sql).all() as Array<Record<string, unknown>>;
  const totals = `(SELECT t.run_id, t.score, t.level, s.shots, s.hits
    FROM (SELECT run_id, SUM(score) AS score, MAX(level) AS level FROM kept_attempts GROUP BY run_id) t
    JOIN (SELECT run_id, SUM(shots) AS shots, SUM(hits) AS hits FROM attempts GROUP BY run_id) s ON s.run_id = t.run_id)`;
  const averages = q(`SELECT n.player_key AS playerKey, a.map, ROUND(AVG(a.score)) AS avg, COUNT(*) AS plays
    FROM attempts a JOIN run_names n ON n.run_id = a.run_id GROUP BY n.player_key, a.map ORDER BY a.map`);
  return {
    runs: q(`SELECT t.run_id AS runId, n.name, t.score, t.level, t.shots, t.hits FROM ${totals} t JOIN run_names n ON n.run_id = t.run_id
      WHERE t.score > 0 ORDER BY t.score DESC, n.started_at ASC, n.seq ASC LIMIT 10`),
    levels: q(`SELECT level, map, name, score, runId FROM (
        SELECT a.level, a.map, a.score, a.run_id AS runId, n.name,
               ROW_NUMBER() OVER (PARTITION BY a.level ORDER BY a.score DESC, a.created_at ASC, a.rowid ASC) AS rn
        FROM attempts a JOIN run_names n ON n.run_id = a.run_id WHERE a.completed = 1 AND a.score > 0)
      WHERE rn = 1 ORDER BY level LIMIT 100`),
    maps: q(`SELECT map, name, score, level, runId, shots, hits FROM (
        SELECT a.map, a.level, a.score, a.shots, a.hits, a.run_id AS runId, n.name,
               ROW_NUMBER() OVER (PARTITION BY a.map ORDER BY a.score DESC, a.created_at ASC, a.rowid ASC) AS rn
        FROM attempts a JOIN run_names n ON n.run_id = a.run_id WHERE a.completed = 1 AND a.score > 0)
      WHERE rn <= 10 ORDER BY map, rn LIMIT 100`),
    career: q(`SELECT n.player_key AS playerKey, SUM(t.score) AS points, COUNT(*) AS games, MAX(t.score) AS best, MAX(t.level) AS furthest,
             SUM(t.shots) AS shots, SUM(t.hits) AS hits,
             (SELECT n2.name FROM run_names n2 JOIN ${totals} t2 ON t2.run_id = n2.run_id WHERE n2.player_key = n.player_key
              ORDER BY n2.started_at DESC, n2.seq DESC LIMIT 1) AS name
      FROM ${totals} t JOIN run_names n ON n.run_id = t.run_id
      GROUP BY n.player_key ORDER BY points DESC, games ASC, n.player_key LIMIT 10`).map(({ playerKey, ...c }) => ({
      ...c,
      maps: averages.filter((m) => m.playerKey === playerKey).map(({ map, avg, plays }) => ({ map, avg, plays })),
    })),
  };
}

/** A seeded random play history: runs, levels, replays, game overs, renames, resends and late levels. */
function randomHistory(seed: number) {
  let s = seed;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0; // mulberry32
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!;
  const names = ['Hudson', 'hudson', 'HUDSON', 'Dad', 'Mom', ''];
  const devices = ['device-rand-0001', 'device-rand-0002', 'device-rand-0003'];
  const runs: Array<{ id: string; device: string; attempt: number; level: number }> = [];
  const late: Array<{ device: string; event: object }> = [];
  const syncs: Array<{ device: { id: string; label: string }; events: object[] }> = [];
  for (let step = 0; step < 40; step++) {
    const device = pick(devices);
    const events: object[] = [];
    if (rnd() < 0.4) {
      const id = `run-rand-${String(runs.length).padStart(4, '0')}`;
      runs.push({ id, device, attempt: 0, level: 1 });
      events.push(run(id, pick(names)));
    }
    for (const r of runs.filter((x) => x.device === device)) {
      for (let k = Math.floor(rnd() * 3); k > 0; k--) {
        r.attempt++;
        if (r.attempt > 1 && rnd() < 0.7) r.level++; // otherwise a replay of the same level
        const ev = attempt(r.id, r.attempt, r.level, pick([0, 45, 90, 135, 300]), rnd() < 0.8, pick(['Haunted House', 'Graveyard', 'Swamp']), shotLog(Math.floor(rnd() * 3), Math.floor(rnd() * 3)));
        if (rnd() < 0.1) late.push({ device, event: ev });
        else events.push(ev);
      }
      if (rnd() < 0.15) events.push({ type: 'name', runId: r.id, name: pick(names) });
    }
    events.push(...late.filter((l) => l.device === device).map((l) => l.event));
    late.splice(0, late.length, ...late.filter((l) => l.device !== device));
    const body = { device: { id: device, label: `Label ${Math.floor(rnd() * 2)}` }, events };
    syncs.push(body);
    if (rnd() < 0.2) syncs.push(body); // an outbox resent after a lost answer
  }
  return syncs;
}

describe('leaderboard summaries', () => {
  it('match the boards recomputed from the full history, and a rebuild from scratch', async () => {
    const file = path.join(os.tmpdir(), `hr-summaries-${process.pid}-${Date.now()}.sqlite`);
    const summaries = (raw: DatabaseSync) =>
      ['run_stats', 'careers', 'player_maps', 'level_bests', 'map_bests'].map((t) => raw.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all());
    try {
      for (let seed = 1; seed <= 25; seed++) {
        const db = openScores(file);
        for (const body of randomHistory(seed)) await db.sync(body);
        const boards = await db.boards();
        db.close();

        const raw = new DatabaseSync(file);
        expect(boards, `seed ${seed}`).toEqual(referenceBoards(raw));
        const kept = summaries(raw);
        raw.exec("DELETE FROM meta WHERE key = 'schema'"); // forces a rebuild on the next open
        raw.close();

        const rebuilt = openScores(file);
        expect(await rebuilt.boards(), `seed ${seed}`).toEqual(boards);
        rebuilt.close();
        const again = new DatabaseSync(file);
        expect(summaries(again), `seed ${seed}`).toEqual(kept);
        again.exec('DELETE FROM attempts; DELETE FROM runs; DELETE FROM devices; DELETE FROM meta');
        again.close();
      }
    } finally {
      for (const f of [file, `${file}-wal`, `${file}-shm`]) rmSync(f, { force: true });
    }
  });
});

describe('scores HTTP API', () => {
  let server: http.Server | null = null;
  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

  async function start(allowReset = false, file = ':memory:'): Promise<string> {
    const api = createScoresApi({ file, allowReset });
    server = http.createServer((req, res) =>
      void api.handle(req, res, () => {
        res.statusCode = 418;
        res.end();
      }),
    );
    server.on('close', () => api.close());
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  const post = (url: string, body: unknown, type = 'application/json') =>
    fetch(url, { method: 'POST', headers: { 'Content-Type': type }, body: typeof body === 'string' ? body : JSON.stringify(body) });

  it('syncs and returns the leaderboards; leaves other paths to the next handler', async () => {
    const base = await start();
    const res = await post(`${base}/api/sync`, { device: phone, events: [run('run-http-0001', 'Hudson'), attempt('run-http-0001', 1, 1, 75)] });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.accepted).toBe(2);
    expect(body.boards.runs[0]).toMatchObject({ name: 'Hudson', score: 75 });
    expect((await (await fetch(`${base}/api/scores`)).json()).runs).toHaveLength(1);
    expect((await fetch(`${base}/index.html`)).status).toBe(418);
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
  });

  it('refuses non-JSON, broken JSON, oversized bodies and resets unless enabled', async () => {
    const base = await start();
    expect((await post(`${base}/api/sync`, 'device=x', 'text/plain')).status).toBe(415);
    expect((await post(`${base}/api/sync`, '{oops')).status).toBe(400);
    expect((await post(`${base}/api/sync`, { device: { id: 'no' }, events: [] })).status).toBe(400);
    const big = await post(`${base}/api/sync`, { device: phone, events: [], pad: 'x'.repeat(1_100_000) }).catch(() => null);
    expect(big === null || big.status === 413).toBe(true);
    expect((await fetch(`${base}/api/test-reset`, { method: 'POST' })).status).toBe(404);
  });

  it('offers a reset only to in-memory test servers', async () => {
    const base = await start(true);
    await post(`${base}/api/sync`, { device: phone, events: [run('run-rset-0001'), attempt('run-rset-0001', 1, 1, 10)] });
    expect((await fetch(`${base}/api/test-reset`, { method: 'POST' })).status).toBe(204);
    expect((await (await fetch(`${base}/api/scores`)).json()).runs).toEqual([]);
  });

  it('answers web Requests, as the Cloudflare Worker uses it', async () => {
    const scores = openScores(':memory:');
    const req = (url: string, init?: RequestInit) => new Request(`https://halloween-rush.example${url}`, init);
    try {
      expect(await handleScores(req('/index.html'), scores)).toBeNull();
      const body = JSON.stringify({ device: phone, events: [run('run-web0-0001', 'Hudson'), attempt('run-web0-0001', 1, 1, 45, true, 'Graveyard', shotLog(1, 2))] });
      const res = (await handleScores(req('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }), scores))!;
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect((await res.json()).boards.maps).toEqual([{ map: 'Graveyard', name: 'Hudson', score: 45, level: 1, runId: 'run-web0-0001', shots: 3, hits: 1 }]);
      expect((await handleScores(req('/api/sync', { method: 'POST', body: '{}' }), scores))!.status).toBe(415);
      expect((await handleScores(req('/api/test-reset', { method: 'POST' }), scores))!.status).toBe(404);
    } finally {
      scores.close();
    }
  });

  it('never resets a real database file, even when asked to', async () => {
    const file = path.join(os.tmpdir(), `hr-never-created-${process.pid}.sqlite`);
    const base = await start(true, file);
    expect((await fetch(`${base}/api/test-reset`, { method: 'POST' })).status).toBe(404);
    expect(existsSync(file)).toBe(false); // the reset path never even opened it
  });
});
