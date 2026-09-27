import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import { defineConfig } from 'vitest/config';
import { createScoresApi } from './scripts/scores-api.mjs';

/**
 * The household scores API on the dev and preview servers too. They use their own database
 * file so development runs never land on the family's real scoreboard (serve:lan's).
 */
function scoresApi(): Plugin {
  const mount = (server: ViteDevServer | PreviewServer) => {
    const api = createScoresApi({ file: process.env.HR_DB ?? 'data/dev-scores.sqlite' });
    server.middlewares.use((req, res, next) => void api.handle(req, res, next));
    server.httpServer?.on('close', () => api.close());
  };
  return { name: 'halloween-rush-scores', configureServer: mount, configurePreviewServer: mount };
}

export default defineConfig({
  // Relative asset URLs so the build works from any static host path.
  base: './',
  plugins: process.env.VITEST ? [] : [scoresApi()],
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      // The game, plus the plain-HTML About page search engines and AI assistants can read.
      input: { main: 'index.html', about: 'about/index.html' },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
