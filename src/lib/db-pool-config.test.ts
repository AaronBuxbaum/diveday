import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { getDbPoolConfig, isPgBouncerUrl, listenForPoolErrors } from "./db-pool-config";

describe("getDbPoolConfig", () => {
  it("defaults to a small pool sized for many concurrent serverless instances", () => {
    expect(getDbPoolConfig({})).toEqual({
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
  });

  it("reads overrides from env", () => {
    expect(
      getDbPoolConfig({
        DATABASE_POOL_MAX: "20",
        DATABASE_POOL_IDLE_TIMEOUT_MS: "30000",
        DATABASE_POOL_CONNECTION_TIMEOUT_MS: "2000",
      }),
    ).toEqual({
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 2_000,
    });
  });

  it("falls back to defaults for missing, non-numeric, or non-positive overrides", () => {
    expect(
      getDbPoolConfig({
        DATABASE_POOL_MAX: "not-a-number",
        DATABASE_POOL_IDLE_TIMEOUT_MS: "0",
        DATABASE_POOL_CONNECTION_TIMEOUT_MS: "-5",
      }),
    ).toEqual({
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
  });

  it("doubles the default on Neon's pooled endpoint, where a client connection is not a backend", () => {
    const pooled =
      "postgresql://u:p@ep-cool-name-123456-pooler.us-east-2.aws.neon.tech/db?sslmode=require";
    expect(getDbPoolConfig({ DATABASE_URL: pooled }).max).toBe(10);
    // An explicit override still wins.
    expect(getDbPoolConfig({ DATABASE_URL: pooled, DATABASE_POOL_MAX: "4" }).max).toBe(4);
  });

  it("keeps five on a direct connection, or anything it cannot read", () => {
    const direct =
      "postgresql://u:p@ep-cool-name-123456.us-east-2.aws.neon.tech/db?sslmode=require";
    expect(getDbPoolConfig({ DATABASE_URL: direct }).max).toBe(5);
    expect(getDbPoolConfig({ DATABASE_URL: "not a url" }).max).toBe(5);
    // A database *named* like a pooler is not a pooler host.
    expect(isPgBouncerUrl("postgresql://u:p@db.internal/ep-x-pooler")).toBe(false);
    expect(isPgBouncerUrl(undefined)).toBe(false);
  });
});

describe("listenForPoolErrors", () => {
  it("turns an idle client's error into a warn line instead of an uncaught exception", () => {
    const pool = new EventEmitter();
    // Without a listener, Node throws an emitted "error" out of emit().
    expect(() => pool.emit("error", new Error("boom"))).toThrow("boom");

    listenForPoolErrors(pool);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const terminated = Object.assign(
      new Error("terminating connection due to administrator command: SELECT secret"),
      { code: "57P01" },
    );
    expect(() => pool.emit("error", terminated)).not.toThrow();
    const line = JSON.parse(String(warn.mock.calls[0]?.[0]));
    warn.mockRestore();

    expect(line).toMatchObject({
      level: "warn",
      event: "db_pool.idle_client_error",
      name: "Error",
      code: "57P01",
    });
    // Codes only: a pg message can quote the statement it was running.
    expect(JSON.stringify(line)).not.toContain("SELECT secret");
  });
});
