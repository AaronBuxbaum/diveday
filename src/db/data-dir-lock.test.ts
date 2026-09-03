import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  acquireDataDirLock,
  holderIsLive,
  LOCK_PREFIX,
  type LockDeps,
  lockedMessage,
  lockName,
  parseLockName,
  processStartToken,
} from "./data-dir-lock";

const DIR = ".pglite";

/**
 * One in-memory directory plus a process table, so every branch — including the
 * races — can be exercised without real processes or real files. Two harnesses
 * built over the same `entries` set are two processes sharing one directory.
 */
function harness(options: {
  entries?: Set<string>;
  alive?: number[];
  tokens?: Record<number, string | null>;
  pid?: number;
}) {
  const entries = options.entries ?? new Set<string>();
  const exitHandlers: Array<() => void> = [];
  const deps: LockDeps = {
    readDir: () => [...entries],
    createFile: (file) => {
      entries.add(path.basename(file));
    },
    removeFile: (file) => {
      entries.delete(path.basename(file));
    },
    makeDir: () => {},
    isAlive: (pid) => (options.alive ?? []).includes(pid),
    startToken: (pid) => options.tokens?.[pid] ?? null,
    onExit: (release) => exitHandlers.push(release),
    pid: options.pid ?? 100,
  };
  return { deps, entries, exitHandlers };
}

describe("lockName / parseLockName", () => {
  it("round-trips an owner through the filename that carries it", () => {
    expect(lockName({ pid: 4242, since: "618463" })).toBe(`${LOCK_PREFIX}4242.618463`);
    expect(parseLockName(`${LOCK_PREFIX}4242.618463`)).toEqual({ pid: 4242, since: "618463" });
  });

  it("round-trips a claim written where the start token could not be read", () => {
    const name = lockName({ pid: 4242, since: null });
    expect(name).toBe(`${LOCK_PREFIX}4242.unknown`);
    expect(parseLockName(name)).toEqual({ pid: 4242, since: null });
  });

  it("is null for PGlite's own files, so the sweep never touches the database", () => {
    expect(parseLockName("base")).toBeNull();
    expect(parseLockName("postgresql.conf")).toBeNull();
    expect(parseLockName("PG_VERSION")).toBeNull();
    expect(parseLockName(".diveday-lock")).toBeNull();
  });

  it("is null rather than wrong for a name that is malformed past the prefix", () => {
    expect(parseLockName(`${LOCK_PREFIX}4242`)).toBeNull();
    expect(parseLockName(`${LOCK_PREFIX}notapid.618463`)).toBeNull();
    expect(parseLockName(`${LOCK_PREFIX}4242.618463.extra`)).toBeNull();
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
    // live holder as gone would resume the silent fork this exists to stop.
    expect(holderIsLive({ pid: 7, since: null }, deps(true, "999"))).toBe(true);
    expect(holderIsLive({ pid: 7, since: "111" }, deps(true, null))).toBe(true);
  });
});

describe("acquireDataDirLock", () => {
  it("takes a free directory and leaves a claim naming this process", () => {
    const { deps, entries } = harness({ pid: 100, tokens: { 100: "555" } });
    acquireDataDirLock(DIR, deps);
    expect([...entries]).toEqual([lockName({ pid: 100, since: "555" })]);
  });

  it("refuses a directory a live process claims, naming it", () => {
    const { deps } = harness({
      entries: new Set([lockName({ pid: 4242, since: "111" })]),
      alive: [4242],
      tokens: { 4242: "111", 100: "555" },
      pid: 100,
    });
    expect(() => acquireDataDirLock(DIR, deps)).toThrow(/already open by process 4242/);
    expect(() => acquireDataDirLock(DIR, deps)).toThrow(/kill 4242/);
  });

  it("leaves nothing of its own behind when it refuses", () => {
    // A refused starter that left its claim would look like a live holder to
    // the next one, and the refusal would spread.
    const held = lockName({ pid: 4242, since: "111" });
    const { deps, entries } = harness({
      entries: new Set([held]),
      alive: [4242],
      tokens: { 4242: "111", 100: "555" },
      pid: 100,
    });
    expect(() => acquireDataDirLock(DIR, deps)).toThrow();
    expect([...entries]).toEqual([held]);
  });

  it("sweeps up the claim a killed server left and takes the directory", () => {
    // The normal end state here, not the exotic one — which is why refusing on
    // the presence of a claim alone would eventually block every start.
    const { deps, entries } = harness({
      entries: new Set([lockName({ pid: 4242, since: "111" })]),
      alive: [],
      pid: 100,
      tokens: { 100: "555" },
    });
    acquireDataDirLock(DIR, deps);
    expect([...entries]).toEqual([lockName({ pid: 100, since: "555" })]);
  });

  it("sweeps up a claim whose pid now belongs to something else", () => {
    const { deps, entries } = harness({
      entries: new Set([lockName({ pid: 4242, since: "111" })]),
      alive: [4242],
      tokens: { 4242: "999", 100: "555" },
      pid: 100,
    });
    acquireDataDirLock(DIR, deps);
    expect([...entries]).toEqual([lockName({ pid: 100, since: "555" })]);
  });

  it("ignores a claim naming this very process, rather than refusing its own database", () => {
    // A second opener inside one process is not what this guards, and the
    // refusal would be permanent — the holder is alive by definition.
    const { deps } = harness({ alive: [100], tokens: { 100: "555" }, pid: 100 });
    acquireDataDirLock(DIR, deps);
    expect(() => acquireDataDirLock(DIR, deps)).not.toThrow();
  });

  it("never touches a file that is not a claim", () => {
    const { deps, entries } = harness({
      entries: new Set(["base", "PG_VERSION", "postgresql.conf"]),
      pid: 100,
      tokens: { 100: "555" },
    });
    acquireDataDirLock(DIR, deps);
    expect([...entries].sort()).toEqual(
      ["PG_VERSION", "base", "postgresql.conf", lockName({ pid: 100, since: "555" })].sort(),
    );
  });

  it("releases on exit, and the release is idempotent", () => {
    const { deps, entries, exitHandlers } = harness({ pid: 100, tokens: { 100: "555" } });
    const release = acquireDataDirLock(DIR, deps);
    expect(entries.size).toBe(1);
    release();
    expect(entries.size).toBe(0);
    expect(() => release()).not.toThrow();
    expect(exitHandlers).toHaveLength(1);
  });

  it("propagates a failure to write its claim", () => {
    const { deps } = harness({ pid: 100 });
    const createFile = vi.fn(() => {
      throw Object.assign(new Error("EACCES"), { code: "EACCES" });
    });
    expect(() => acquireDataDirLock(DIR, { ...deps, createFile })).toThrow(/EACCES/);
  });

  it("lets exactly one of two openers through when they start together", () => {
    // The interleaving a "read the lock, decide it is stale, replace it" scheme
    // cannot survive: both openers write, and only then does either look. Here
    // the later writer is the one that sees the other, so it is the one that
    // refuses — and nothing was overwritten to get there.
    const entries = new Set<string>();
    const shared = { entries, alive: [100, 200], tokens: { 100: "555", 200: "666" } };
    const first = harness({ ...shared, pid: 100 });
    const second = harness({ ...shared, pid: 200 });

    let other: string | null = null;
    let interleaved = false;
    const firstDeps: LockDeps = {
      ...first.deps,
      readDir: () => {
        if (!interleaved) {
          interleaved = true;
          // The second opener runs start to finish between this one's write and
          // its read — the widest window the race has.
          try {
            acquireDataDirLock(DIR, second.deps);
            other = "held";
          } catch (error) {
            other = (error as Error).message;
          }
        }
        return first.deps.readDir(DIR);
      },
    };

    const release = acquireDataDirLock(DIR, firstDeps);
    expect(other).toMatch(/already open by process 100/);
    expect([...entries]).toEqual([lockName({ pid: 100, since: "555" })]);
    release();
    expect(entries.size).toBe(0);
  });
});

describe("lockedMessage", () => {
  it("says what went wrong, why it matters, and the two ways out", () => {
    const said = lockedMessage(DIR, { pid: 4242, since: "111" });
    expect(said).toContain(DIR);
    expect(said).toContain("4242");
    expect(said).toContain("PGLITE_DATA_DIR");
    expect(said).toMatch(/fork/);
  });
});
