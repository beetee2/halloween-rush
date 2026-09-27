import { existsSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';
import { createScoresApi, openScores, type ScoresDb } from '../scripts/scores-api.mjs';
import { deviceLabel } from '../src/net/device';
import { ENVIRONMENTS } from '../src/render/environments';

const phone = { id: 'device-phone-0001', fingerprint: 'abc123', label: 'iPhone · Safari' };
const laptop = { id: 'device-laptop-0002', fingerprint: 'def456', label: 'Linux · Chrome' };

const run = (id: string, player = '') => ({ type: 'run', id, player });
const attempt = (runId: string, n: number, level: number, score: number, completed = true, map = 'Haunted House') => ({
  type: 'attempt',
  runId,
  attempt: n,
  level,
  map,
  score,
  completed,
});

describe('scores database', () => {
  let db: ScoresDb;
  afterEach(() => db.close());

  it('totals a run the way the game does: Replay Level replaces the earlier attempt', () => {
    db = openScores(':memory:');
    const r = db.sync({
      device: phone,
      events: [run('run-aaaa-0001', 'Hudson'), attempt('run-aaaa-0001', 1, 1, 300), attempt('run-aaaa-0001', 2, 2, 500), attempt('run-aaaa-0001', 3, 2, 200), attempt('run-aaaa-0001', 4, 3, 40, false)],
    });
    expect(r).toEqual({ accepted: 5, rejected: 0 });
    const b = db.boards();
    expect(b.runs).toEqual([{ runId: 'run-aaaa-0001', name: 'Hudson', score: 540, level: 3 }]);
    // Level bests count completed attempts, even one later replayed; a failed level never counts.
    expect(b.levels).toEqual([
      { level: 1, map: 'Haunted House', name: 'Hudson', score: 300, runId: 'run-aaaa-0001' },
      { level: 2, map: 'Haunted House', name: 'Hudson', score: 500, runId: 'run-aaaa-0001' },
    ]);
    expect(b.career).toHaveLength(1);
    expect(b.career[0]).toMatchObject({ name: 'Hudson', points: 540, games: 1, best: 540, furthest: 3 });
  });

  it('is idempotent, so a device can resend its outbox', () => {
    db = openScores(':memory:');
    const events = [run('run-bbbb-0001'), attempt('run-bbbb-0001', 1, 1, 100)];
    db.sync({ device: phone, events });
    db.sync({ device: phone, events });
    expect(db.boards().runs).toEqual([{ runId: 'run-bbbb-0001', name: 'Guest (iPhone · Safari)', score: 100, level: 1 }]);
  });

  it('names a run afterwards and groups careers by name across devices', () => {
    db = openScores(':memory:');
    db.sync({ device: phone, events: [run('run-cccc-0001'), attempt('run-cccc-0001', 1, 1, 100), attempt('run-cccc-0001', 2, 2, 50, false, 'Graveyard')] });
    db.sync({ device: phone, events: [{ type: 'name', runId: 'run-cccc-0001', name: '  Hudson ' }] });
    db.sync({ device: laptop, events: [run('run-dddd-0001', 'hudson'), attempt('run-dddd-0001', 1, 1, 300)] });
    db.sync({ device: laptop, events: [run('run-eeee-0001', 'Dad'), attempt('run-eeee-0001', 1, 1, 200)] });
    const { career, runs } = db.boards();
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

  it("rejects bad events and other devices' runs without failing the batch", () => {
    db = openScores(':memory:');
    db.sync({ device: phone, events: [run('run-ffff-0001', 'Hudson')] });
    const r = db.sync({
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
    expect(db.boards().runs.map((x) => [x.name, x.score])).toEqual([['Guest (Linux · Chrome)', 20]]);
    expect(db.sync({ device: { id: 'bad id!' }, events: [] })).toHaveProperty('error');
    expect(db.sync({ device: phone, events: 'nope' })).toHaveProperty('error');
  });

  it('keeps the top ten runs, highest first, older first on ties', () => {
    db = openScores(':memory:');
    const events: object[] = [];
    const names = ['Ava', 'Ben', 'Cora', 'Dan', 'Eli', 'Finn', 'Gia', 'Hugo', 'Ivy', 'Jack', 'Kai', 'Leo'];
    names.forEach((name, i) => events.push(run(`run-top-${String(i).padStart(4, '0')}`, name), attempt(`run-top-${String(i).padStart(4, '0')}`, 1, 1, i === 11 ? 50 : (i + 1) * 10)));
    db.sync({ device: phone, events });
    const scores = db.boards().runs.map((r) => `${r.name}:${r.score}`);
    expect(scores).toHaveLength(10);
    expect(scores.slice(0, 4)).toEqual(['Kai:110', 'Jack:100', 'Ivy:90', 'Hugo:80']);
    expect(scores.indexOf('Eli:50')).toBeLessThan(scores.indexOf('Leo:50'));
  });

  it('only puts approved names on the boards, whatever a client sends', () => {
    db = openScores(':memory:');
    const r = db.sync({
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
    expect(db.boards().runs.map((x) => x.name)).toEqual(['Hudson', 'Guest (iPhone · Safari)']);
  });

  it('only shows device labels and maps the game makes', () => {
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
    labels.forEach((label, i) => {
      const id = `run-labl-000${i}`;
      db.sync({ device: { id: `device-label-000${i}`, fingerprint: 'abc', label }, events: [run(id), attempt(id, 1, 1, 100 - i)] });
    });
    db.sync({ device: { id: 'device-rude-0001', fingerprint: 'abc', label: 'Poop · Butt' }, events: [run('run-rude-0001'), attempt('run-rude-0001', 1, 1, 1)] });
    expect(db.boards().runs.map((x) => x.name)).toEqual([...labels, 'Unknown device'].map((l) => `Guest (${l})`));

    const maps = ENVIRONMENTS.map((e) => e.name);
    const r = db.sync({ device: phone, events: [run('run-maps-0001'), ...maps.map((m, i) => attempt('run-maps-0001', i + 1, i + 1, 10, true, m)), attempt('run-maps-0001', 9, 9, 10, true, 'Poop Palace')] });
    expect(r).toEqual({ accepted: maps.length + 1, rejected: 1 });
    expect(db.boards().levels.map((l) => l.map)).toEqual(maps);
  });

  it('hides names saved before names were checked unless they are approved', () => {
    const file = path.join(os.tmpdir(), `hr-old-names-${process.pid}.sqlite`);
    onTestFinished(() => {
      for (const ext of ['', '-wal', '-shm']) rmSync(file + ext, { force: true });
    });
    db = openScores(file);
    db.sync({ device: phone, events: [run('run-oldn-0001', 'Hudson'), attempt('run-oldn-0001', 1, 1, 100), run('run-oldn-0002', 'Dad'), attempt('run-oldn-0002', 1, 1, 50)] });
    const raw = new DatabaseSync(file);
    raw.prepare('UPDATE runs SET player = ? WHERE id = ?').run('Stinky Butt', 'run-oldn-0002');
    raw.close();
    const { runs, career } = db.boards();
    expect(runs.map((x) => x.name)).toEqual(['Hudson', 'Guest (iPhone · Safari)']);
    expect(career.map((c) => c.name)).toEqual(['Hudson', 'Guest (iPhone · Safari)']);
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
    const big = await post(`${base}/api/sync`, { device: phone, events: [], pad: 'x'.repeat(300_000) }).catch(() => null);
    expect(big === null || big.status === 413).toBe(true);
    expect((await fetch(`${base}/api/test-reset`, { method: 'POST' })).status).toBe(404);
  });

  it('offers a reset only to in-memory test servers', async () => {
    const base = await start(true);
    await post(`${base}/api/sync`, { device: phone, events: [run('run-rset-0001'), attempt('run-rset-0001', 1, 1, 10)] });
    expect((await fetch(`${base}/api/test-reset`, { method: 'POST' })).status).toBe(204);
    expect((await (await fetch(`${base}/api/scores`)).json()).runs).toEqual([]);
  });

  it('never resets a real database file, even when asked to', async () => {
    const file = path.join(os.tmpdir(), `hr-never-created-${process.pid}.sqlite`);
    const base = await start(true, file);
    expect((await fetch(`${base}/api/test-reset`, { method: 'POST' })).status).toBe(404);
    expect(existsSync(file)).toBe(false); // the reset path never even opened it
  });
});
