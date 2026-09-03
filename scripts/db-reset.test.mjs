import { describe, expect, it } from "vitest";

import { dataDir, runningDevServer } from "./db-reset.mjs";

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
