// Household scores for Halloween Rush: a tiny JSON API over a local SQLite file (node:sqlite,
// no extra dependencies). serve-lan.mjs and the Vite dev/preview servers mount it. It only
// records finished levels and names; gameplay still runs entirely in each browser.
//
//   GET  /api/scores  → { runs, levels, career }   (the leaderboards)
//   POST /api/sync    ← { device: { id, fingerprint, label }, events: [...] }
//                     → { accepted, rejected, boards }
//
// Events are idempotent (client-generated ids), so a device can safely resend its outbox.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const NAME_MAX_CHARS = 16;
const BOARD_SIZE = 10;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_EVENTS = 200;
const ID = /^[A-Za-z0-9-]{8,64}$/;
const FINGERPRINT = /^[a-z0-9]{1,32}$/;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS devices (
  id          TEXT PRIMARY KEY,           -- random id kept in the browser's storage
  fingerprint TEXT NOT NULL,              -- hash of browser/screen/GPU traits (identical phones can share one)
  label       TEXT NOT NULL,              -- e.g. "iPhone · Safari"
  name        TEXT NOT NULL DEFAULT '',   -- last name typed on this device
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id          TEXT PRIMARY KEY,
  device_id   TEXT NOT NULL REFERENCES devices(id),
  player      TEXT NOT NULL DEFAULT '',   -- '' = not named yet: shown as a guest of the device
  started_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS attempts (
  run_id      TEXT NOT NULL REFERENCES runs(id),
  attempt     INTEGER NOT NULL,           -- increases through a run; Replay Level makes a new one
  level       INTEGER NOT NULL,           -- 1-based level number
  map         TEXT NOT NULL,
  score       INTEGER NOT NULL,           -- points scored in this level attempt
  completed   INTEGER NOT NULL,           -- 0 = the run ended (game over) during this attempt
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (run_id, attempt)
);

DROP VIEW IF EXISTS run_totals;
DROP VIEW IF EXISTS kept_attempts;
DROP VIEW IF EXISTS run_names;
-- Who a run belongs to. Unnamed runs are grouped per device.
CREATE VIEW run_names AS
  SELECT r.id AS run_id, r.started_at, r.rowid AS seq,
         CASE WHEN r.player <> '' THEN r.player ELSE 'Guest (' || d.label || ')' END AS name,
         CASE WHEN r.player <> '' THEN 'p:' || lower(r.player) ELSE 'd:' || r.device_id END AS player_key
  FROM runs r JOIN devices d ON d.id = r.device_id;
-- The attempt that counts for each level of a run: Replay Level replaces the earlier ones,
-- exactly like the in-game score.
CREATE VIEW kept_attempts AS
  SELECT a.* FROM attempts a
  WHERE a.attempt = (SELECT MAX(b.attempt) FROM attempts b WHERE b.run_id = a.run_id AND b.level = a.level);
CREATE VIEW run_totals AS
  SELECT run_id, SUM(score) AS score, MAX(level) AS level FROM kept_attempts GROUP BY run_id;
`;

/** Same rules as the game: collapse whitespace, drop control characters, cap the length. */
export function cleanName(raw, max = NAME_MAX_CHARS) {
  const s = String(raw).replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, max).join('').trim();
}

const obj = (v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : {});
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const id = (v) => (typeof v === 'string' && ID.test(v) ? v : null);

/** Open (creating if needed) the scores database. `file` may be ':memory:'. */
export function openScores(file) {
  const memory = file === ':memory:';
  if (!memory) mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  if (!memory) db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);

  const upsertDevice = db.prepare(
    `INSERT INTO devices (id, fingerprint, label, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET fingerprint = excluded.fingerprint, label = excluded.label, last_seen = excluded.last_seen`,
  );
  const insertRun = db.prepare('INSERT INTO runs (id, device_id, player, started_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING');
  const runOwner = db.prepare('SELECT device_id FROM runs WHERE id = ?');
  const insertAttempt = db.prepare(
    `INSERT INTO attempts (run_id, attempt, level, map, score, completed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id, attempt) DO NOTHING`,
  );
  const nameRun = db.prepare('UPDATE runs SET player = ? WHERE id = ?');
  const nameDevice = db.prepare('UPDATE devices SET name = ? WHERE id = ?');

  const topRuns = db.prepare(
    `SELECT t.run_id AS runId, n.name, t.score, t.level
     FROM run_totals t JOIN run_names n ON n.run_id = t.run_id
     WHERE t.score > 0 ORDER BY t.score DESC, n.started_at ASC, n.seq ASC LIMIT ${BOARD_SIZE}`,
  );
  const levelBests = db.prepare(
    `SELECT level, map, name, score, runId FROM (
       SELECT a.level, a.map, a.score, a.run_id AS runId, n.name,
              ROW_NUMBER() OVER (PARTITION BY a.level ORDER BY a.score DESC, a.created_at ASC) AS rn
       FROM attempts a JOIN run_names n ON n.run_id = a.run_id
       WHERE a.completed = 1 AND a.score > 0)
     WHERE rn = 1 ORDER BY level LIMIT 100`,
  );
  const career = db.prepare(
    `SELECT n.player_key AS playerKey, SUM(t.score) AS points, COUNT(*) AS games, MAX(t.score) AS best, MAX(t.level) AS furthest,
            (SELECT n2.name FROM run_names n2 WHERE n2.player_key = n.player_key ORDER BY n2.started_at DESC, n2.seq DESC LIMIT 1) AS name
     FROM run_totals t JOIN run_names n ON n.run_id = t.run_id
     GROUP BY n.player_key ORDER BY points DESC, games ASC LIMIT ${BOARD_SIZE}`,
  );
  // Every level played counts toward a map average, replayed ones included.
  const mapAverages = db.prepare(
    `SELECT n.player_key AS playerKey, a.map, ROUND(AVG(a.score)) AS avg, COUNT(*) AS plays
     FROM attempts a JOIN run_names n ON n.run_id = a.run_id
     GROUP BY n.player_key, a.map ORDER BY a.map`,
  );

  function applyEvent(deviceId, ev, now) {
    const e = obj(ev);
    if (e.type === 'run') {
      const runId = id(e.id);
      if (!runId) return false;
      insertRun.run(runId, deviceId, typeof e.player === 'string' ? cleanName(e.player) : '', now);
      return runOwner.get(runId)?.device_id === deviceId;
    }
    const runId = id(e.runId);
    // A device may only add to, or name, its own runs.
    if (!runId || runOwner.get(runId)?.device_id !== deviceId) return false;
    if (e.type === 'attempt') {
      const attempt = int(e.attempt, 1, 1e6);
      const level = int(e.level, 1, 1e4);
      const score = int(e.score, 0, 1e6);
      const map = typeof e.map === 'string' ? cleanName(e.map, 32) : '';
      if (attempt === null || level === null || score === null || !map || typeof e.completed !== 'boolean') return false;
      insertAttempt.run(runId, attempt, level, map, score, e.completed ? 1 : 0, now);
      return true;
    }
    if (e.type === 'name') {
      if (typeof e.name !== 'string') return false;
      const name = cleanName(e.name);
      nameRun.run(name, runId);
      if (name) nameDevice.run(name, deviceId);
      return true;
    }
    return false;
  }

  return {
    /** Apply one device's batch of events atomically. */
    sync(body) {
      const b = obj(body);
      const device = obj(b.device);
      const deviceId = id(device.id);
      if (!deviceId) return { error: 'A device id is required.' };
      if (!Array.isArray(b.events) || b.events.length > MAX_EVENTS) return { error: `Send up to ${MAX_EVENTS} events at a time.` };
      const fingerprint = typeof device.fingerprint === 'string' && FINGERPRINT.test(device.fingerprint) ? device.fingerprint : '';
      const label = (typeof device.label === 'string' ? cleanName(device.label, 40) : '') || 'Unknown device';
      const now = Date.now();
      let accepted = 0;
      db.exec('BEGIN');
      try {
        upsertDevice.run(deviceId, fingerprint, label, now, now);
        for (const ev of b.events) if (applyEvent(deviceId, ev, now)) accepted++;
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return { accepted, rejected: b.events.length - accepted };
    },

    boards() {
      const maps = new Map();
      for (const m of mapAverages.all()) {
        if (!maps.has(m.playerKey)) maps.set(m.playerKey, []);
        maps.get(m.playerKey).push({ map: m.map, avg: m.avg, plays: m.plays });
      }
      return {
        runs: topRuns.all().map((r) => ({ ...r })),
        levels: levelBests.all().map((r) => ({ ...r })),
        career: career.all().map(({ playerKey, ...r }) => ({ ...r, maps: maps.get(playerKey) ?? [] })),
      };
    },

    /** Wipe everything (only offered for in-memory test databases). */
    reset() {
      db.exec('DELETE FROM attempts; DELETE FROM runs; DELETE FROM devices;');
    },

    close() {
      db.close();
    },
  };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readJson(req) {
  const type = String(req.headers['content-type'] ?? '');
  // Requiring JSON also makes browsers preflight cross-site posts, which this API never allows.
  if (!type.startsWith('application/json')) return Promise.reject(new HttpError(415, 'Send JSON.'));
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'Too much data.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Invalid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (body === undefined) return res.end();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/**
 * Connect-style middleware (`handle(req, res, next)`) for /api/*. The database opens on the
 * first request. `allowReset` adds POST /api/test-reset, only for ':memory:' test servers.
 */
export function createScoresApi({ file, allowReset = false }) {
  let scores = null;
  const open = () => (scores ??= openScores(file));
  const canReset = allowReset && file === ':memory:';
  return {
    file,
    async handle(req, res, next) {
      const pathname = (req.url ?? '/').split('?')[0];
      if (!pathname.startsWith('/api/')) return next();
      try {
        if (pathname === '/api/scores' && req.method === 'GET') return send(res, 200, open().boards());
        if (pathname === '/api/sync' && req.method === 'POST') {
          const result = open().sync(await readJson(req));
          if (result.error) return send(res, 400, { error: result.error });
          return send(res, 200, { ...result, boards: open().boards() });
        }
        if (pathname === '/api/test-reset' && req.method === 'POST' && canReset) {
          open().reset();
          return send(res, 204);
        }
        send(res, 404, { error: 'Not found.' });
      } catch (err) {
        if (err instanceof HttpError) return send(res, err.status, { error: err.message });
        console.error('[scores]', err);
        send(res, 500, { error: 'The scores database had a problem.' });
      }
    },
    close() {
      scores?.close();
      scores = null;
    },
  };
}
