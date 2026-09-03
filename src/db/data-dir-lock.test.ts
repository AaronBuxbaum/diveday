import { describe, expect, it, vi } from "vitest";

import {
  acquireDataDirLock,
  holderIsLive,
  LOCK_FILE,
  type LockDeps,
  lockedMessage,
  parseLockOwner,
  processStartToken,
} from "./data-dir-lock";

/**
 * An in-memory filesystem plus a process table, so every branch of the lock can
 * be exercised without real processes or real files.
 */
function harness(options: {
  files?: Record<string, string>;
  alive?: number[];
  tokens?: Record<number, string | null>;
  pid?: number;
}) {
  const files: Record<string, string> = { ...options.files };
  const exitHandlers: Array<() => void> = [];
  const deps: LockDeps = {
    readFile: (file) => {
      if (!(file in files)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return files[file];
    },
    writeFile: (file, contents, exclusive) => {
      if (exclusive && file in files) throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
      files[file] = contents;
    },
    removeFile: (file) => {
      delete files[file];
    },
    makeDir: () => {},
    isAlive: (pid) => (options.alive ?? []).includes(pid),
    startToken: (pid) => options.tokens?.[pid] ?? null,
    onExit: (release) => exitHandlers.push(release),
    pid: options.pid ?? 100,
  };
  return { deps, files, exitHandlers };
}

const lockPath = `.pglite/${LOCK_FILE}`;

describe("parseLockOwner", () => {
  it("reads the pid and start token a lock records", () => {
    expect(parseLockOwner('{"pid":4242,"since":"618463"}')).toEqual({ pid: 4242, since: "618463" });
  });

  it("tolerates a lock written where the start token could not be read", () => {
    expect(parseLockOwner('{"pid":4242,"since":null}')).toEqual({ pid: 4242, since: null });
  });

  it("is null for an empty, half-written or pid-less lock rather than throwing", () => {
    expect(parseLockOwner("")).toBeNull();
    expect(parseLockOwner('{"pid":42')).toBeNull();
    expect(parseLockOwner("{}")).toBeNull();
    expect(parseLockOwner('{"pid":"4242"}')).toBeNull();
  });
});

describe("processStartToken", () => {
  it("reads field 22 out of /proc/<pid>/stat", () => {
    // Real line from this container, truncated. Verified against /proc/uptime
    // rather than counted off the man page: 618463 ticks against 6184.70s up.
    const stat =
      "1261 (node) R 1259 1261 1259 0 -1 4194560 2340 0 0 0 2 0 0 0 20 0 7 0 618463 767442944 110";
    expect(processStartToken(1261, () => stat)).toBe("618463");
  });

  it("survives a comm containing spaces and parentheses", () => {
    // `next-server (v16.3.4)` is exactly that, and splitting the whole line
    // would shift every field after it.
    const stat =
      "2542 (next-server (v16.3.4)) S 2525 2542 2525 0 -1 4194304 900 0 0 0 5 1 0 0 20 0 11 0 987654 8 9";
    expect(processStartToken(2542, () => stat)).toBe("987654");
  });

  it("is null off Linux, where there is no /proc to read", () => {
    expect(
      processStartToken(1, () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }),
    ).toBeNull();
  });

  it("is null rather than wrong when the line is not the shape it expects", () => {
    expect(processStartToken(1, () => "nonsense with no paren")).toBeNull();
  });
});

describe("holderIsLive", () => {
  const deps = (alive: boolean, token: string | null) => ({
    isAlive: () => alive,
    startToken: () => token,
  });

  it("is false once the holder has gone — the common case here, since the server is killed", () => {
    expect(holderIsLive({ pid: 7, since: "111" }, deps(false, null))).toBe(false);
  });

  it("is true for the same process still holding it", () => {
    expect(holderIsLive({ pid: 7, since: "111" }, deps(true, "111"))).toBe(true);
  });

  it("is false for a recycled pid — alive, but not the process that took the lock", () => {
    expect(holderIsLive({ pid: 7, since: "111" }, deps(true, "999"))).toBe(false);
  });

  it("stays conservative when it cannot discriminate", () => {
    // No token recorded (written off Linux), or none readable now. Treating a
    // live holder as stale would resume the silent fork this exists to stop.
    expect(holderIsLive({ pid: 7, since: null }, deps(true, "999"))).toBe(true);
    expect(holderIsLive({ pid: 7, since: "111" }, deps(true, null))).toBe(true);
  });
});

describe("acquireDataDirLock", () => {
  it("takes a free directory and records itself", () => {
    const { deps, files } = harness({ pid: 100, tokens: { 100: "555" } });
    acquireDataDirLock(".pglite", deps);
    expect(parseLockOwner(files[lockPath])).toEqual({ pid: 100, since: "555" });
  });

  it("refuses a directory another live process holds, naming it", () => {
    const { deps } = harness({
      files: { [lockPath]: '{"pid":4242,"since":"111"}' },
      alive: [4242],
      tokens: { 4242: "111" },
      pid: 100,
    });
    expect(() => acquireDataDirLock(".pglite", deps)).toThrow(/already open by process 4242/);
    expect(() => acquireDataDirLock(".pglite", deps)).toThrow(/kill 4242/);
  });

  it("takes over a lock left behind by a killed server", () => {
    // The normal end state here, not the exotic one — which is why a refusal
    // on liveness alone would eventually block every start.
    const { deps, files } = harness({
      files: { [lockPath]: '{"pid":4242,"since":"111"}' },
      alive: [],
      pid: 100,
      tokens: { 100: "555" },
    });
    acquireDataDirLock(".pglite", deps);
    expect(parseLockOwner(files[lockPath])).toEqual({ pid: 100, since: "555" });
  });

  it("takes over when the recorded pid now belongs to something else", () => {
    const { deps, files } = harness({
      files: { [lockPath]: '{"pid":4242,"since":"111"}' },
      alive: [4242],
      tokens: { 4242: "999", 100: "555" },
      pid: 100,
    });
    acquireDataDirLock(".pglite", deps);
    expect(parseLockOwner(files[lockPath])?.pid).toBe(100);
  });

  it("takes over a half-written lock rather than deadlocking on it", () => {
    const { deps, files } = harness({
      files: { [lockPath]: '{"pid":' },
      alive: [4242],
      pid: 100,
      tokens: { 100: "555" },
    });
    acquireDataDirLock(".pglite", deps);
    expect(parseLockOwner(files[lockPath])?.pid).toBe(100);
  });

  it("releases on exit, and the release is idempotent", () => {
    const { deps, files, exitHandlers } = harness({ pid: 100, tokens: { 100: "555" } });
    const release = acquireDataDirLock(".pglite", deps);
    expect(files[lockPath]).toBeDefined();
    release();
    expect(files[lockPath]).toBeUndefined();
    expect(() => release()).not.toThrow();
    expect(exitHandlers).toHaveLength(1);
  });

  it("never deletes a lock a third process has since taken", () => {
    // This process took the directory over as stale; another then took it from
    // this one. Removing the file on the way out would hand a live holder's
    // lock away.
    const { deps, files } = harness({ pid: 100, tokens: { 100: "555" } });
    const release = acquireDataDirLock(".pglite", deps);
    files[lockPath] = '{"pid":777,"since":"888"}';
    release();
    expect(parseLockOwner(files[lockPath])?.pid).toBe(777);
  });

  it("does not fail an exit path when the lock file has already vanished", () => {
    const { deps, files } = harness({ pid: 100, tokens: { 100: "555" } });
    const release = acquireDataDirLock(".pglite", deps);
    delete files[lockPath];
    expect(() => release()).not.toThrow();
  });

  it("propagates a write failure that is not a collision", () => {
    const { deps } = harness({ pid: 100 });
    const writeFile = vi.fn(() => {
      throw Object.assign(new Error("EACCES"), { code: "EACCES" });
    });
    expect(() => acquireDataDirLock(".pglite", { ...deps, writeFile })).toThrow(/EACCES/);
  });
});

describe("lockedMessage", () => {
  it("says what went wrong, why it matters, and the two ways out", () => {
    const said = lockedMessage(".pglite", { pid: 4242, since: "111" });
    expect(said).toContain(".pglite");
    expect(said).toContain("4242");
    expect(said).toContain("PGLITE_DATA_DIR");
    expect(said).toMatch(/fork/);
  });
});
