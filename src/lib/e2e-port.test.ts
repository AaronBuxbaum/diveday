import {
  defaultE2EBasePort,
  e2ePortBlock,
  E2E_DEFAULT_BASE_PORT_MIN,
  E2E_EPHEMERAL_PORT_START,
  E2E_WORKER_PORT_STRIDE,
  resolveE2EBasePort,
} from "./e2e-port";
import { describe, expect, it } from "vitest";

describe("e2e port allocation", () => {
  it("derives the same base port for the same worktree every time", () => {
    expect(defaultE2EBasePort("/worktrees/parallel-session")).toBe(
      defaultE2EBasePort("/worktrees/parallel-session"),
    );
  });

  it("keeps worker blocks separate for different worktrees", () => {
    const first = e2ePortBlock(defaultE2EBasePort("/worktrees/alpha"), E2E_WORKER_PORT_STRIDE);
    const second = e2ePortBlock(defaultE2EBasePort("/worktrees/beta"), E2E_WORKER_PORT_STRIDE);

    expect(first.some((port) => second.includes(port))).toBe(false);
  });

  it("keeps the derived block above the normal development port and below ephemeral ports", () => {
    const block = e2ePortBlock(
      defaultE2EBasePort("/worktrees/port-range"),
      E2E_WORKER_PORT_STRIDE,
    );

    expect(Math.min(...block)).toBeGreaterThanOrEqual(E2E_DEFAULT_BASE_PORT_MIN);
    expect(Math.max(...block)).toBeLessThan(E2E_EPHEMERAL_PORT_START);
  });

  it("lets an explicit base port win", () => {
    expect(resolveE2EBasePort("3900", "/worktrees/parallel-session")).toBe(3900);
  });
});
