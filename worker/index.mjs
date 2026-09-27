// Cloudflare Worker for the deployed game. Workers static assets serve the build (dist/);
// only /api/* reaches this code (run_worker_first in wrangler.jsonc). The leaderboards live
// in a D1 database, so everyone who plays the deployed game shares them.
import { createScores, handleScores } from '../scripts/scores-core.mjs';

/** Bindings are not tied to a request, so one Scores (and its schema check) serves them all. */
let scores = null;

export default {
  async fetch(request, env) {
    scores ??= createScores(env.DB);
    return (await handleScores(request, scores)) ?? new Response('Not found', { status: 404 });
  },
};
