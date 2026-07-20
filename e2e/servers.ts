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
// Each worker runs both a browser and its own Next server, so the machine
// hosts 2× the worker count in heavy processes. Half the cores (Playwright's
// own default heuristic) keeps that from oversubscribing the CPU — oversup­ply
// there shows up as cold-start latency spikes on the first authenticated
// render, which can blow an assertion's timeout. Override with E2E_WORKERS.
const envWorkers = Number(process.env.E2E_WORKERS);
const defaultWorkers = Math.max(1, Math.floor(cpus().length / 2));

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
