import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { AppDb } from "@/db/client";

/**
 * **The render-cost tripwires' two instruments**, shared by the staff renders
 * (`src/db/staff-render-cost.test.ts`) and the diver pages whose reads live in
 * `src/app` (`src/app/diver-render-cost.test.ts`): a printed count for the PR
 * description, and a database that answers in rounds so a replay can count the
 * phases a render waits through.
 */

/**
 * `DIVEDAY_PRINT_QUERY_COUNTS=1` prints each number as `[query-count] label: n`.
 */
export function report(label: string, queries: number): number {
  if (process.env.DIVEDAY_PRINT_QUERY_COUNTS === "1") {
    console.info(`[query-count] ${label}: ${queries}`);
  }
  return queries;
}

/**
 * A client that runs every statement at once but **hands answers back in
 * rounds**: it holds each result until nothing is running and nothing new has
 * been sent for {@link QUIET_MS}, then releases every held answer together.
 * Statements sent in one round therefore cannot depend on one another — none
 * of them has an answer yet — so the number of rounds is the length of the
 * longest chain of statements each waiting on the one before: the render's
 * serial round trips, whatever the machine's speed.
 */
const QUIET_MS = 50;

export function phaseCountingDb(client: PGlite) {
  let rounds = 0;
  let running = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const held: Array<() => void> = [];
  // Answers from outside the database that are **slower than any chain of
  // statements**, as a provider with a four-second timeout is: each comes back
  // only once the database has nothing left to answer, in a round of its own.
  // A render that awaits one waits that extra phase; one that streams it
  // finishes first.
  const slow: Array<() => void> = [];
  const settleLater = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (running > 0) return;
      const due = held.length > 0 ? held.splice(0) : slow.splice(0);
      if (due.length === 0) return;
      rounds += 1;
      for (const release of due) release();
      if (slow.length > 0) settleLater();
    }, QUIET_MS);
  };
  /** A value from outside the database, answered after the database goes quiet. */
  const slowly = <T>(value: () => T) =>
    new Promise<T>((resolve) => {
      slow.push(() => resolve(value()));
      settleLater();
    });
  const delayed = new Proxy(client, {
    get(target, property, receiver) {
      if (property === "query") {
        return (...args: Parameters<PGlite["query"]>) => {
          running += 1;
          settleLater();
          return target.query(...args).then(
            (result) =>
              new Promise<typeof result>((resolve) => {
                running -= 1;
                held.push(() => resolve(result));
                settleLater();
              }),
            (error: unknown) =>
              new Promise<never>((_resolve, reject) => {
                running -= 1;
                held.push(() => reject(error));
                settleLater();
              }),
          );
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const db = drizzle({ client: delayed as PGlite }) as unknown as AppDb;
  return { db, phases: () => rounds, slowly };
}
