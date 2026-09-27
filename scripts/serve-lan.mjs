#!/usr/bin/env node
// Serve the built game so other devices on the local network can play, plus the household
// scores API (a SQLite file on this computer).
// Usage: node scripts/serve-lan.mjs [--port 4173] [--host 0.0.0.0] [--dir dist] [--db data/halloween-rush.sqlite]
// Environment variables PORT, HOST and HR_DB work too. There is no gameplay backend: every
// player's session runs entirely in their own browser; only finished levels and names are sent.
import { existsSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sirv from 'sirv';
import { createScoresApi } from './scores-api.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(root, arg('dir', 'dist'));
const port = Number(arg('port', process.env.PORT ?? '4173'));
const host = arg('host', process.env.HOST ?? '0.0.0.0');
const dbArg = arg('db', process.env.HR_DB ?? 'data/halloween-rush.sqlite');
const db = dbArg === ':memory:' ? dbArg : path.resolve(root, dbArg);
// Browser tests wipe their in-memory database between tests; never offered for a real file.
const scores = createScoresApi({ file: db, allowReset: args.includes('--test-reset') });

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid port "${port}". Use a number between 1 and 65535.`);
  process.exit(1);
}
if (!existsSync(path.join(dir, 'index.html'))) {
  console.error(`No build found in ${dir}. Run "npm run build" first.`);
  process.exit(1);
}

const assets = sirv(dir, {
  dev: false,
  etag: true,
  gzip: false,
  brotli: false,
  setHeaders(res, pathname) {
    // Hashed bundles can be cached forever; the entry page must always be fresh.
    if (pathname.startsWith('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    else res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  },
});

const server = http.createServer((req, res) => {
  void scores.handle(req, res, () =>
    assets(req, res, () => {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Not found');
    }),
  );
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Try: npm run serve:lan -- --port ${port + 1}`);
  else console.error(err.message);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`Halloween Rush is being served from ${dir}`);
  console.log(`Scores are saved in ${db === ':memory:' ? 'memory only (lost when this stops)' : db}`);
  console.log(`  This computer:  http://localhost:${port}/`);
  if (host === '0.0.0.0' || host === '::') {
    const nets = Object.values(os.networkInterfaces()).flat();
    const lan = nets.filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
    for (const ip of lan) console.log(`  Local network:  http://${ip}:${port}/`);
    if (!lan.length) console.log('  (No LAN IPv4 address found — is this computer connected to a network?)');
    console.log('Other devices must be on the same network, and this port must be allowed through');
    console.log("this computer's firewall for private networks. Press Ctrl+C to stop.");
  }
});

const stop = () =>
  server.close(() => {
    scores.close();
    process.exit(0);
  });
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
