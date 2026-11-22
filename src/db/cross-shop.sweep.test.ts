import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { trips } from "@/db/schema";
import {
  type DbFunction,
  dbModuleSources,
  importReader,
  readFunctions,
} from "@/test/cross-shop/discover";
import { buildTwoShops, FILLABLE_NAMES, type TwoShops } from "@/test/cross-shop/fixture";
import { NOT_SHOP_SCOPED, NOT_SHOP_SCOPED_ENTRIES } from "@/test/cross-shop/not-shop-scoped";
import { classifyAll, functionKey, type Verdict } from "@/test/cross-shop/plan";
import { type CallOutcome, leaked, sweepCall } from "@/test/cross-shop/sweep";
import { fileScopedShopContext } from "@/test/db";

/**
 * **The cross-shop sweep** (ADR 20261122-cross-shop-sweep).
 *
 * Shop A is the seeded demo shop with its history; shop B is minted beside it.
 * Every exported `src/db` function that takes a shop is called as shop B with
 * shop A's ids, in a savepoint that is rolled back, and fails the sweep if its
 * answer holds a primary key of A's or a `LEAK-A-` marker, or if A's rows
 * changed. Each is also called as shop A, so the sweep is seen to find A's data
 * when it is meant to. A function that takes no shop is named, with a reason,
 * in `src/test/cross-shop/not-shop-scoped.ts`; one that is neither fails here.
 */

const ROOT = process.cwd();
const COVERAGE_FILE = path.join(ROOT, "scripts/cross-shop-coverage.json");
const ctx = fileScopedShopContext({ history: true });

const functions = readFunctions(dbModuleSources(ROOT), importReader(ROOT));
const verdicts = classifyAll(functions, FILLABLE_NAMES, NOT_SHOP_SCOPED);
const of = <K extends Verdict["kind"]>(kind: K) =>
  verdicts.filter((verdict): verdict is Extract<Verdict, { kind: K }> => verdict.kind === kind);

function bankedNotFillable(): number {
  return (JSON.parse(readFileSync(COVERAGE_FILE, "utf8")) as { notFillable: number }).notFillable;
}

function notFillableTable(): string {
  return of("notFillable")
    .map((verdict) => `| ${functionKey(verdict.fn)} | ${verdict.missing.join(", ")} |`)
    .join("\n");
}

type Callable = (db: AppDb, ...args: unknown[]) => unknown;

async function implementation(fn: DbFunction): Promise<Callable> {
  const module = (await import(path.join(ROOT, "src/db", fn.file))) as Record<string, unknown>;
  const call = module[fn.name];
  if (typeof call !== "function") throw new Error(`${functionKey(fn)} is not exported at run time`);
  return call as Callable;
}

/** Three planted functions: one reads across shops, one writes across shops, one is safe. */
const CANARY_SOURCE = `
export async function leakyRead(db: AppDb, shopId: string, tripId: string) {}
export async function leakyWrite(db: AppDb, input: { shopId: string; tripId: string }) {}
export async function safeRead(db: AppDb, { shopId, tripId }: { shopId: string; tripId: string }) {}
`;
const CANARIES: Record<string, Callable> = {
  leakyRead: (db, _shopId, tripId) =>
    db
      .select()
      .from(trips)
      .where(eq(trips.id, tripId as string)),
  leakyWrite: async (db, input) => {
    await db
      .update(trips)
      .set({ title: "Renamed by shop B" })
      .where(eq(trips.id, (input as { tripId: string }).tripId));
  },
  safeRead: (db, input) => {
    const { shopId, tripId } = input as { shopId: string; tripId: string };
    return db
      .select()
      .from(trips)
      .where(eq(trips.id, tripId))
      .then((rows) => rows.filter((row) => row.shopId === shopId));
  },
};

function quiet() {
  vi.stubGlobal("fetch", () => Promise.reject(new Error("cross-shop sweep: no network")));
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  onTestFinished(() => {
    error.mockRestore();
    warn.mockRestore();
    vi.unstubAllGlobals();
  });
}

function describeLeak(outcome: CallOutcome): string {
  const found = outcome.evidence.map((evidence) => `${evidence.path} = ${evidence.value}`);
  const changed = outcome.changed.map((table) => `changed shop A's ${table}`);
  return `${outcome.key}: ${[...found, ...changed].join("; ")}`;
}

describe("the cross-shop sweep", () => {
  it("classifies every exported database function: swept, not shop-scoped by design, or not fillable yet", () => {
    const unclassified = of("unclassified").map((verdict) => functionKey(verdict.fn));
    expect(
      unclassified,
      "takes no shop and is not in src/test/cross-shop/not-shop-scoped.ts: give it a shop, or add it there with the reason it needs none",
    ).toEqual([]);

    const stale = of("staleAllowlist").map((verdict) => functionKey(verdict.fn));
    expect(stale, "takes a shop now: remove it from not-shop-scoped.ts").toEqual([]);

    const known = new Set(functions.map(functionKey));
    const missing = NOT_SHOP_SCOPED_ENTRIES.filter((key) => !known.has(key));
    expect(missing, "named in not-shop-scoped.ts but not an exported src/db function").toEqual([]);
    const twice = NOT_SHOP_SCOPED_ENTRIES.filter(
      (key, i) => NOT_SHOP_SCOPED_ENTRIES.indexOf(key) !== i,
    );
    expect(twice, "named twice in not-shop-scoped.ts").toEqual([]);

    const notFillable = of("notFillable").length;
    const banked = bankedNotFillable();
    const report =
      `cross-shop sweep: swept ${of("swept").length} of ${verdicts.length} database functions; ` +
      `${of("notShopScoped").length} take no shop by design; ${notFillable} not fillable yet (banked ${banked}).\n` +
      `| Not fillable yet | Parameters the sweep cannot fill |\n| --- | --- |\n${notFillableTable()}`;
    console.info(report);
    expect(
      notFillable,
      `More functions the sweep cannot fill than banked in scripts/cross-shop-coverage.json. ` +
        `Teach the sweep the new parameter names (FILLABLE_NAMES and the fixture in src/test/cross-shop/fixture.ts).`,
    ).toBeLessThanOrEqual(banked);
    expect(
      notFillable,
      `The sweep fills more than banked: set "notFillable" to ${notFillable} in scripts/cross-shop-coverage.json.`,
    ).toBe(banked);
  });

  it("calls every swept function as shop B with shop A's ids, and nothing of shop A's comes back or changes", async () => {
    quiet();
    const fixture: TwoShops = await buildTwoShops(ctx.db);

    // The fixture has a value of shop A's for every name the sweep fills.
    expect(
      [...FILLABLE_NAMES].filter((name) => !(name in fixture.asB.values)),
      "no value in the fixture for these names",
    ).toEqual([]);
    expect(fixture.markers).toBeGreaterThan(0);

    // The oracle is not blind: planted functions are judged as they should be.
    const canaries = readFunctions({ "canary.ts": CANARY_SOURCE });
    const canary = async (name: string) => {
      const fn = canaries.find((candidate) => candidate.name === name) as DbFunction;
      return sweepCall(ctx.db, fixture, fn, CANARIES[name] as Callable, fixture.asB);
    };
    const read = await canary("leakyRead");
    expect(read.evidence.length, "a cross-shop read is caught").toBeGreaterThan(0);
    const write = await canary("leakyWrite");
    expect(write.changed, "a cross-shop write is caught").toEqual(["trips"]);
    expect(await fixture.changedTables(ctx.db), "every call is rolled back").toEqual([]);
    const safe = await canary("safeRead");
    expect(leaked(safe), "a scoped read passes").toBe(false);

    const leaks: string[] = [];
    let sawShopA = 0;
    for (const { fn } of of("swept")) {
      const call = await implementation(fn);
      const asB = await sweepCall(ctx.db, fixture, fn, call, fixture.asB);
      if (leaked(asB)) leaks.push(describeLeak(asB));
      const asA = await sweepCall(ctx.db, fixture, fn, call, fixture.asA);
      if (asA.evidence.length > 0) sawShopA++;
    }
    console.info(
      `cross-shop sweep: ${of("swept").length} functions called as shop B; ${sawShopA} returned shop A's data when called as shop A.`,
    );
    expect(sawShopA, "called as shop A, the sweep must see shop A's data").toBeGreaterThan(0);
    expect(leaks, "shop A's data reached shop B").toEqual([]);
  });
});
