import { Socket } from "node:net";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import { withExplicitSslMode } from "@/db/connection-string";

export const ADMIN_DEADLINE_MS = 10_000;
export const POOL_CLOSE_MS = 5_000;

export type FixturePool = {
  pool: Pool;
  close: () => Promise<void>;
  cancel: () => void;
};

/** Own the sockets so cancellation closes I/O, not just a competing promise. */
export function fixturePool(
  connectionString: string,
  idleErrors: Error[],
  administrative = false,
  options: {
    closeMs?: number;
    makePool?: (config: PoolConfig) => Pool;
    makeSocket?: () => Socket;
  } = {},
): FixturePool {
  const sockets = new Map<Socket, Promise<void>>();
  const borrowed = new Set<PoolClient>();
  const pool = (options.makePool ?? ((config) => new Pool(config)))({
    connectionString: withExplicitSslMode(connectionString),
    max: 4,
    // Subject queries deliberately have no query/statement timeout: their locks
    // are what real-Postgres concurrency tests are exercising.
    ...(administrative
      ? { connectionTimeoutMillis: 3_000, query_timeout: 9_000, statement_timeout: 9_000 }
      : {}),
    stream: () => {
      const socket = options.makeSocket?.() ?? new Socket();
      sockets.set(
        socket,
        new Promise((resolve) =>
          socket.once("close", () => {
            sockets.delete(socket);
            resolve();
          }),
        ),
      );
      return socket;
    },
  });
  pool.on("error", (error: Error) => idleErrors.push(error));
  pool.on("acquire", (client: PoolClient) => borrowed.add(client));
  pool.on("release", (_error: Error | undefined, client: PoolClient) => borrowed.delete(client));

  const cancel = () => {
    for (const client of borrowed) {
      const release = client.release;
      // Only after forced disposal: a late transaction finally must not replace
      // its original error with pg's "release called twice" diagnostic.
      client.release = () => undefined;
      release(true);
    }
    for (const socket of sockets.keys()) socket.destroy();
  };
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= (async () => {
      let forced = false;
      let leaked = 0;
      const timer = setTimeout(() => {
        forced = true;
        leaked = borrowed.size;
        cancel();
      }, options.closeMs ?? POOL_CLOSE_MS);
      try {
        await pool.end();
      } finally {
        clearTimeout(timer);
        const ended = [...sockets.values()];
        for (const socket of sockets.keys()) socket.destroy();
        await Promise.all(ended);
      }
      if (forced)
        throw new Error(
          `postgres fixture: pool shutdown deadline expired; ${leaked} checked-out client(s) force-disposed`,
        );
    })();
    return closing;
  };
  return { pool, close, cancel };
}

/** A deadline also cancels connection establishment, queries and owned sockets. */
export async function adminOperation<T>(
  connectionString: string,
  idleErrors: Error[],
  label: string,
  work: (pool: Pool, deadline: number) => Promise<T>,
  options: { timeoutMs?: number; create?: typeof fixturePool } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? ADMIN_DEADLINE_MS;
  const managed = (options.create ?? fixturePool)(connectionString, idleErrors, true);
  const deadline = Date.now() + timeoutMs;
  let timeout: Error | undefined;
  const timer = setTimeout(() => {
    timeout = new Error(
      `postgres fixture: ${label} exceeded its ${timeoutMs}ms administrative deadline`,
    );
    managed.cancel();
  }, timeoutMs);
  let value: T | undefined;
  let failure: unknown;
  let failed = false;
  try {
    value = await work(managed.pool, deadline);
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    clearTimeout(timer);
    try {
      await managed.close();
    } catch (error) {
      failure = failed
        ? new AggregateError([failure, error], `postgres fixture: ${label} and disposal failed`, {
            cause: failure,
          })
        : error;
      failed = true;
    }
  }
  if (timeout) throw new Error(timeout.message, { cause: failure });
  if (failed) throw failure;
  return value as T;
}
