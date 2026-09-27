#!/usr/bin/env node
// Starts the LAN static server against the production build and checks that the entry
// page and every asset it references are served correctly — over loopback and, when
// available, over this machine's own LAN address. Also checks the build makes no
// references to remote hosts (runtime must work offline on the LAN).
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 4300 + Math.floor(Math.random() * 500);
const lanIp = Object.values(os.networkInterfaces())
  .flat()
  .find((n) => n && n.family === 'IPv4' && !n.internal)?.address;

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures++;
};

// Static check: no absolute remote URLs are fetched at runtime.
const distAssets = path.join(root, 'dist', 'assets');
const files = readdirSync(distAssets).map((f) => path.join(distAssets, f));
const remote = /(src|href)\s*=\s*["']https?:\/\/|fetch\(\s*["']https?:\/\/|url\(\s*["']?https?:\/\//i;
check(!remote.test(readFileSync(path.join(root, 'dist', 'index.html'), 'utf8')), 'index.html loads nothing from remote hosts');
check(files.every((f) => !/\.(css|html)$/.test(f) || !remote.test(readFileSync(f, 'utf8'))), 'CSS loads nothing from remote hosts');

// An in-memory scores database, so checking the server never touches the family's real one.
const server = spawn(process.execPath, [path.join(root, 'scripts', 'serve-lan.mjs'), '--port', String(port), '--host', '0.0.0.0', '--db', ':memory:'], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
let banner = '';
server.stdout.on('data', (d) => (banner += d));

async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`);
      if (r.ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

async function verifyOrigin(origin) {
  const res = await fetch(`${origin}/`);
  const html = await res.text();
  check(res.status === 200, `${origin}/ returns 200`);
  check(/<title>Halloween Rush<\/title>/.test(html), `${origin}/ is the Halloween Rush entry page`);
  check((res.headers.get('content-type') ?? '').includes('text/html'), `${origin}/ is served as text/html`);
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !u.startsWith('data:') && !u.startsWith('http'));
  check(refs.length >= 2, `${origin}/ references ${refs.length} local assets`);
  for (const ref of refs) {
    const url = new URL(ref, `${origin}/`);
    const r = await fetch(url);
    const type = r.headers.get('content-type') ?? '';
    const want = ref.endsWith('.js') ? 'javascript' : ref.endsWith('.css') ? 'text/css' : '';
    check(r.status === 200 && type.includes(want), `${url.pathname} -> ${r.status} ${type}`);
  }
  const missing = await fetch(`${origin}/definitely-missing.js`);
  check(missing.status === 404, `${origin} returns 404 for missing files`);
  const traversal = await fetch(`${origin}/..%2f..%2fpackage.json`);
  check(traversal.status === 404, `${origin} does not serve files outside the build folder`);
  const scores = await fetch(`${origin}/api/scores`);
  const boards = await scores.json().catch(() => null);
  check(scores.status === 200 && Array.isArray(boards?.runs), `${origin}/api/scores answers with the leaderboards`);
  const plain = await fetch(`${origin}/api/sync`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  check(plain.status === 415, `${origin}/api/sync refuses non-JSON posts (no cross-site form writes)`);
}

try {
  await waitUp();
  await verifyOrigin(`http://127.0.0.1:${port}`);
  if (lanIp) await verifyOrigin(`http://${lanIp}:${port}`);
  else console.log('SKIP  no LAN IPv4 address on this machine');
} catch (e) {
  check(false, String(e));
} finally {
  check(/This computer:\s+http:\/\/localhost:\d+/.test(banner), 'server printed its local URL');
  server.kill('SIGTERM');
}
console.log(banner.trim());
console.log(failures ? `\n${failures} check(s) failed` : '\nAll serve checks passed');
process.exit(failures ? 1 : 0);
