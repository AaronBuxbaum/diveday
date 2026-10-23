import { EventEmitter } from "node:events";
import { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDbPoolConfig,
  isPgBouncerUrl,
  isRetryableConnectError,
  listenForPoolErrors,
  retryConnectOnce,
} from "./db-pool-config";

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

const connectTimeout = () => new Error("timeout exceeded when trying to connect");
const authFailure = () =>
  Object.assign(new Error('password authentication failed for user "x"'), { code: "28P01" });

/**
 * A stand-in for `pg`'s `Client`, handed to a real `pg` `Pool` so the pool's own `query` and
 * `connect` paths run unchanged. `connects` scripts each connection attempt's outcome in order;
 * `queries` counts statements that reached a connected client.
 */
function scriptedClient(connects: Array<Error | null>, queryError?: Error) {
  const counts = { connects: 0, queries: 0 };
  class FakeClient extends EventEmitter {
    connect(callback: (error?: Error) => void) {
      const outcome = connects[counts.connects] ?? null;
      counts.connects += 1;
      setImmediate(() => callback(outcome ?? undefined));
    }
    query(_text: unknown, _values: unknown, callback: (error?: Error, result?: unknown) => void) {
      counts.queries += 1;
      setImmediate(() =>
        queryError ? callback(queryError) : callback(undefined, { rows: [{ ok: 1 }] }),
      );
    }
    isConnected() {
      return true;
    }
    end(callback?: () => void) {
      callback?.();
    }
  }
  return { FakeClient, counts };
}

describe("retryConnectOnce", () => {
  const pools: Pool[] = [];
  const poolWith = (Client: unknown) => {
    const pool = new Pool({ Client: Client as never, max: 1 });
    pools.push(pool);
    return pool;
  };
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(pools.splice(0).map((pool) => pool.end()));
  });

  it("tries a timed-out connection once more before a query reports anything", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { FakeClient, counts } = scriptedClient([connectTimeout(), null]);
    const pool = poolWith(FakeClient);
    retryConnectOnce(pool);

    await expect(pool.query("select 1")).resolves.toMatchObject({ rows: [{ ok: 1 }] });

    expect(counts).toEqual({ connects: 2, queries: 1 });
    const line = JSON.parse(String(warn.mock.calls[0]?.[0]));
    expect(line).toMatchObject({ level: "warn", event: "db_pool.connect_retried" });
  });

  it("gives up after the second failed connection, with that attempt's error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const second = new Error("Connection terminated due to connection timeout");
    const { FakeClient, counts } = scriptedClient([connectTimeout(), second, null]);
    const pool = poolWith(FakeClient);
    retryConnectOnce(pool);

    await expect(pool.query("select 1")).rejects.toBe(second);
    expect(counts).toEqual({ connects: 2, queries: 0 });
  });

  it("never re-runs a statement that failed after the connection was made", async () => {
    // A query that reached the server may have run; running it again could write twice.
    const { FakeClient, counts } = scriptedClient(
      [null, null],
      new Error("canceling statement due to statement timeout"),
    );
    const pool = poolWith(FakeClient);
    retryConnectOnce(pool);

    await expect(pool.query("insert into x values (1)")).rejects.toThrow("statement timeout");
    expect(counts).toEqual({ connects: 1, queries: 1 });
  });

  it("does not retry a refusal the server answered with, such as a wrong password", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { FakeClient, counts } = scriptedClient([authFailure(), null]);
    const pool = poolWith(FakeClient);
    retryConnectOnce(pool);

    await expect(pool.query("select 1")).rejects.toMatchObject({ code: "28P01" });
    expect(counts.connects).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("retries the promise form a transaction checks a client out with", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { FakeClient, counts } = scriptedClient([connectTimeout(), null]);
    const pool = poolWith(FakeClient);
    retryConnectOnce(pool);

    const client = await pool.connect();
    client.release();

    expect(counts.connects).toBe(2);
  });
});

describe("isRetryableConnectError", () => {
  it("retries what never reached a server answer: timeouts and network errors", () => {
    expect(isRetryableConnectError(connectTimeout())).toBe(true);
    expect(isRetryableConnectError(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBe(
      true,
    );
    expect(isRetryableConnectError(Object.assign(new Error("x"), { code: "ETIMEDOUT" }))).toBe(
      true,
    );
  });

  it("leaves alone a refusal another attempt cannot change", () => {
    expect(isRetryableConnectError(authFailure())).toBe(false);
    expect(isRetryableConnectError(Object.assign(new Error("x"), { code: "3D000" }))).toBe(false);
    expect(isRetryableConnectError(Object.assign(new Error("x"), { code: "28000" }))).toBe(false);
    expect(
      isRetryableConnectError(new Error("Cannot use a pool after calling end on the pool")),
    ).toBe(false);
    expect(isRetryableConnectError("not an error")).toBe(false);
  });
});
