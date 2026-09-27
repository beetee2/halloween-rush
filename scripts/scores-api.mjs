// Household scores for Halloween Rush on a local SQLite file (node:sqlite, no extra
// dependencies). serve-lan.mjs and the Vite dev/preview servers mount it; the deployed game
// uses the same rules and API on Cloudflare D1 instead (see scores-core.mjs).
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createScores, errorResponse, handleScores, HttpError, MAX_BODY_BYTES } from './scores-core.mjs';

export { cleanName } from './scores-core.mjs';

/**
 * node:sqlite behind the small slice of Cloudflare's D1 API that scores-core.mjs uses.
 * The file is opened on the first query; `file` may be ':memory:'.
 */
function sqliteD1(file) {
  let db = null;
  const cache = new Map();
  const open = () => {
    if (db) return db;
    const memory = file === ':memory:';
    if (!memory) mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    db = new DatabaseSync(file);
    if (!memory) db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    return db;
  };
  const prepared = (sql) => {
    let s = cache.get(sql);
    if (!s) cache.set(sql, (s = open().prepare(sql)));
    return s;
  };
  const statement = (sql, args) => ({
    bind: (...values) => statement(sql, values),
    all: async () => ({ results: prepared(sql).all(...args) }),
    rows: () => prepared(sql).all(...args),
  });
  return {
    prepare: (sql) => statement(sql, []),
    /** Run statements in one transaction, like D1's batch(). */
    async batch(list) {
      const conn = open();
      conn.exec('BEGIN');
      try {
        const out = list.map((s) => ({ results: s.rows() }));
        conn.exec('COMMIT');
        return out;
      } catch (err) {
        conn.exec('ROLLBACK');
        throw err;
      }
    },
    close() {
      cache.clear();
      db?.close();
      db = null;
    },
  };
}

/** The scores database in a local SQLite file (created if needed); `file` may be ':memory:'. */
export function openScores(file) {
  const db = sqliteD1(file);
  return { ...createScores(db), close: () => db.close() };
}

function readBody(req) {
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
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Connect-style middleware (`handle(req, res, next)`) for /api/*. The database opens on the
 * first query. `allowReset` adds POST /api/test-reset, only for ':memory:' test servers.
 */
export function createScoresApi({ file, allowReset = false }) {
  const scores = openScores(file);
  const canReset = allowReset && file === ':memory:';
  return {
    file,
    async handle(req, res, next) {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (!url.pathname.startsWith('/api/')) return next();
      let response;
      try {
        const body = req.method === 'POST' ? await readBody(req) : undefined;
        const request = new Request(url, { method: req.method, headers: { 'content-type': String(req.headers['content-type'] ?? '') }, body });
        response = await handleScores(request, scores, { allowReset: canReset });
      } catch (err) {
        response = errorResponse(err);
      }
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    },
    close() {
      scores.close();
    },
  };
}
