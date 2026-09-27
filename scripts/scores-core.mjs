// Halloween Rush scores: the rules, SQL and JSON API shared by every host. It talks to a
// D1-style database (prepare/bind/all/batch), so the same code runs on Cloudflare D1 for the
// deployed game (worker/index.mjs) and on a local SQLite file for the LAN and dev servers
// (scores-api.mjs). It only records finished levels, shots and names; gameplay still runs
// entirely in each browser.
//
//   GET  /api/scores  → { runs, levels, maps, career }   (the leaderboards)
//   POST /api/sync    ← { device: { id, fingerprint, label }, events: [...] }
//                     → { accepted, rejected, boards }
//
// Events are idempotent (client-generated ids), so a device can safely resend its outbox.
import { approvedName } from '../src/core/names.mjs';

const NAME_MAX_CHARS = 16;
const BOARD_SIZE = 10;
export const MAX_BODY_BYTES = 1024 * 1024;
const MAX_EVENTS = 200;
const MAX_SHOTS = 1000;
const ID = /^[A-Za-z0-9-]{8,64}$/;
const FINGERPRINT = /^[a-z0-9]{1,32}$/;
/** Target kinds and range zones are short words (e.g. "witch", "far"). */
const WORD = /^[A-Za-z]{1,24}$/;
// Only text the game itself makes reaches the boards, whatever a client sends: approved names
// (src/core/names.mjs), device labels as deviceLabel() in src/net/device.ts builds them, and the
// maps in src/render/environments.
const LABEL = /^(iPhone|iPad|Android|Chromebook|Windows|Mac|Linux|Device) · (Edge|Samsung Internet|Opera|Firefox|Chrome|Safari|Browser|Home Screen)$/;
const UNKNOWN_DEVICE = 'Unknown device';
const MAPS = new Set(['Haunted House', 'Graveyard', 'Spooky Forest', 'Pumpkin Patch', 'Haunted Carnival']);

const TABLES = [
  `CREATE TABLE IF NOT EXISTS devices (
    id          TEXT PRIMARY KEY,           -- random id kept in the browser's storage
    fingerprint TEXT NOT NULL,              -- hash of browser/screen/GPU traits (identical phones can share one)
    label       TEXT NOT NULL,              -- e.g. "iPhone · Safari"
    name        TEXT NOT NULL DEFAULT '',   -- last name typed on this device
    first_seen  INTEGER NOT NULL,
    last_seen   INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS runs (
    id          TEXT PRIMARY KEY,
    device_id   TEXT NOT NULL REFERENCES devices(id),
    player      TEXT NOT NULL DEFAULT '',   -- '' = not named yet: shown as a guest of the device
    started_at  INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS attempts (
    run_id      TEXT NOT NULL REFERENCES runs(id),
    attempt     INTEGER NOT NULL,           -- increases through a run; Replay Level makes a new one
    level       INTEGER NOT NULL,           -- 1-based level number
    map         TEXT NOT NULL,
    score       INTEGER NOT NULL,           -- points scored in this level attempt
    completed   INTEGER NOT NULL,           -- 0 = the run ended (game over) during this attempt
    created_at  INTEGER NOT NULL,
    shots       INTEGER NOT NULL DEFAULT 0, -- pumpkins fired during the attempt
    hits        INTEGER NOT NULL DEFAULT 0, -- ...that hit a target
    shot_log    TEXT NOT NULL DEFAULT '[]', -- every shot as JSON, read it through the shots view
    PRIMARY KEY (run_id, attempt)
  )`,
  'CREATE INDEX IF NOT EXISTS attempts_by_level ON attempts (run_id, level, attempt)',
  'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
];

/** Columns added after the first release: older database files gain them when opened. */
const ADDED_COLUMNS = [
  ['shots', 'INTEGER NOT NULL DEFAULT 0'],
  ['hits', 'INTEGER NOT NULL DEFAULT 0'],
  ['shot_log', "TEXT NOT NULL DEFAULT '[]'"],
];

/** Who a run counts for: a typed name (any case), else the device it was played on. `r` is a runs row. */
const playerKey = (r) => `iif(${r}.player <> '', 'p:' || lower(${r}.player), 'd:' || ${r}.device_id)`;

const SUMMARY_TABLES = ['run_stats', 'careers', 'player_maps', 'level_bests', 'map_bests'];
const TRIGGERS = ['attempt_added', 'run_added', 'run_scored', 'run_moved', 'run_named'];

/**
 * Views, plus summary tables that triggers keep up to date as levels and names arrive, so a
 * leaderboard refresh reads a few hundred indexed rows instead of the whole history (D1 bills
 * every row a query reads). All of it is rebuilt from the history whenever this SQL changes.
 * Remote D1 splits statements itself: trigger bodies need uppercase BEGIN/END, no comments and no
 * other END (use iif, not CASE).
 */
const DERIVED = [
  ...TRIGGERS.map((t) => `DROP TRIGGER IF EXISTS ${t}`),
  ...['shots', 'run_totals', 'kept_attempts', 'run_names'].map((v) => `DROP VIEW IF EXISTS ${v}`),
  ...SUMMARY_TABLES.map((t) => `DROP TABLE IF EXISTS ${t}`),
  // Who a run belongs to. Unnamed runs are grouped per device.
  `CREATE VIEW run_names AS
    SELECT r.id AS run_id, r.started_at, r.rowid AS seq,
           CASE WHEN r.player <> '' THEN r.player ELSE 'Guest (' || d.label || ')' END AS name,
           ${playerKey('r')} AS player_key
    FROM runs r JOIN devices d ON d.id = r.device_id`,
  // The attempt that counts for each level of a run: Replay Level replaces the earlier ones,
  // exactly like the in-game score.
  `CREATE VIEW kept_attempts AS
    SELECT a.* FROM attempts a
    WHERE a.attempt = (SELECT MAX(b.attempt) FROM attempts b WHERE b.run_id = a.run_id AND b.level = a.level)`,
  // One row per shot. target/zone are NULL for a miss; aim is radians (yaw left+, pitch up+).
  `CREATE VIEW shots AS
    SELECT a.run_id, a.attempt, a.level, a.map, s.key + 1 AS shot,
           json_extract(s.value, '$[0]') AS ms, json_extract(s.value, '$[1]') AS yaw, json_extract(s.value, '$[2]') AS pitch,
           json_extract(s.value, '$[3]') AS target, json_extract(s.value, '$[4]') AS zone, json_extract(s.value, '$[5]') AS points
    FROM attempts a, json_each(a.shot_log) s`,

  // Each run with at least one level. score sums the kept attempts; accuracy counts every shot,
  // replays included. seq (runs.rowid) is the last tie-break.
  `CREATE TABLE run_stats (run_id TEXT PRIMARY KEY, player_key TEXT NOT NULL, started_at INTEGER NOT NULL, seq INTEGER NOT NULL,
    score INTEGER NOT NULL, level INTEGER NOT NULL, shots INTEGER NOT NULL, hits INTEGER NOT NULL)`,
  'CREATE INDEX run_stats_by_score ON run_stats (score DESC, started_at, seq)',
  'CREATE INDEX run_stats_best ON run_stats (player_key, score)',
  'CREATE INDEX run_stats_furthest ON run_stats (player_key, level)',
  'CREATE INDEX run_stats_latest ON run_stats (player_key, started_at, seq)',
  // Each player's run totals added up.
  'CREATE TABLE careers (player_key TEXT PRIMARY KEY, points INTEGER NOT NULL, games INTEGER NOT NULL, shots INTEGER NOT NULL, hits INTEGER NOT NULL)',
  'CREATE INDEX careers_by_points ON careers (points DESC, games, player_key)',
  // Every level a player played on each map, replays and game overs included.
  'CREATE TABLE player_maps (player_key TEXT NOT NULL, map TEXT NOT NULL, total INTEGER NOT NULL, plays INTEGER NOT NULL, PRIMARY KEY (player_key, map))',
  // The best finished level of each level number, and the ten best on each map (replays
  // included). seq is the attempt's rowid; earlier wins ties.
  'CREATE TABLE level_bests (level INTEGER PRIMARY KEY, map TEXT NOT NULL, score INTEGER NOT NULL, run_id TEXT NOT NULL, created_at INTEGER NOT NULL, seq INTEGER NOT NULL)',
  `CREATE TABLE map_bests (seq INTEGER PRIMARY KEY, map TEXT NOT NULL, level INTEGER NOT NULL, score INTEGER NOT NULL, run_id TEXT NOT NULL,
    shots INTEGER NOT NULL, hits INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
  'CREATE INDEX map_bests_by_score ON map_bests (map, score DESC, created_at, seq)',

  // Fill them from the history, before the triggers exist.
  `INSERT INTO run_stats (run_id, player_key, started_at, seq, score, level, shots, hits)
    SELECT r.id, ${playerKey('r')}, r.started_at, r.rowid, k.score, k.level, s.shots, s.hits
    FROM runs r
    JOIN (SELECT run_id, SUM(score) AS score, MAX(level) AS level FROM kept_attempts GROUP BY run_id) k ON k.run_id = r.id
    JOIN (SELECT run_id, SUM(shots) AS shots, SUM(hits) AS hits FROM attempts GROUP BY run_id) s ON s.run_id = r.id`,
  `INSERT INTO careers (player_key, points, games, shots, hits)
    SELECT player_key, SUM(score), COUNT(*), SUM(shots), SUM(hits) FROM run_stats GROUP BY player_key`,
  `INSERT INTO player_maps (player_key, map, total, plays)
    SELECT s.player_key, a.map, SUM(a.score), COUNT(*) FROM attempts a JOIN run_stats s ON s.run_id = a.run_id GROUP BY s.player_key, a.map`,
  `INSERT INTO level_bests (level, map, score, run_id, created_at, seq)
    SELECT level, map, score, run_id, created_at, seq FROM (
      SELECT a.level, a.map, a.score, a.run_id, a.created_at, a.rowid AS seq,
             ROW_NUMBER() OVER (PARTITION BY a.level ORDER BY a.score DESC, a.created_at, a.rowid) AS rn
      FROM attempts a WHERE a.completed = 1 AND a.score > 0)
    WHERE rn = 1`,
  `INSERT INTO map_bests (seq, map, level, score, run_id, shots, hits, created_at)
    SELECT seq, map, level, score, run_id, shots, hits, created_at FROM (
      SELECT a.rowid AS seq, a.map, a.level, a.score, a.run_id, a.shots, a.hits, a.created_at,
             ROW_NUMBER() OVER (PARTITION BY a.map ORDER BY a.score DESC, a.created_at, a.rowid) AS rn
      FROM attempts a WHERE a.completed = 1 AND a.score > 0)
    WHERE rn <= ${BOARD_SIZE}`,

  // A new level: update its run (a replay swaps out the score of the attempt it replaces),
  // the player's map average, and the level and map bests if it made them.
  `CREATE TRIGGER attempt_added AFTER INSERT ON attempts BEGIN
    INSERT INTO run_stats (run_id, player_key, started_at, seq, score, level, shots, hits)
      SELECT r.id, ${playerKey('r')}, r.started_at, r.rowid,
             iif(EXISTS (SELECT 1 FROM attempts b WHERE b.run_id = NEW.run_id AND b.level = NEW.level AND b.attempt > NEW.attempt), 0,
                 NEW.score - COALESCE((SELECT b.score FROM attempts b WHERE b.run_id = NEW.run_id AND b.level = NEW.level AND b.attempt < NEW.attempt
                                       ORDER BY b.attempt DESC LIMIT 1), 0)),
             NEW.level, NEW.shots, NEW.hits
      FROM runs r WHERE r.id = NEW.run_id
      ON CONFLICT (run_id) DO UPDATE SET score = score + excluded.score, level = MAX(level, excluded.level),
        shots = shots + excluded.shots, hits = hits + excluded.hits;
    INSERT INTO player_maps (player_key, map, total, plays)
      SELECT player_key, NEW.map, NEW.score, 1 FROM run_stats WHERE run_id = NEW.run_id
      ON CONFLICT (player_key, map) DO UPDATE SET total = total + excluded.total, plays = plays + 1;
    INSERT INTO level_bests (level, map, score, run_id, created_at, seq)
      SELECT NEW.level, NEW.map, NEW.score, NEW.run_id, NEW.created_at, NEW.rowid WHERE NEW.completed = 1 AND NEW.score > 0
      ON CONFLICT (level) DO UPDATE SET map = excluded.map, score = excluded.score, run_id = excluded.run_id,
        created_at = excluded.created_at, seq = excluded.seq
      WHERE excluded.score > score OR (excluded.score = score AND excluded.created_at < created_at);
    INSERT INTO map_bests (seq, map, level, score, run_id, shots, hits, created_at)
      SELECT NEW.rowid, NEW.map, NEW.level, NEW.score, NEW.run_id, NEW.shots, NEW.hits, NEW.created_at
      WHERE NEW.completed = 1 AND NEW.score > 0 AND (SELECT COUNT(*) FROM (SELECT 1 FROM map_bests m WHERE m.map = NEW.map
        AND (m.score > NEW.score OR (m.score = NEW.score AND m.created_at <= NEW.created_at)) LIMIT ${BOARD_SIZE})) < ${BOARD_SIZE};
    DELETE FROM map_bests WHERE map = NEW.map AND seq NOT IN (
      SELECT seq FROM map_bests WHERE map = NEW.map ORDER BY score DESC, created_at, seq LIMIT ${BOARD_SIZE});
  END`,
  `CREATE TRIGGER run_added AFTER INSERT ON run_stats BEGIN
    INSERT INTO careers (player_key, points, games, shots, hits) VALUES (NEW.player_key, NEW.score, 1, NEW.shots, NEW.hits)
      ON CONFLICT (player_key) DO UPDATE SET points = points + excluded.points, games = games + 1,
        shots = shots + excluded.shots, hits = hits + excluded.hits;
  END`,
  `CREATE TRIGGER run_scored AFTER UPDATE OF score, shots, hits ON run_stats BEGIN
    UPDATE careers SET points = points + NEW.score - OLD.score, shots = shots + NEW.shots - OLD.shots, hits = hits + NEW.hits - OLD.hits
      WHERE player_key = NEW.player_key;
  END`,
  // A run named for someone else moves its totals and map plays to them.
  `CREATE TRIGGER run_moved AFTER UPDATE OF player_key ON run_stats WHEN OLD.player_key <> NEW.player_key BEGIN
    UPDATE careers SET points = points - OLD.score, games = games - 1, shots = shots - OLD.shots, hits = hits - OLD.hits
      WHERE player_key = OLD.player_key;
    DELETE FROM careers WHERE player_key = OLD.player_key AND games = 0;
    INSERT INTO careers (player_key, points, games, shots, hits) VALUES (NEW.player_key, NEW.score, 1, NEW.shots, NEW.hits)
      ON CONFLICT (player_key) DO UPDATE SET points = points + excluded.points, games = games + 1,
        shots = shots + excluded.shots, hits = hits + excluded.hits;
    INSERT INTO player_maps (player_key, map, total, plays)
      SELECT OLD.player_key, map, -SUM(score), -COUNT(*) FROM attempts WHERE run_id = OLD.run_id GROUP BY map
      ON CONFLICT (player_key, map) DO UPDATE SET total = total + excluded.total, plays = plays + excluded.plays;
    DELETE FROM player_maps WHERE player_key = OLD.player_key AND plays = 0;
    INSERT INTO player_maps (player_key, map, total, plays)
      SELECT NEW.player_key, map, SUM(score), COUNT(*) FROM attempts WHERE run_id = NEW.run_id GROUP BY map
      ON CONFLICT (player_key, map) DO UPDATE SET total = total + excluded.total, plays = plays + excluded.plays;
  END`,
  `CREATE TRIGGER run_named AFTER UPDATE OF player ON runs WHEN ${playerKey('NEW')} <> ${playerKey('OLD')} BEGIN
    UPDATE run_stats SET player_key = ${playerKey('NEW')} WHERE run_id = NEW.id;
  END`,
];

/** Stored in meta once DERIVED is in place; any change to it (or to ADDED_COLUMNS) triggers a rebuild. */
const SCHEMA = JSON.stringify([ADDED_COLUMNS, DERIVED]);

/** Each board reads only the top of an index; career extras are one index seek per listed player. */
const BOARD_QUERIES = {
  runs: `SELECT s.run_id AS runId, n.name, s.score, s.level, s.shots, s.hits
    FROM run_stats s JOIN run_names n ON n.run_id = s.run_id
    WHERE s.score > 0 ORDER BY s.score DESC, s.started_at ASC, s.seq ASC LIMIT ${BOARD_SIZE}`,
  levels: `SELECT b.level, b.map, n.name, b.score, b.run_id AS runId
    FROM level_bests b JOIN run_names n ON n.run_id = b.run_id ORDER BY b.level LIMIT 100`,
  maps: `SELECT b.map, n.name, b.score, b.level, b.run_id AS runId, b.shots, b.hits
    FROM map_bests b JOIN run_names n ON n.run_id = b.run_id ORDER BY b.map, b.score DESC, b.created_at, b.seq LIMIT 100`,
  // The name shown is the one on the player's latest run.
  career: `SELECT c.player_key AS playerKey, c.points, c.games, c.shots, c.hits,
           (SELECT s.score FROM run_stats s WHERE s.player_key = c.player_key ORDER BY s.score DESC LIMIT 1) AS best,
           (SELECT s.level FROM run_stats s WHERE s.player_key = c.player_key ORDER BY s.level DESC LIMIT 1) AS furthest,
           (SELECT n.name FROM run_stats s JOIN run_names n ON n.run_id = s.run_id WHERE s.player_key = c.player_key
            ORDER BY s.started_at DESC, s.seq DESC LIMIT 1) AS name
    FROM careers c ORDER BY c.points DESC, c.games ASC, c.player_key LIMIT ${BOARD_SIZE}`,
  mapAverages: `SELECT player_key AS playerKey, map, ROUND(total * 1.0 / plays) AS avg, plays FROM player_maps
    WHERE player_key IN (SELECT player_key FROM careers ORDER BY points DESC, games ASC, player_key LIMIT ${BOARD_SIZE})
    ORDER BY map`,
};

/** Same rules as the game: collapse whitespace, drop control characters, cap the length. */
export function cleanName(raw, max = NAME_MAX_CHARS) {
  const s = String(raw).replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, max).join('').trim();
}

const obj = (v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : {});
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const id = (v) => (typeof v === 'string' && ID.test(v) ? v : null);
const angle = (v) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 10 ? Math.round(v * 1000) / 1000 : null);

/** One shot as the game sends it: [ms into the level, yaw, pitch, target kind | null, range zone | null, points]. */
function shot(v) {
  if (!Array.isArray(v) || v.length !== 6) return null;
  const [ms, rawYaw, rawPitch, target, zone, points] = v;
  const yaw = angle(rawYaw);
  const pitch = angle(rawPitch);
  if (int(ms, 0, 3_600_000) === null || yaw === null || pitch === null || int(points, 0, 10_000) === null) return null;
  if (target === null) return zone === null && points === 0 ? [ms, yaw, pitch, null, null, 0] : null;
  return typeof target === 'string' && WORD.test(target) && typeof zone === 'string' && WORD.test(zone) ? [ms, yaw, pitch, target, zone, points] : null;
}

/** A level's shots, or null if malformed. Games from before shot tracking send none. */
function shotLog(v) {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > MAX_SHOTS) return null;
  const log = v.map(shot);
  return log.includes(null) ? null : log;
}

/** A valid event in stored form, or null. */
function parseEvent(ev) {
  const e = obj(ev);
  if (e.type === 'run') {
    const runId = id(e.id);
    // A name that isn't approved leaves the run as a guest's rather than losing it.
    return runId && { type: 'run', runId, player: typeof e.player === 'string' ? approvedName(cleanName(e.player)) : '' };
  }
  const runId = id(e.runId);
  if (!runId) return null;
  if (e.type === 'attempt') {
    const attempt = int(e.attempt, 1, 1e6);
    const level = int(e.level, 1, 1e4);
    const score = int(e.score, 0, 1e6);
    const log = shotLog(e.shots);
    if (attempt === null || level === null || score === null || !MAPS.has(e.map) || typeof e.completed !== 'boolean' || !log) return null;
    return { type: 'attempt', runId, attempt, level, map: e.map, score, completed: e.completed, log };
  }
  if (e.type === 'name' && typeof e.name === 'string') {
    const typed = cleanName(e.name);
    const name = approvedName(typed);
    return typed && !name ? null : { type: 'name', runId, name };
  }
  return null;
}

/**
 * A stored name as the boards show it. Names saved before names were checked only appear if
 * they're approved now; the stored rows are left alone.
 */
function shownName(name) {
  const guest = /^Guest \((.*)\)$/.exec(name);
  if (guest && (guest[1] === UNKNOWN_DEVICE || LABEL.test(guest[1]))) return name;
  return approvedName(name) || 'Player';
}

/** Create the tables; add columns, views, summaries and triggers only when SCHEMA changed. */
async function migrate(db) {
  const out = await db.batch([...TABLES, "SELECT value FROM meta WHERE key = 'schema'"].map((sql) => db.prepare(sql)));
  if (out.at(-1).results[0]?.value === SCHEMA) return;
  const { results } = await db.prepare('PRAGMA table_info(attempts)').all();
  const have = new Set(results.map((c) => c.name));
  const alter = ADDED_COLUMNS.filter(([name]) => !have.has(name)).map(([name, type]) => `ALTER TABLE attempts ADD COLUMN ${name} ${type}`);
  await db.batch([
    ...[...alter, ...DERIVED].map((sql) => db.prepare(sql)),
    db.prepare("INSERT INTO meta (key, value) VALUES ('schema', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(SCHEMA),
  ]);
}

/**
 * The scores database over a D1-style connection (Cloudflare D1, or node:sqlite wrapped by
 * scores-api.mjs). The schema is created or upgraded before the first query.
 */
export function createScores(db) {
  // A flag, not a shared promise: on Cloudflare a promise must not be awaited across requests.
  // Two requests racing at startup both migrate, which is harmless.
  let migrated = false;
  const ready = async () => {
    if (migrated) return;
    await migrate(db);
    migrated = true;
  };

  return {
    /** Apply one device's batch of events atomically. A device may only add to, or name, its own runs. */
    async sync(body) {
      const b = obj(body);
      const device = obj(b.device);
      const deviceId = id(device.id);
      if (!deviceId) return { error: 'A device id is required.' };
      if (!Array.isArray(b.events) || b.events.length > MAX_EVENTS) return { error: `Send up to ${MAX_EVENTS} events at a time.` };
      const fingerprint = typeof device.fingerprint === 'string' && FINGERPRINT.test(device.fingerprint) ? device.fingerprint : '';
      const label = typeof device.label === 'string' && LABEL.test(device.label) ? device.label : UNKNOWN_DEVICE;
      const now = Date.now();
      await ready();

      const events = b.events.map(parseEvent).filter(Boolean);
      const { results } = await db
        .prepare('SELECT id, device_id FROM runs WHERE id IN (SELECT value FROM json_each(?))')
        .bind(JSON.stringify([...new Set(events.map((e) => e.runId))]))
        .all();
      const owners = new Map(results.map((r) => [r.id, r.device_id]));

      const writes = [
        db
          .prepare(
            `INSERT INTO devices (id, fingerprint, label, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET fingerprint = excluded.fingerprint, label = excluded.label, last_seen = excluded.last_seen`,
          )
          .bind(deviceId, fingerprint, label, now, now),
      ];
      let accepted = 0;
      for (const e of events) {
        if (e.type === 'run' && !owners.has(e.runId)) {
          owners.set(e.runId, deviceId);
          writes.push(db.prepare('INSERT INTO runs (id, device_id, player, started_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING').bind(e.runId, deviceId, e.player, now));
        }
        if (owners.get(e.runId) !== deviceId) continue;
        accepted++;
        if (e.type === 'attempt') {
          const hits = e.log.filter((s) => s[3] !== null).length;
          writes.push(
            db
              .prepare(
                `INSERT INTO attempts (run_id, attempt, level, map, score, completed, created_at, shots, hits, shot_log) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(run_id, attempt) DO NOTHING`,
              )
              .bind(e.runId, e.attempt, e.level, e.map, e.score, e.completed ? 1 : 0, now, e.log.length, hits, JSON.stringify(e.log)),
          );
        } else if (e.type === 'name') {
          writes.push(db.prepare('UPDATE runs SET player = ? WHERE id = ? AND device_id = ?').bind(e.name, e.runId, deviceId));
          if (e.name) writes.push(db.prepare('UPDATE devices SET name = ? WHERE id = ?').bind(e.name, deviceId));
        }
      }
      await db.batch(writes);
      return { accepted, rejected: b.events.length - accepted };
    },

    async boards() {
      await ready();
      const keys = Object.keys(BOARD_QUERIES);
      const out = await db.batch(keys.map((k) => db.prepare(BOARD_QUERIES[k])));
      const r = Object.fromEntries(keys.map((k, i) => [k, out[i].results]));
      const maps = new Map();
      for (const m of r.mapAverages) {
        if (!maps.has(m.playerKey)) maps.set(m.playerKey, []);
        maps.get(m.playerKey).push({ map: m.map, avg: m.avg, plays: m.plays });
      }
      const named = (x) => ({ ...x, name: shownName(x.name) });
      return {
        runs: r.runs.map(named),
        levels: r.levels.map(named),
        maps: r.maps.map(named),
        career: r.career.map(({ playerKey, ...x }) => ({ ...named(x), maps: maps.get(playerKey) ?? [] })),
      };
    },

    /** Wipe everything (only offered for in-memory test databases). */
    async reset() {
      await ready();
      await db.batch(['attempts', 'runs', 'devices', ...SUMMARY_TABLES].map((t) => db.prepare(`DELETE FROM ${t}`)));
    },
  };
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

function send(status, body) {
  if (body === undefined) return new Response(null, { status, headers: HEADERS });
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8' } });
}

/** The JSON answer for an error thrown while handling a request. */
export function errorResponse(err) {
  if (err instanceof HttpError) return send(err.status, { error: err.message });
  console.error('[scores]', err);
  return send(500, { error: 'The scores database had a problem.' });
}

async function readJson(request) {
  // Requiring JSON also makes browsers preflight cross-site posts, which this API never allows.
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw new HttpError(413, 'Too much data.');
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'Too much data.');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Invalid JSON.');
  }
}

/**
 * Answer an /api/* request (a web Request → Response), or null for any other path.
 * `allowReset` adds POST /api/test-reset for throwaway test databases.
 */
export async function handleScores(request, scores, { allowReset = false } = {}) {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith('/api/')) return null;
  try {
    if (pathname === '/api/scores' && request.method === 'GET') return send(200, await scores.boards());
    if (pathname === '/api/sync' && request.method === 'POST') {
      const result = await scores.sync(await readJson(request));
      if (result.error) return send(400, { error: result.error });
      return send(200, { ...result, boards: await scores.boards() });
    }
    if (pathname === '/api/test-reset' && request.method === 'POST' && allowReset) {
      await scores.reset();
      return send(204);
    }
    return send(404, { error: 'Not found.' });
  } catch (err) {
    return errorResponse(err);
  }
}
