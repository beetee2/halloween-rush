import { defineConfig } from '@playwright/test';

const PORT = 4180;

/**
 * Browser smoke tests run against a production-style build made with `--mode e2e`,
 * which only adds deterministic test fixtures (window.__HR__). Headless Chromium renders
 * WebGL through SwiftShader (software), so frame rates here say nothing about real devices.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
    trace: 'retain-on-failure',
  },
  webServer: {
    // In-memory scores database; tests wipe it between tests through the --test-reset hook.
    command: `npm run build:e2e && node scripts/serve-lan.mjs --dir dist-e2e --host 127.0.0.1 --port ${PORT} --db :memory: --test-reset`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [{ name: 'chromium' }],
});
