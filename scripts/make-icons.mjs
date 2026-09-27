#!/usr/bin/env node
// Renders public/icon.svg to the PNG sizes phones use for Home Screen icons.
// Run after editing the SVG: node scripts/make-icons.mjs (uses Playwright's Chromium).
import { readFileSync } from 'node:fs';
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
await browser.close();
