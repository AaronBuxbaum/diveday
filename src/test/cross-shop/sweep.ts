import type { AppDb } from "@/db/client";
import type { DbFunction } from "./discover";
import type { TwoShops } from "./fixture";
import { type Evidence, findShopAValues, stringsIn } from "./oracle";
import { argumentsFor, functionKey, type Perspective } from "./plan";

/**
 * **One call of one database function, judged by the oracle.**
 *
 * Every call runs inside a savepoint that is always rolled back, so a writer
 * leaves nothing behind for the next call. Before the rollback, the call's
 * result is walked for shop A's ids and markers, and shop A's rows are
 * compared with the fingerprint taken when the fixture was built.
 */

export type CallOutcome = {
  key: string;
  /** What came back: a value, nothing, or a throw (a refusal is a throw or nothing). */
  answer: "value" | "nothing" | "threw";
  error?: string;
  /** Shop A's values found in the answer. */
  evidence: Evidence[];
  /** Tables whose shop A rows the call changed. */
  changed: string[];
};

class RolledBack extends Error {}

const CALL_TIMEOUT_MS = 10_000;

function isNothing(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (value instanceof Map || value instanceof Set) return value.size === 0;
  return false;
}

function within<T>(promise: Promise<T>, key: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${key} did not answer within ${CALL_TIMEOUT_MS}ms`)),
      CALL_TIMEOUT_MS,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

type Callable = (db: AppDb, ...args: unknown[]) => unknown;

/** Call `fn` as `perspective` inside a rolled-back savepoint and judge the answer. */
export async function sweepCall(
  db: AppDb,
  fixture: Pick<TwoShops, "a" | "fingerprint" | "changedTables" | "writeCount">,
  fn: DbFunction,
  call: Callable,
  perspective: Perspective,
): Promise<CallOutcome> {
  const key = functionKey(fn);
  const args = argumentsFor(fn, perspective);
  const excused = stringsIn(args);
  let outcome: CallOutcome = { key, answer: "nothing", evidence: [], changed: [] };
  try {
    await db.transaction(async (tx) => {
      const writesBefore = await fixture.writeCount(tx as unknown as AppDb);
      let value: unknown;
      let threw: unknown;
      try {
        value = await within(Promise.resolve(call(tx as unknown as AppDb, ...args)), key);
      } catch (error) {
        threw = error;
      }
      let changed: string[] = [];
      try {
        // Shop A's own calls may write shop A's rows; only a call as B is judged on them.
        const wrote =
          perspective.shop.id !== fixture.a.id &&
          (await fixture.writeCount(tx as unknown as AppDb)) !== writesBefore;
        if (wrote) changed = await fixture.changedTables(tx as unknown as AppDb);
      } catch {
        // The call left the savepoint aborted: nothing it wrote can stand.
      }
      outcome = {
        key,
        answer: threw !== undefined ? "threw" : isNothing(value) ? "nothing" : "value",
        error:
          threw === undefined
            ? undefined
            : String((threw as Error)?.message ?? threw).slice(0, 160),
        evidence: threw === undefined ? findShopAValues(value, fixture.fingerprint, excused) : [],
        changed,
      };
      throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error;
  }
  return outcome;
}

/** True when the outcome is a leak: shop A's data reached the caller, or A's rows changed. */
export function leaked(outcome: CallOutcome): boolean {
  return outcome.evidence.length > 0 || outcome.changed.length > 0;
}
