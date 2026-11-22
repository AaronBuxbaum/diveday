import { describe, expect, it } from "vitest";
import { readFunctions, takesShop, UNSEEN } from "./discover";
import { findShopAValues, LEAK_MARKER, stringsIn } from "./oracle";
import { argumentsFor, classify } from "./plan";

// The sweep's own parts, without a database: what discovery reads, how a
// function is classified, and what the oracle calls a leak. The database half,
// planted leaky and safe functions included, is src/db/cross-shop.sweep.test.ts.

const SHOP_A_TRIP = "11111111-1111-4111-8111-111111111111";
const SHOP_A_PERSON = "22222222-2222-4222-8222-222222222222";
const fingerprint = { ids: new Set([SHOP_A_TRIP, SHOP_A_PERSON]) };

const SOURCE = `
import type { Imported } from "./elsewhere";
type Lookup = { shopId: string; tripId: string; limit?: number };
interface Scoped { shopId: string }
interface Edit extends Scoped { bookingId: string; note?: string }
export async function positional(db: AppDb, shopId: string, tripId: string, now = new Date()) {}
export async function destructured(db: AppDb, { shopId, personId, limit = 20 }: { shopId: string; personId: string; limit?: number }) {}
export async function byShopRow(tx: AppTransaction, shop: Shop, bookingId: string) {}
export const arrow = async (db: AppDb, input: Lookup) => {};
export async function extended(db: AppDb, input: Edit) {}
export async function picked(db: AppDb, input: Omit<Lookup, "limit"> & { kind: Kind }) {}
export async function either(db: AppDb, input: { shopId: string } & ({ tripId: string } | { other: string })) {}
export async function imported(db: AppDb, input: Imported) {}
export async function partlySeen(db: AppDb, input: Imported & { shopId: string }) {}
export async function party(db: AppDb, requests: Lookup[], options: { holdUntil?: Date } = {}) {}
export async function notices(tx: AppTransaction, notices: readonly Edit[], now: Date = new Date()) {}
export async function generic(db: AppDb, requests: Array<Lookup>, more: ReadonlyArray<Scoped>) {}
export async function plainList(db: AppDb, shopId: string, tripIds: string[]) {}
export async function inferred(db: AppDb, notification: Inferred) {}
export async function noShop(db: AppDb, token: string) {}
export function pure(value: number) {}
`;

const read = (source: string, readImport?: Parameters<typeof readFunctions>[1]) =>
  Object.fromEntries(readFunctions({ "sample.ts": source }, readImport).map((fn) => [fn.name, fn]));

describe("discovery reads parameter names", () => {
  const fns = read(SOURCE);

  it("reads positional names, optional by default value", () => {
    expect(fns.positional?.params).toEqual([
      { name: "db", optional: false, fields: undefined },
      { name: "shopId", optional: false, fields: undefined },
      { name: "tripId", optional: false, fields: undefined },
      { name: "now", optional: true, fields: undefined },
    ]);
  });

  it("reads a destructured options object", () => {
    expect(fns.destructured?.params[1]).toEqual({
      name: "{}",
      optional: false,
      fields: [
        { name: "shopId", optional: false },
        { name: "personId", optional: false },
        { name: "limit", optional: true },
      ],
    });
  });

  it("reads a shop row as the shop, without opening it", () => {
    expect(fns.byShopRow?.params.map((param) => param.name)).toEqual(["tx", "shop", "bookingId"]);
    expect(fns.byShopRow && takesShop(fns.byShopRow)).toBe(true);
  });

  it("reads fields through aliases, interfaces, Omit, intersections and unions", () => {
    const names = (name: string) => fns[name]?.params[1]?.fields?.map((field) => field.name);
    expect(names("arrow")).toEqual(["shopId", "tripId", "limit"]);
    expect(names("extended")).toEqual(["shopId", "bookingId", "note"]);
    expect(names("picked")).toEqual(["shopId", "tripId", "kind"]);
    expect(names("either")).toEqual(["shopId", "tripId"]);
  });

  it("reads a list of requests as its element's fields, and finds the shop inside", () => {
    expect(fns.party?.params[1]).toEqual({
      name: "requests",
      optional: false,
      each: true,
      fields: [
        { name: "shopId", optional: false },
        { name: "tripId", optional: false },
        { name: "limit", optional: true },
      ],
    });
    expect(fns.notices?.params[1]?.each).toBe(true);
    expect(fns.notices?.params[1]?.fields?.map((field) => field.name)).toEqual([
      "shopId",
      "bookingId",
      "note",
    ]);
    expect(fns.generic?.params.slice(1).map((param) => param.each)).toEqual([true, true]);
    for (const name of ["party", "notices", "generic"]) {
      expect(fns[name] && takesShop(fns[name]), name).toBe(true);
    }
    // A list of plain values is still one named value, filled whole.
    expect(fns.plainList?.params[2]).toEqual({
      name: "tripIds",
      optional: false,
      fields: undefined,
    });
  });

  it("follows an import, and marks a type it cannot see", () => {
    expect(fns.imported?.params[1]?.fields).toBeUndefined();
    expect(fns.partlySeen?.params[1]?.fields?.map((field) => field.name)).toEqual([
      UNSEEN,
      "shopId",
    ]);
    const followed = read(SOURCE, (specifier) =>
      specifier === "./elsewhere"
        ? {
            file: "elsewhere.ts",
            text: "export type Imported = { shopId: string; seriesId: string };",
          }
        : null,
    );
    expect(followed.imported?.params[1]?.fields?.map((field) => field.name)).toEqual([
      "shopId",
      "seriesId",
    ]);
  });
});

describe("classification", () => {
  const fns = read(SOURCE);
  const fillable = new Set(["tripId", "personId", "bookingId", "limit", "now", "note"]);

  it("sweeps a function whose every required name is known", () => {
    for (const name of ["positional", "destructured", "byShopRow", "arrow", "extended", "either"]) {
      const fn = fns[name];
      if (!fn) throw new Error(`no ${name}`);
      expect(classify(fn, fillable, new Map()).kind, name).toBe("swept");
    }
  });

  it("fills a list parameter with one request carrying the caller's shop", () => {
    const fn = fns.party;
    if (!fn) throw new Error("no party");
    expect(classify(fn, fillable, new Map()).kind).toBe("swept");
    expect(argumentsFor(fn, { shop: { id: "shop-b" }, values: { tripId: SHOP_A_TRIP } })).toEqual([
      [{ shopId: "shop-b", tripId: SHOP_A_TRIP }],
    ]);
  });

  it("sweeps a function whose type it cannot read once its arguments are written by hand", () => {
    const fn = fns.inferred;
    if (!fn) throw new Error("no inferred");
    expect(takesShop(fn)).toBe(false);
    expect(classify(fn, fillable, new Map()).kind).toBe("unclassified");
    const byHand = new Map([["sample.ts:inferred", () => [{ shopId: "shop-b" }]]]);
    expect(classify(fn, fillable, new Map(), byHand)).toMatchObject({ kind: "swept" });
    // Swept by hand and excused at once is a contradiction, and fails.
    const excused = new Map([["sample.ts:inferred", "stale"]]);
    expect(classify(fn, fillable, excused, byHand).kind).toBe("staleAllowlist");
  });

  it("names what it cannot fill, never guesses it", () => {
    const fn = fns.picked;
    if (!fn) throw new Error("no picked");
    expect(classify(fn, fillable, new Map())).toMatchObject({
      kind: "notFillable",
      missing: ["input.kind"],
    });
    const partly = fns.partlySeen;
    if (!partly) throw new Error("no partlySeen");
    expect(classify(partly, fillable, new Map())).toMatchObject({ missing: [`input.${UNSEEN}`] });
  });

  it("fails a new function that takes no shop until the allowlist says why", () => {
    const fn = fns.noShop;
    if (!fn) throw new Error("no noShop");
    expect(classify(fn, fillable, new Map()).kind).toBe("unclassified");
    const allowed = new Map([["sample.ts:noShop", "a token names its own shop"]]);
    expect(classify(fn, fillable, allowed).kind).toBe("notShopScoped");
  });

  it("fails an allowlisted function that has since gained a shop", () => {
    const fn = fns.positional;
    if (!fn) throw new Error("no positional");
    expect(classify(fn, fillable, new Map([["sample.ts:positional", "stale"]])).kind).toBe(
      "staleAllowlist",
    );
  });

  it("fills each argument by name from the caller's perspective", () => {
    const fn = fns.destructured;
    if (!fn) throw new Error("no destructured");
    const shop = { id: "shop-b" };
    expect(argumentsFor(fn, { shop, values: { personId: SHOP_A_PERSON, limit: 5 } })).toEqual([
      { shopId: "shop-b", personId: SHOP_A_PERSON, limit: 5 },
    ]);
    const positional = fns.positional;
    if (!positional) throw new Error("no positional");
    expect(argumentsFor(positional, { shop, values: { tripId: SHOP_A_TRIP } })).toEqual([
      "shop-b",
      SHOP_A_TRIP,
    ]);
  });
});

describe("the oracle", () => {
  it("flags a shop A id or marker at any depth", () => {
    const leak = { trips: [{ crew: new Map([["lead", { personId: SHOP_A_PERSON }]]) }] };
    expect(findShopAValues(leak, fingerprint)).toEqual([
      { path: "trips[0].crew[lead].personId", value: SHOP_A_PERSON },
    ]);
    expect(findShopAValues({ name: `Ana Diaz ${LEAK_MARKER}12` }, fingerprint)).toHaveLength(1);
  });

  it("leaves shop B's values, nothing, and the caller's own ids alone", () => {
    expect(findShopAValues([{ id: "shop-b-trip", title: "Night dive" }], fingerprint)).toEqual([]);
    expect(findShopAValues(null, fingerprint)).toEqual([]);
    const echoed = { tripId: SHOP_A_TRIP, found: false };
    expect(findShopAValues(echoed, fingerprint, stringsIn(["shop-b", SHOP_A_TRIP]))).toEqual([]);
  });
});
