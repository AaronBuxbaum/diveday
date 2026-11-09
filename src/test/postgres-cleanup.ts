import type { Pool } from "pg";
import type { FixturePool } from "./postgres-io";

export type RunAdministrative = <T>(
  label: string,
  work: (pool: Pool, deadline: number) => Promise<T>,
) => Promise<T>;

/**
 * Wait until Postgres reports no backend attached to `database` any more,
 * answering with however many are still attached when the budget runs out.
 *
 * This exists because **`await pool.end()` does not mean the server-side
 * connections are gone.** pg-pool's shutdown path (`_pulseQueue`'s `ending`
 * branch → `_remove`) drops each idle client from its own bookkeeping
 * *synchronously* and then calls the asynchronous `client.end()` without
 * waiting for it, so `end()`'s promise resolves once a Terminate message has
 * been *queued* — not once the backend has processed it and exited. Measured on
 * pg-pool 3.14.0 against a local Postgres 16: seven pools opened, queried, and
 * all `end()`ed together left at least one live backend behind in **153 of 200**
 * iterations.
 *
 * Which was silently fine until the next statement this harness ran was
 * `DROP DATABASE … WITH (FORCE)`. Force terminates every backend still on the
 * database, so it was racing the graceful disconnects the same teardown had
 * just started: usually the backends won and exited first, occasionally the drop
 * did and killed one mid-goodbye. The loser receives
 * `FATAL 57P01 terminating connection due to administrator command`, which
 * arrives with no query in flight and therefore becomes the unhandled pool
 * `'error'` described above — a run where every test passes and the job still
 * fails. Waiting for the drain first is what removes the race; there is then
 * nothing left for the drop to terminate.
 *
 * Read from `pg_stat_activity` rather than from pg-pool's internals for the
 * same reason {@link waitForLockWaiters} does: it is the server's own account,
 * so it also covers a connection this harness never handed out (a raw
 * `pg.Client` a test opened itself, say) instead of only the pools it tracks.
 */
async function drainedBackends(admin: Pool, database: string, deadline: number): Promise<number> {
  let last: number | undefined;
  for (;;) {
    if (Date.now() >= deadline) {
      if (last !== undefined) return last;
      throw new Error(
        "postgres fixture: backend drain deadline expired before its first observation",
      );
    }
    // The admin pool is connected to the *server's* default database, never to
    // `database`, so it can never count itself.
    const result = await admin.query<{ attached: number }>(
      "select count(*)::int as attached from pg_stat_activity where datname = $1",
      [database],
    );
    const attached = result.rows[0]?.attached ?? 0;
    last = attached;
    if (attached === 0) return 0;
    if (deadline - Date.now() <= 5) return attached;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Fail the test that produced an idle-client error, rather than the whole worker. */
function assertNoIdleErrors(idleErrors: Error[]): void {
  const [first] = idleErrors;
  if (!first) return;
  throw new Error(
    `postgres fixture: ${idleErrors.length} connection(s) died while idle in a pool — ` +
      `first: ${first.message}`,
    { cause: first },
  );
}

/** Register teardown before CREATE: a lost reply can still mean a committed database. */
export async function prepareScratchDatabase(
  name: string,
  pools: FixturePool[],
  idleErrors: Error[],
  runAdmin: RunAdministrative,
  registerCleanup: (cleanup: () => Promise<void>) => void,
) {
  registerCleanup(() => cleanupScratchDatabase(name, pools, idleErrors, runAdmin));
  await runAdmin("scratch database CREATE", (admin) => admin.query(`CREATE DATABASE "${name}"`));
}

async function cleanupScratchDatabase(
  name: string,
  pools: FixturePool[],
  idleErrors: Error[],
  runAdmin: RunAdministrative,
) {
  const failures: unknown[] = [];
  const ended = await Promise.allSettled(pools.map((managed) => managed.close()));
  for (const result of ended) if (result.status === "rejected") failures.push(result.reason);
  let stranded: number | undefined;
  try {
    stranded = await runAdmin("backend drain", (admin, deadline) =>
      drainedBackends(admin, name, deadline),
    );
  } catch (error) {
    failures.push(error);
  }
  try {
    // Normal DROP requires observed draining. If that observation failed, try
    // bounded force cleanup, but retain the original failure in the result.
    await runAdmin("scratch database DROP", (admin) =>
      admin.query(`DROP DATABASE IF EXISTS "${name}"${stranded === 0 ? "" : " WITH (FORCE)"}`),
    );
  } catch (error) {
    failures.push(error);
  }
  if (stranded && stranded > 0)
    failures.push(
      new Error(
        `postgres fixture: ${stranded} connection(s) to ${name} were still attached after every pool was ended — something opened a connection the test never closed`,
        { cause: idleErrors[0] },
      ),
    );
  try {
    assertNoIdleErrors(idleErrors);
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0)
    throw new AggregateError(failures, "postgres fixture: scratch database cleanup failed", {
      cause: failures[0],
    });
}
