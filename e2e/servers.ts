import { cpus } from "node:os";

/**
 * Shared topology for the e2e server fleet, imported by playwright.config.ts,
 * global-setup.ts, and fixtures.ts so the three never drift.
 *
 * Each Playwright worker gets its own precompiled `next start` server on its
 * own port, backed by its own in-memory PGlite database. The servers serve a
 * single read-only production build, so the only per-worker state is that
 * isolated database — which `/api/test/reset` restores before each test. That
 * isolation is what lets the suite run fully parallel.
 */
// Each worker runs BOTH a headless browser AND its own Next server, so every
// worker costs ~2 cores, not one. Playwright's usual cpus/2 heuristic assumes
// one browser per worker; using it here (e.g. 2 workers on a 4-core CI runner)
// puts 4 heavy processes on 4 cores, and the resulting contention slows the
// first render of each route enough to blow assertion timeouts — which then
// burn retries and make the parallel run *slower* than a serial one. Budget
// ~2 cores per worker instead, which lands on a single uncontended worker for
// a typical 4-core runner and scales up on bigger machines. Override with
// E2E_WORKERS.
const envWorkers = Number(process.env.E2E_WORKERS);
const defaultWorkers = Math.max(1, Math.floor(cpus().length / 4));

/** How many parallel worker servers to run (and therefore Playwright workers). */
export const E2E_WORKER_COUNT =
  Number.isFinite(envWorkers) && envWorkers > 0 ? Math.floor(envWorkers) : defaultWorkers;

/** First port; worker i listens on E2E_BASE_PORT + i. */
export const E2E_BASE_PORT = Number(process.env.E2E_BASE_PORT ?? 3100) || 3100;

export function e2ePort(workerIndex: number): number {
  return E2E_BASE_PORT + workerIndex;
}

export function e2eBaseURL(workerIndex: number): string {
  return `http://127.0.0.1:${e2ePort(workerIndex)}`;
}

export const e2eWorkerIndexes: number[] = Array.from({ length: E2E_WORKER_COUNT }, (_, i) => i);
