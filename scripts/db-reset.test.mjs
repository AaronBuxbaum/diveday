import { describe, expect, it } from "vitest";

import { dataDir, pidIsAlive, resolveDataDir, runningDevServer } from "./db-reset.mjs";

const LIVE = '{"pid":16223,"port":3000,"hostname":"localhost","appUrl":"http://localhost:3000"}';

describe("runningDevServer", () => {
  it("names the server holding the checkout, so the refusal can say which pid to stop", () => {
    expect(runningDevServer(LIVE, () => true)).toEqual({ pid: 16223, port: 3000 });
  });

  it("is null for a stale lock whose pid has gone", () => {
    // The common case here, not an edge one: `next dev` in this app is usually
    // killed rather than stopped, and a lock left behind must not block every
    // future reset.
    expect(runningDevServer(LIVE, () => false)).toBeNull();
  });

  it("is null for a lockfile caught half-written", () => {
    expect(runningDevServer('{"pid":16', () => true)).toBeNull();
    expect(runningDevServer("", () => true)).toBeNull();
  });

  it("is null when the lockfile carries no pid", () => {
    expect(runningDevServer('{"port":3000}', () => true)).toBeNull();
  });

  it("survives a lockfile with no port — the pid is what the refusal needs", () => {
    expect(runningDevServer('{"pid":42}', () => true)).toEqual({ pid: 42, port: undefined });
  });
});

describe("pidIsAlive", () => {
  const alive = () => process.pid;

  it("accepts a live pid whose command line is a next process", () => {
    expect(pidIsAlive(alive(), () => "node /repo/node_modules/next/dist/bin/next dev")).toBe(true);
  });

  it("refuses a recycled pid now running something else", () => {
    // A dev server here is usually killed rather than stopped, so its lockfile
    // outlives it. Liveness alone would have this refuse every future reset and
    // name an unrelated process while doing it.
    expect(pidIsAlive(alive(), () => "/usr/bin/postgres -D /var/lib/postgresql")).toBe(false);
  });

  it("falls back to liveness alone where /proc does not exist", () => {
    // macOS. Unchanged behaviour there, which is the right way round: this
    // check's failure mode is refusing a reset, never performing a bad one.
    expect(pidIsAlive(alive(), () => null)).toBe(true);
  });

  it("is false for a pid that is simply gone", () => {
    // 2^22 is above every default pid_max, so nothing can be running there.
    expect(pidIsAlive(4194304, () => null)).toBe(false);
  });
});

describe("resolveDataDir", () => {
  it("leaves an absolute PGLITE_DATA_DIR absolute", () => {
    // `path.join(root, "/tmp/pglite")` would be `<repo>/tmp/pglite` — not the
    // directory src/db/client.ts opened, and possibly one that exists.
    expect(resolveDataDir("/tmp/pglite-probe", "/repo")).toBe("/tmp/pglite-probe");
  });

  it("resolves a relative one against the repository, the way PGlite resolves it", () => {
    expect(resolveDataDir(".pglite", "/repo")).toBe("/repo/.pglite");
    expect(resolveDataDir(".pglite-e2e", "/repo")).toBe("/repo/.pglite-e2e");
  });
});

describe("dataDir", () => {
  it("defaults to the same .pglite src/db/client.ts opens", () => {
    expect(dataDir({})).toBe(".pglite");
  });

  it("follows PGLITE_DATA_DIR so a reset clears the database actually in use", () => {
    expect(dataDir({ PGLITE_DATA_DIR: ".pglite-e2e" })).toBe(".pglite-e2e");
  });

  it("is null for the in-memory setting, which has nothing on disk", () => {
    expect(dataDir({ PGLITE_DATA_DIR: "memory" })).toBeNull();
  });
});
