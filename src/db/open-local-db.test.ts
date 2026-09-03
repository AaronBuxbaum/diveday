import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { openLocalDb } from "./client";
import { LOCK_PREFIX, lockName, processStartToken } from "./data-dir-lock";

/**
 * The failure path of a cold start, against a real PGlite on a real directory.
 *
 * The success path is exercised by every other database test in the suite and
 * by the app itself; this one is the path nothing else reaches. A cold start
 * that throws must leave the directory exactly as open as it found it, because
 * `getDb()` clears its memo on a rejection and the next request opens another —
 * so anything left behind is left behind *per retry*, for as long as something
 * keeps asking. The audit that raised issue #1325 confirmed a ~170 MB PGlite
 * instance pinned per attempt; the claim file is the worse half, since it is
 * what a *second process* reads to decide the directory is taken.
 */
const dirs: string[] = [];

function tempDataDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "diveday-open-local-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

describe("openLocalDb", () => {
  it("leaves no lock behind when the migration throws", async () => {
    const dataDir = tempDataDir();
    await expect(
      openLocalDb(dataDir, {
        runMigrate: async () => {
          throw new Error("migration exploded");
        },
      }),
    ).rejects.toThrow("migration exploded");
    expect(readdirSync(dataDir).filter((name) => name.startsWith(LOCK_PREFIX))).toEqual([]);
  });

  it("is openable again after a failed start — the property the cleanup is for", async () => {
    // Stronger than asserting the lock file is gone: this only passes if the
    // client was closed *and* the lock released, which together are what make a
    // failed cold start recoverable rather than terminal for the process.
    const dataDir = tempDataDir();
    await expect(
      openLocalDb(dataDir, {
        runMigrate: async () => {
          throw new Error("first attempt fails");
        },
      }),
    ).rejects.toThrow();

    const db = await openLocalDb(dataDir);
    const rows = await db.execute("select 1 as ok");
    expect(rows.rows[0]).toEqual({ ok: 1 });
  }, 30_000);

  it("refuses a directory another live process holds, without opening PGlite at all", async () => {
    // Cross-process by construction: the holder is pid 1, which exists on every
    // machine this runs on and is never this test. Two `openLocalDb` calls in
    // one process could not stand in for it — a claim naming *this* pid is
    // ignored rather than obeyed, deliberately (see `acquireDataDirLock`).
    const dataDir = tempDataDir();
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(path.join(dataDir, lockName({ pid: 1, since: processStartToken(1) })), "");
    await expect(openLocalDb(dataDir)).rejects.toThrow(/already open by process 1/);
  });
});
