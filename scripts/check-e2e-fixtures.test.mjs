import { describe, expect, it } from "vitest";

import { unregisteredSlugs } from "./check-e2e-fixtures.mjs";

/**
 * The registration half of the guard, which is the half with judgement in it
 * (issue #1791).
 *
 * The guard call itself is what a reviewer looks for and it is always there —
 * which is exactly why the count this script prints read as complete while the
 * table it is supposed to mirror had drifted five routes short. What matters
 * here is the three ways this check could go quietly useless: it has to key on
 * the directory name rather than anything a route's own source says, it has to
 * leave the two deliberate exemptions alone rather than being permanently red
 * on them, and it must not be fooled by the table's own prose, which quotes
 * slugs in docblocks between the entries.
 */

const routeFile = (slug) => `src/app/api/test/${slug}/route.ts`;

describe("routes that are not in the shared refusal table", () => {
  it("names a route with no entry", () => {
    const table = ['  { slug: "seed-gift", handler: seedGift.POST },'].join("\n");

    expect(unregisteredSlugs([routeFile("seed-gift"), routeFile("seed-new-thing")], table)).toEqual(
      ["seed-new-thing"],
    );
  });

  it("stays quiet on the two the table leaves out on purpose", () => {
    // `reset` has its own colocated route.test.ts covering this refusal and its
    // success path; `clock` is the fleet's frozen clock, which the fleet never
    // calls. A guard permanently red on those is a guard people route around.
    expect(unregisteredSlugs([routeFile("reset"), routeFile("clock")], "")).toEqual([]);
  });

  it("does not count a slug the table only mentions in a comment", () => {
    // The table interleaves long docblocks between its entries, several of them
    // naming sibling routes. A looser match would read those as registrations
    // and go quiet on exactly the drift this exists to catch.
    const table = [
      "  {",
      "    // Same shape as seed-stripe-account above, and the mirror of",
      '    // "seed-recap-pulse", which files a pulse rather than a gift.',
      '    slug: "seed-gift",',
      "  },",
    ].join("\n");

    expect(
      unregisteredSlugs([routeFile("seed-gift"), routeFile("seed-recap-pulse")], table),
    ).toEqual(["seed-recap-pulse"]);
  });

  it("answers nothing when every route is registered", () => {
    const table = '    slug: "depart-trip",\n    slug: "email-previews",\n';

    expect(
      unregisteredSlugs([routeFile("depart-trip"), routeFile("email-previews")], table),
    ).toEqual([]);
  });
});
