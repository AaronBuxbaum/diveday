import { sql } from "drizzle-orm";
import { Client } from "pg";
import { expect, it, onTestFinished } from "vitest";
import { describePostgres, holdRowLock, postgresTestDb } from "@/test/postgres";

/**
 * The harness itself, held to the one promise its neighbours depend on:
 * **finishing a test never terminates a connection that is still alive.**
 *
 * This file exists because breaking that promise is invisible. The teardown in
 * `src/test/postgres.ts` used to drop each test's scratch database with
 * `WITH (FORCE)`, which terminates every backend still attached — and it ran
 * that drop immediately after `await`ing `pool.end()` on every pool the test
 * opened, on the reasonable-sounding assumption that an awaited `end()` means
 * the connections are gone.
 *
 * It does not. pg-pool's shutdown removes each idle client from its own
 * bookkeeping synchronously and then calls the asynchronous `client.end()`
 * without waiting for it, so `end()` resolves once a Terminate message has been
 * *queued*, not once the backend has processed it and exited (measured:
 * 153 of 200 iterations left at least one live backend behind). The drop was
 * therefore racing the graceful disconnects the same teardown had just started.
 * Usually the disconnects won. When the drop won, the surviving client received
 * `FATAL 57P01 terminating connection due to administrator command` with no
 * query in flight, pg re-emitted it as an unhandled `'error'` event on its pool,
 * and the run died — reporting, exactly as CI did on f476e58,
 * `Tests 9 passed (9)` and `Errors 1 error` in the same summary.
 *
 * Every assertion of the suites next door still passed on that run. Nothing
 * they check could have caught it, because the failure happens after they are
 * done. So the check belongs here, on the harness, and it has to be *arranged*
 * rather than waited for: a race that fires on a small fraction of runs proves
 * nothing when it does not fire.
 *
 * ## Why a harness test lives under `src/db/`
 *
 * `.github/workflows/ci.yml`'s real-postgres job runs `src/db/*.postgres.test.ts`
 * and nothing else, deliberately (a glob rather than a list, so a new suite
 * cannot be written and then run nowhere). A suite anywhere else skips in the
 * unit shards for want of `DIVEDAY_TEST_POSTGRES_URL` and has no other home.
 */

/**
 * Long enough that teardown certainly reaches its drop while the connection is
 * still up — the pools it ends first take single-digit milliseconds — and short
 * enough to be a rounding error on a suite that spends seconds migrating.
 *
 * A runner slow enough to overshoot it can only make this test weaker, never
 * flaky: the connection would already be closed when the old teardown dropped
 * the database, so the old code would pass too. The fixed teardown passes
 * either way.
 */
const HOLD_MS = 500;

describePostgres("the real-Postgres harness", () => {
  it("waits for a connection to close instead of terminating it with the database", async () => {
    const terminated: Error[] = [];
    // Registered *before* `postgresTestDb`'s own teardown and therefore run
    // *after* it: Vitest calls `onTestFinished` hooks in reverse registration
    // order, so this is the only vantage point from which the drop's aftermath
    // is observable at all.
    onTestFinished(() => {
      expect(terminated.map((error) => error.message)).toEqual([]);
    });

    const pg = await postgresTestDb({ migrations: false });

    // A raw client rather than one of the harness's pools, for two reasons: a
    // pooled client is drained by the `pool.end()` teardown already performs, so
    // it could not be held past it; and the server's own `pg_stat_activity` —
    // which is what the fix consults — cannot tell the two apart, so this also
    // pins that the drain covers a connection the harness never handed out.
    const client = new Client({ connectionString: pg.url });
    await client.connect();
    client.on("error", (error: Error) => terminated.push(error));

    // Deliberately not awaited. The test body returns with the connection still
    // attached, so teardown begins while it is up and has to wait for it.
    setTimeout(() => void client.end().catch(() => undefined), HOLD_MS);

    // Proves the setup is real before relying on it: this runs first of the
    // three hooks, so a connection that never opened would fail here rather
    // than making the assertion above vacuously true.
    onTestFinished(async () => {
      await expect(client.query("select 1")).resolves.toBeTruthy();
    });
  });

  it("releases a gate the test never released, rather than hanging its teardown", async () => {
    // `{ migrations: false }` and a one-column table: the gate needs a row to
    // lock, not the application's schema.
    const pg = await postgresTestDb({ migrations: false });
    await pg.db.execute(sql`create table gate_probe (id int primary key)`);
    await pg.db.execute(sql`insert into gate_probe (id) values (1)`);

    // `holdRowLock` checks a client out of a pool and leaves it inside an open
    // transaction. Left that way — which is what happens whenever a test fails
    // between taking the gate and releasing it — `pool.end()` waits for the
    // checked-out client forever, and the assertion failure that caused it is
    // reported as a teardown timeout instead. No `release()` here: the test
    // finishing is the whole scenario, and it passing at all is the assertion.
    await holdRowLock(pg, sql`select id from gate_probe where id = 1 for update`);
  });
});
