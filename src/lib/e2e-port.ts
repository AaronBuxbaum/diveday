const DEFAULT_BASE_PORT = 12_000;
const WORKER_PORT_STRIDE = 64;
const EPHEMERAL_PORT_START = 32_768;
const BUCKET_COUNT =
  Math.floor((EPHEMERAL_PORT_START - DEFAULT_BASE_PORT - WORKER_PORT_STRIDE) / WORKER_PORT_STRIDE) +
  1;

/**
 * Derive a stable port block from the worktree path. The hash makes collisions
 * between concurrent worktrees rare, not impossible; reuseExistingServer is
 * deliberately false so a collision fails loudly instead of using stale state.
 */
export function defaultE2EBasePort(cwd: string): number {
  let hash = 2_166_136_261;
  for (const character of cwd) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return DEFAULT_BASE_PORT + ((hash >>> 0) % BUCKET_COUNT) * WORKER_PORT_STRIDE;
}

export function resolveE2EBasePort(explicitValue: string | undefined, cwd: string): number {
  const explicitPort = Number(explicitValue);
  return Number.isFinite(explicitPort) && explicitPort > 0
    ? Math.floor(explicitPort)
    : defaultE2EBasePort(cwd);
}

export function e2ePortBlock(basePort: number, workerCount: number): number[] {
  return Array.from({ length: workerCount }, (_, workerIndex) => basePort + workerIndex);
}

export const E2E_WORKER_PORT_STRIDE = WORKER_PORT_STRIDE;
export const E2E_DEFAULT_BASE_PORT_MIN = DEFAULT_BASE_PORT;
export const E2E_EPHEMERAL_PORT_START = EPHEMERAL_PORT_START;
