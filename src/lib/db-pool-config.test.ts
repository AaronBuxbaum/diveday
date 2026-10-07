import { describe, expect, it } from "vitest";
import { getDbPoolConfig, isPgBouncerUrl } from "./db-pool-config";

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
