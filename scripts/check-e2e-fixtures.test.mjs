import { describe, expect, it } from "vitest";

import {
  registeredHandlers,
  SHOP_READERS_BY_DESIGN,
  shopReadersWithoutDemoGate,
  unregisteredHandlers,
} from "./check-e2e-fixtures.mjs";

/**
 * The registration half of the guard, which is the half with judgement in it
 * (issue #1791).
 *
 * The guard call itself is what a reviewer looks for and it is always there —
 * which is exactly why the count this script prints read as complete while the
 * table it mirrors had drifted five routes short. What matters here is the
 * ways this check could go quietly useless: it has to key on the handler and
 * not the directory, on the whole path and not the last segment, it has to
 * leave the two deliberate exemptions alone rather than being permanently red
 * on them, and it must not be fooled by the table's own prose — which quotes
 * slugs in docblocks between entries — or by the `describe` blocks below the
 * table, which build requests with verbs of their own.
 */

const post = (routePath) => ({ routePath, method: "POST" });
const del = (routePath) => ({ routePath, method: "DELETE" });
/** The table's own shape: an array literal the parser bounds itself to. */
const table = (body) => `const routes: SeedRoute[] = [\n${body}\n];\n`;

describe("handlers that are not in the shared refusal table", () => {
  it("names a handler with no entry", () => {
    const source = table('  { slug: "seed-gift" },');

    expect(unregisteredHandlers([post("seed-gift"), post("seed-new-thing")], source)).toEqual([
      "POST seed-new-thing",
    ]);
  });

  /**
   * **A directory is not a door.** The first cut keyed on the directory alone,
   * so one row vouched for every verb in it — and `seed-year-band-shop`'s
   * `DELETE`, which drops a whole seeded shop, was unproven while its `POST`
   * was registered (`security-reviewer`, 2026-09-13).
   */
  it("wants a row per verb, not per directory", () => {
    const source = table('  { slug: "seed-year-band-shop" },');

    expect(
      unregisteredHandlers([post("seed-year-band-shop"), del("seed-year-band-shop")], source),
    ).toEqual(["DELETE seed-year-band-shop"]);
  });

  it("stays quiet on the two the table leaves out on purpose", () => {
    // `reset` has its own colocated route.test.ts covering this refusal and its
    // success path; `clock` is the fleet's frozen clock, which the fleet never
    // calls. A guard permanently red on those is a guard people route around.
    expect(unregisteredHandlers([post("reset"), post("clock")], "")).toEqual([]);
  });

  /**
   * Nesting under `api/test` is unusual, but the exemption is what makes it
   * worth pinning: keyed on the last segment, an `x/reset/route.ts` would
   * inherit `reset`'s pass and never need a row of its own.
   */
  it("keys on the whole path, so a nested route cannot inherit an exemption", () => {
    const source = table('  { slug: "seed-gift" },');

    expect(unregisteredHandlers([post("x/reset"), post("x/seed-gift")], source)).toEqual([
      "POST x/reset",
      "POST x/seed-gift",
    ]);
  });

  it("answers nothing when every handler is registered", () => {
    const source = table('  { slug: "depart-trip" },\n  { slug: "email-previews" },');

    expect(unregisteredHandlers([post("depart-trip"), post("email-previews")], source)).toEqual([]);
  });
});

describe("reading the table", () => {
  it("does not count a slug the table only mentions in a comment", () => {
    // The table interleaves long docblocks between its entries, several of them
    // naming sibling routes. A looser match would read those as registrations
    // and go quiet on exactly the drift this exists to catch.
    const source = table(
      [
        "  {",
        "    // Same shape as seed-stripe-account above, and the mirror of",
        '    // "seed-recap-pulse", which files a pulse rather than a gift.',
        '    slug: "seed-gift",',
        "  },",
      ].join("\n"),
    );

    expect(registeredHandlers(source)).toEqual(new Set(["POST seed-gift"]));
  });

  it("reads an explicit method off the entry it belongs to", () => {
    const source = table(
      [
        '  { slug: "email-previews",',
        '    method: "GET",',
        "  },",
        '  { slug: "seed-gift" },',
      ].join("\n"),
    );

    expect(registeredHandlers(source)).toEqual(new Set(["GET email-previews", "POST seed-gift"]));
  });

  /**
   * The last entry's slice used to run to the end of the file, and the
   * `describe` blocks below the table build requests of their own — one of them
   * with `method: "DELETE"`. Not theoretical: it is what this guard did on its
   * first run against the real table.
   */
  it("stops at the end of the array literal, not the end of the file", () => {
    const source = [
      table('  { slug: "seed-gift" },'),
      'describe("DELETE /api/test/x", () => {',
      '  const request = { method: "DELETE" };',
      "});",
    ].join("\n");

    expect(registeredHandlers(source)).toEqual(new Set(["POST seed-gift"]));
  });
});

describe("test routes that reach a shop without the demo gate (issue #2751)", () => {
  const route = (name, contents) => ({ path: `src/app/api/test/${name}/route.ts`, contents });

  it("names a route that resolves a caller's slug with no requireDemoTenant", () => {
    expect(
      shopReadersWithoutDemoGate([
        route("seed-thing", "const shop = await getShopBySlug(db, parsed.data.shopSlug);"),
      ]),
    ).toEqual(["src/app/api/test/seed-thing/route.ts"]);
  });

  it("names one that only takes a shopSlug or touches the shops table", () => {
    expect(
      shopReadersWithoutDemoGate([
        route("a", "const body = z.object({ shopSlug: z.string() });"),
        route("b", "await db.update(shops).set({ name: 'x' });"),
      ]),
    ).toEqual(["src/app/api/test/a/route.ts", "src/app/api/test/b/route.ts"]);
  });

  it("passes a gated route, a route with no shop, a test file and the written exceptions", () => {
    expect(
      shopReadersWithoutDemoGate([
        route(
          "gated",
          "const tenant = await requireDemoTenant(request, () => getShopBySlug(db, slug));",
        ),
        route("clock", "return Response.json({ ok: true });"),
        { path: "src/app/api/test/seed-thing/route.test.ts", contents: "getShopBySlug(" },
        ...[...SHOP_READERS_BY_DESIGN.keys()].map((file) => ({
          path: file,
          contents: "getShopBySlug(db, slug)",
        })),
      ]),
    ).toEqual([]);
  });

  it("does not take a mention of the gate's name as a call", () => {
    expect(
      shopReadersWithoutDemoGate([
        route("x", "// requireDemoTenant is not called here\ngetShopBySlug(db, slug);"),
      ]),
    ).toEqual(["src/app/api/test/x/route.ts"]);
  });

  it("gives every exception a written reason", () => {
    for (const reason of SHOP_READERS_BY_DESIGN.values()) expect(reason.length).toBeGreaterThan(20);
  });
});
