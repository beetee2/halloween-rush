#!/usr/bin/env node
// Renders public/icon.svg to the PNG sizes phones use for Home Screen icons, a 48 px
// favicon.ico, and the 1200×630 og-image.png that search results and link previews show.
// Run after editing the SVG: node scripts/make-icons.mjs (uses Playwright's Chromium).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const pub = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const svg = readFileSync(path.join(pub, 'icon.svg'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: path.join(pub, file) });
  console.log(`wrote public/${file}`);
}

// An .ico holding one PNG image: 6-byte header, one 16-byte directory entry, then the PNG.
await page.setViewportSize({ width: 48, height: 48 });
await page.setContent(`<style>html,body{margin:0}svg{display:block;width:48px;height:48px}</style>${svg}`);
const png = await page.screenshot();
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2); // type: icon
ico.writeUInt16LE(1, 4); // one image
ico.writeUInt8(48, 6); // width
ico.writeUInt8(48, 7); // height
ico.writeUInt16LE(1, 10); // colour planes
ico.writeUInt16LE(32, 12); // bits per pixel
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(22, 18); // image data offset
writeFileSync(path.join(pub, 'favicon.ico'), Buffer.concat([ico, png]));
console.log('wrote public/favicon.ico');

await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<style>
  html, body { margin: 0; }
  body {
    width: 1200px; height: 630px; display: flex; align-items: center; gap: 56px; padding: 0 72px;
    box-sizing: border-box; overflow: hidden; color: #fff4dc;
    font-family: 'Trebuchet MS', 'DejaVu Sans', 'Liberation Sans', sans-serif;
    background: radial-gradient(ellipse at 70% 30%, #5b2a8f, #170b24 75%);
  }
  svg { flex: none; width: 340px; height: 340px; border-radius: 56px; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6); }
  h1 {
    margin: 0; font-size: 100px; line-height: 0.95; font-weight: 900; color: #ff8a1c;
    -webkit-text-stroke: 5px #2a1242; paint-order: stroke fill; text-shadow: 0 8px 0 #2a0f45;
  }
  h1 span { display: block; color: #7ed957; }
  p { margin: 28px 0 0; font-size: 32px; font-weight: 700; white-space: nowrap; }
  small { display: block; margin-top: 14px; font-size: 30px; line-height: 1.3; color: #ffd23a; font-weight: 700; }
</style>${svg}<div><h1>Halloween <span>Rush</span></h1><p>Free 3D Halloween shooting game</p><small>Play in your browser<br>halloweenrush.app</small></div>`);
await page.screenshot({ path: path.join(pub, 'og-image.png') });
console.log('wrote public/og-image.png');
await browser.close();
