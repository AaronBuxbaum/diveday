import { describe, expect, it } from "vitest";
import { getDbPoolConfig } from "./db-pool-config";

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
});
