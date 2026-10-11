import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  auditLedger,
  collectWorld,
  deriveCoverage,
  effectiveLedger,
  LEDGER_PATH,
  ledgerEntries,
  parseCaptureNames,
  pathLiterals,
  planLedgerWrite,
  routePatternFor,
  routesForPath,
  serializeLedger,
  summaryLine,
} from "./check-route-coverage.mjs";

// ---------------------------------------------------------------------------
// A throwaway tree shaped like the repo: some `src/app/**/page.tsx` routes, some
// `e2e/*.spec.ts` files, and a `e2e/visual.spec.ts` with real `capture(page, …)`
// calls in it. Fixtures rather than mocks, because the thing under test is
// precisely "does the ledger match what is on disk".

async function fixture({
  routes = [],
  specs = [],
  captures = [],
  ledger,
  sources = {},
  visual,
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "route-coverage-"));
  for (const route of routes) {
    const dir = path.join(root, "src/app", route === "/" ? "" : route.slice(1));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "page.tsx"), "export default function Page() {}\n");
  }
  await mkdir(path.join(root, "e2e"), { recursive: true });
  for (const spec of specs) {
    await writeFile(path.join(root, "e2e", spec), sources[spec] ?? "// a spec\n");
  }
  const body = captures.map((name) => `      await capture(page, "${name}", scheme);`).join("\n");
  await writeFile(path.join(root, "e2e/visual.spec.ts"), visual ?? `${body}\n`);
  if (ledger !== undefined) {
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await writeFile(path.join(root, LEDGER_PATH), `${JSON.stringify(ledger, null, 2)}\n`);
  }
  return root;
}

/** A tree whose ledger is honest, so each test only has to break one thing. */
const HEALTHY = {
  routes: ["/", "/shop/[shopSlug]/staffing", "/shop/[shopSlug]/orders/new"],
  specs: ["booking.spec.ts", "visual.spec.ts"],
  captures: ["landing"],
  ledger: {
    "//": "note",
    "/": { e2e: ["booking.spec.ts"], visual: ["landing"] },
    "/shop/[shopSlug]/orders/new": {
      e2e: [],
      visual: [],
      exempt: "no coverage yet — needs a spec",
    },
    "/shop/[shopSlug]/staffing": { e2e: [], visual: [], exempt: "no coverage yet — needs a spec" },
  },
};

async function audit(overrides = {}) {
  const root = await fixture({ ...HEALTHY, ...overrides });
  return auditLedger(await collectWorld(root));
}

function messages(result) {
  return result.violations.join("\n");
}

describe("routePatternFor", () => {
  it("turns a page file into the route a session would type", () => {
    expect(routePatternFor("src/app/page.tsx")).toBe("/");
    expect(routePatternFor("src/app/shop/[shopSlug]/staffing/page.tsx")).toBe(
      "/shop/[shopSlug]/staffing",
    );
    expect(routePatternFor("src/app/waivers/[token]/page.tsx")).toBe("/waivers/[token]");
  });

  it("drops the segments that organise files without addressing anything", () => {
    // Route groups and parallel slots are folder bookkeeping, not URL.
    expect(routePatternFor("src/app/(marketing)/pricing/page.tsx")).toBe("/pricing");
    expect(routePatternFor("src/app/shop/@modal/[shopSlug]/page.tsx")).toBe("/shop/[shopSlug]");
  });
});

describe("parseCaptureNames", () => {
  it("reads the names e2e/visual.spec.ts actually shoots", () => {
    const source = `
      await capture(page, "schedule", scheme);
      await capture(page, 'trip-manage', scheme);
    `;
    expect([...parseCaptureNames(source)].sort()).toEqual(["schedule", "trip-manage"]);
  });

  it("ignores the helper's own definition and anything shot off another page object", () => {
    const source = `
      async function capture(page: Page, name: string, scheme: "light" | "dark") {}
      await capture(visitorPage, "not-a-baseline", scheme);
    `;
    expect(parseCaptureNames(source).has("not-a-baseline")).toBe(false);
    expect(parseCaptureNames(source).size).toBe(0);
  });

  it("reads print-only captures too", () => {
    expect([...parseCaptureNames('await capturePrint(page, "trip-packet");')]).toEqual([
      "trip-packet",
    ]);
  });
});

describe("auditLedger", () => {
  it("passes a ledger that matches the tree", async () => {
    const result = await audit();
    expect(result.violations).toEqual([]);
    expect(result.stats).toMatchObject({ total: 3, e2e: 1, visual: 1, exempt: 2 });
  });

  // The failure the whole check exists for: a page ships and nothing anywhere
  // says whether a test ever opens it.
  it("fails a route no spec reaches and no entry speaks for", async () => {
    const result = await audit({
      routes: [...HEALTHY.routes, "/shop/[shopSlug]/dive-sites/catalog"],
    });
    expect(messages(result)).toContain(
      "/shop/[shopSlug]/dive-sites/catalog: no e2e spec and no visual capture",
    );
    expect(result.stats.uncovered).toBe(1);
  });

  it("fails on a stale entry for a route that no longer exists", async () => {
    const result = await audit({
      ledger: { ...HEALTHY.ledger, "/gone": { e2e: ["booking.spec.ts"], visual: [] } },
    });
    expect(messages(result)).toContain("/gone: listed in");
    expect(messages(result)).toContain("no `src/app/gone/page.tsx` exists");
  });

  it("fails when a named spec file does not exist", async () => {
    const result = await audit({
      ledger: { ...HEALTHY.ledger, "/": { e2e: ["nope.spec.ts"], visual: ["landing"] } },
    });
    expect(messages(result)).toContain('names e2e spec "nope.spec.ts"');
    expect(messages(result)).toContain("does not exist under e2e/");
  });

  it("fails when a named visual capture is not shot by e2e/visual.spec.ts", async () => {
    const result = await audit({
      ledger: { ...HEALTHY.ledger, "/": { e2e: ["booking.spec.ts"], visual: ["ghost-surface"] } },
    });
    expect(messages(result)).toContain('names visual capture "ghost-surface"');
  });

  /**
   * Issue #1056. The axe share used to be counted off the `e2e` list — the
   * routes whose specs happened to include `a11y.spec.ts` — which is a list
   * maintained to say which specs *navigate* a route, not which ones scan it.
   * It read 22% while the spec was in fact scanning better than forty routes.
   * The column makes the two facts separable.
   */
  it("accepts an a11y column and holds its spec names to the same rule", async () => {
    const healthy = await audit({
      ledger: {
        ...HEALTHY.ledger,
        "/": { e2e: ["booking.spec.ts"], visual: ["landing"], a11y: ["booking.spec.ts"] },
      },
    });
    expect(healthy.violations).toEqual([]);

    const ghost = await audit({
      ledger: {
        ...HEALTHY.ledger,
        "/": { e2e: ["booking.spec.ts"], visual: ["landing"], a11y: ["nope.spec.ts"] },
      },
    });
    expect(messages(ghost)).toContain('names a11y spec "nope.spec.ts"');
  });

  it("never makes a missing scan a violation — that half is a human decision", async () => {
    // Every route in the healthy ledger carries no `a11y` at all, and the
    // audit passes. Turning coverage into a ratchet is a call about how much
    // the product pays per route, and it is not an agent's to impose.
    const result = await audit();
    expect(result.violations).toEqual([]);
    expect(result.stats.a11y).toBe(0);
  });

  it("fails an uncovered route that carries no exempt reason", async () => {
    const result = await audit({
      ledger: { ...HEALTHY.ledger, "/shop/[shopSlug]/staffing": { e2e: [], visual: [] } },
    });
    expect(messages(result)).toContain("/shop/[shopSlug]/staffing: no e2e spec and no visual");
    expect(result.stats.uncovered).toBe(1);
  });

  // An exemption is a reason, not a checkbox: a blank one asserts nothing.
  it("refuses an empty exempt reason", async () => {
    const result = await audit({
      ledger: {
        ...HEALTHY.ledger,
        "/shop/[shopSlug]/staffing": { e2e: [], visual: [], exempt: "   " },
      },
    });
    expect(messages(result)).toContain('"exempt" must be a non-empty reason string');
  });

  // The gap closed but the exemption stayed — the ledger would keep claiming a
  // hole that isn't there, and the next reader would trust it.
  it("fails a route that gained coverage but kept its exemption", async () => {
    const result = await audit({
      ledger: {
        ...HEALTHY.ledger,
        "/shop/[shopSlug]/staffing": {
          e2e: ["booking.spec.ts"],
          visual: ["staffing"],
          exempt: "no coverage yet — needs a spec",
        },
      },
    });
    expect(messages(result)).toContain("covered now, but still carries an `exempt`");
  });

  /**
   * **A spec is not coverage on its own.** This used to pass: the check
   * accepted *either* dimension, so a route could arrive with a spec, no
   * capture and no exemption, and the report line read as a summary rather
   * than a shortfall. Three real routes were in that state, including the
   * add-diver form and the first screen a new hire ever sees (issue #727).
   */
  it("fails a route with a spec, no capture and nothing written down", async () => {
    const result = await audit({
      ledger: {
        ...HEALTHY.ledger,
        "/shop/[shopSlug]/staffing": { e2e: ["booking.spec.ts"], visual: [] },
      },
    });
    expect(messages(result)).toContain("no visual capture");
  });

  it("names the missing half rather than reporting a bare gap", async () => {
    const result = await audit({
      ledger: {
        ...HEALTHY.ledger,
        "/shop/[shopSlug]/staffing": { e2e: [], visual: ["staffing"] },
      },
    });
    // The other direction, said in its own words — "no e2e spec and no visual
    // capture" about a route that has one of them sends a reader looking for
    // the wrong thing.
    expect(messages(result)).toContain("no e2e spec");
    expect(messages(result)).not.toContain("no e2e spec and no visual capture");
  });

  it("accepts a half-covered route that says why in writing", async () => {
    // The exemption is what turns a gap into a decision, which is the whole
    // reason the field exists.
    const result = await audit({
      ledger: {
        ...HEALTHY.ledger,
        "/shop/[shopSlug]/staffing": {
          e2e: ["booking.spec.ts"],
          visual: [],
          exempt: "a redirect with nothing of its own to photograph",
        },
      },
    });
    expect(result.violations).toEqual([]);
    // The healthy fixture already carries one exempt route; this is the second.
    expect(result.stats.exempt).toBe(2);
  });

  it("reports a malformed entry instead of crashing on it", async () => {
    const result = await audit({
      ledger: { ...HEALTHY.ledger, "/shop/[shopSlug]/staffing": "covered, promise" },
    });
    expect(messages(result)).toContain("entry must be an object");
  });

  it("reads a missing ledger as no exceptions, holding every route to the tree", async () => {
    const root = await fixture({ ...HEALTHY, ledger: undefined });
    const result = auditLedger(await collectWorld(root));
    expect(messages(result)).toContain("/: no e2e spec and no visual capture");
    expect(result.stats.uncovered).toBe(3);
  });

  it("does not read the file's leading `//` note as a route", () => {
    expect(Object.keys(ledgerEntries({ "//": "note", "/": { e2e: [], visual: [] } }))).toEqual([
      "/",
    ]);
  });
});

describe("planLedgerWrite (the ratchet)", () => {
  async function plan(overrides = {}) {
    const root = await fixture({ ...HEALTHY, ...overrides });
    return planLedgerWrite(await collectWorld(root));
  }

  // The one rule that keeps the ledger from becoming a rubber stamp: --write
  // stubs a new route with nothing, so the check goes red until a human either
  // writes a test or types the reason none is needed.
  it("never invents an exemption for a newly discovered uncovered route", async () => {
    const result = await plan({
      routes: [...HEALTHY.routes, "/shop/[shopSlug]/dive-sites/catalog"],
    });
    expect(result.next).not.toHaveProperty("/shop/[shopSlug]/dive-sites/catalog");
    // And the ledger it would write is itself a failing one — the gap is loud.
    const after = auditLedger({
      routes: [...HEALTHY.routes, "/shop/[shopSlug]/dive-sites/catalog"],
      ledger: result.next,
      specs: new Set(HEALTHY.specs),
      captures: new Set(HEALTHY.captures),
      specSources: new Map(),
    });
    expect(messages(after)).toContain("no e2e spec and no visual capture");
  });

  it("refuses to write when it would drop a spec a route claims", async () => {
    const result = await plan({ specs: ["visual.spec.ts"] });
    expect(result.drops).toEqual(['/: e2e "booking.spec.ts" no longer exists under e2e/']);
  });

  it("refuses to write when it would drop a capture a route claims", async () => {
    const result = await plan({ captures: [] });
    expect(result.drops).toEqual(['/: visual capture "landing" is no longer shot']);
  });

  it("keeps a hand-written exemption exactly as typed", async () => {
    const result = await plan();
    expect(result.next["/shop/[shopSlug]/staffing"].exempt).toBe("no coverage yet — needs a spec");
    expect(result.drops).toEqual([]);
  });

  // The ratchet's one permitted improvement: a gap that closed gets banked, so
  // the exemption cannot linger as a stale claim.
  //
  // **Closed means both halves**, which is what this asserted wrongly until
  // issue #1362. It used to hand the route one spec and no capture and expect
  // the exemption gone — the writer banked on `||` where `auditLedger` banks on
  // `&&`, so `--write` produced a ledger its own audit then failed. The case
  // below it holds that line.
  it("banks a closed gap by removing the exemption the route outgrew", async () => {
    const result = await plan({
      ledger: {
        ...HEALTHY.ledger,
        "/shop/[shopSlug]/staffing": {
          e2e: ["booking.spec.ts"],
          visual: ["landing"],
          exempt: "no coverage yet — needs a spec",
        },
      },
    });
    expect(result.next["/shop/[shopSlug]/staffing"]).toEqual({
      e2e: ["booking.spec.ts"],
      visual: ["landing"],
    });
    expect(result.bankedExemptions).toEqual(["/shop/[shopSlug]/staffing"]);
  });

  /**
   * **A route exempt from half the bar keeps the paragraph that says why**
   * (issue #1362).
   *
   * Exactly one route in the real ledger is in this state, and it is the one
   * whose reason is hardest to reconstruct: `/shop/[shopSlug]/settings/security`
   * has a real e2e spec and an argued case for holding no visual baseline (
   * better-auth stamps `updated_at` from its own clock, the row prints the
   * Chromium user-agent, the row count depends on how often the run signed in).
   * `--write` deleted that paragraph and then the audit failed the route for the
   * capture it was exempt from — a session that ran `--write` saw a failure
   * somewhere else entirely with no reason to connect the two.
   */
  it("keeps the exemption of a route covered on only one of the two axes", async () => {
    const overrides = {
      ledger: {
        ...HEALTHY.ledger,
        "/shop/[shopSlug]/staffing": {
          e2e: ["booking.spec.ts"],
          visual: [],
          exempt: "no capture: the session list cannot hold a baseline still",
        },
      },
    };
    const result = await plan(overrides);
    expect(result.next["/shop/[shopSlug]/staffing"].exempt).toBe(
      "no capture: the session list cannot hold a baseline still",
    );
    expect(result.bankedExemptions).toEqual([]);
  });

  /**
   * **The invariant under both cases above**, and the one that would have caught
   * this without anybody thinking of the half-covered route: a ledger `--write`
   * produces from a clean ledger must itself be clean. The old writer turned
   * zero violations into one.
   */
  it("writes a ledger its own audit still passes", async () => {
    const root = await fixture({
      ...HEALTHY,
      ledger: {
        ...HEALTHY.ledger,
        "/shop/[shopSlug]/staffing": {
          e2e: ["booking.spec.ts"],
          visual: [],
          exempt: "no capture: the session list cannot hold a baseline still",
        },
      },
    });
    const world = await collectWorld(root);
    expect(auditLedger(world).violations).toEqual([]);
    const { next } = planLedgerWrite(world);
    expect(auditLedger({ ...world, ledger: next }).violations).toEqual([]);
  });

  /**
   * The column the writer forgot entirely. Every `a11y` list — 56 of them in the
   * real ledger — was dropped by any `--write`, and `scripts/agent-health.mjs`
   * reads that column specifically because it is the one number nothing else
   * states.
   */
  it("carries the a11y column through, and refuses to drop a scan that vanished", async () => {
    const scanned = {
      ledger: {
        ...HEALTHY.ledger,
        "/": { e2e: ["booking.spec.ts"], visual: ["landing"], a11y: ["a11y.spec.ts"] },
      },
    };

    const kept = await plan({ ...scanned, specs: [...HEALTHY.specs, "a11y.spec.ts"] });
    expect(kept.next["/"].a11y).toEqual(["a11y.spec.ts"]);
    expect(kept.drops).toEqual([]);

    // And it survives the trip through the serializer, which had the same
    // omission one layer down: its field list was e2e/visual/exempt.
    expect(ledgerEntries(JSON.parse(serializeLedger(kept.next)))["/"].a11y).toEqual([
      "a11y.spec.ts",
    ]);

    // A scan that genuinely vanished is a coverage drop like any other, so
    // `--write` refuses rather than quietly shortening the list.
    const gone = await plan(scanned);
    expect(gone.drops).toEqual(['/: a11y spec "a11y.spec.ts" no longer exists under e2e/']);
  });

  it("drops the entry for a route that was deleted", async () => {
    const result = await plan({ routes: ["/"] });
    expect(Object.keys(result.next)).toEqual(["/"]);
    expect(result.removedRoutes.sort()).toEqual([
      "/shop/[shopSlug]/orders/new",
      "/shop/[shopSlug]/staffing",
    ]);
  });

  it("round-trips through the serializer with the note restored on top", async () => {
    const result = await plan();
    const written = JSON.parse(serializeLedger(result.next));
    expect(Object.keys(written)[0]).toBe("//");
    expect(ledgerEntries(written)).toEqual(result.next);
  });
});

describe("summaryLine", () => {
  it("states coverage and exemptions in the same breath, so neither hides", () => {
    expect(summaryLine({ total: 57, e2e: 54, visual: 48, exempt: 3, uncovered: 0 })).toBe(
      "route-coverage: 57 routes — 54 with an e2e spec, 48 with a visual capture, 3 exempt with a stated reason",
    );
  });
});

describe("derived coverage", () => {
  const ROUTES = [
    "/",
    "/s/[shopSlug]",
    "/s/[shopSlug]/trips/[id]",
    "/shop/[shopSlug]/gear/[id]",
    "/shop/[shopSlug]/gear/rentals",
    "/shop/[shopSlug]/trips/[id]/print",
  ];

  it("reads quoted paths, interpolations and constant-prefixed templates", () => {
    const source = [
      'await page.goto("/s/blue-mantis");',
      "const tripPath = `/shop/blue-mantis/trips/${trip.id}`;",
      "await page.goto(`${tripPath}/print?copy=1`);",
      'expect(page).toHaveURL("/");',
      'const note = "not/a/path";',
    ].join("\n");
    expect(pathLiterals(source).map((literal) => literal.path)).toEqual([
      "/s/blue-mantis",
      "/shop/blue-mantis/trips/*",
      "/shop/blue-mantis/trips/*/print",
      "/",
    ]);
  });

  it("resolves a path to the best-fitting route only, never a dynamic sibling as well", () => {
    expect(routesForPath(ROUTES, "/shop/blue-mantis/gear/rentals")).toEqual([
      "/shop/[shopSlug]/gear/rentals",
    ]);
    expect(routesForPath(ROUTES, "/shop/blue-mantis/gear/*")).toEqual([
      "/shop/[shopSlug]/gear/[id]",
    ]);
    expect(routesForPath(ROUTES, "/s/blue-mantis/trips/*")).toEqual(["/s/[shopSlug]/trips/[id]"]);
    expect(routesForPath(ROUTES, "/nowhere")).toEqual([]);
  });

  it("credits a capture to the last path reached in the same test, and no earlier one", () => {
    const derived = deriveCoverage({
      routes: ROUTES,
      specSources: new Map([
        [
          "visual.spec.ts",
          [
            'test("storefront", async ({ page }) => {',
            '  await page.goto("/s/blue-mantis");',
            '  await capture(page, "storefront");',
            "});",
            'test("reached by clicks", async ({ page }) => {',
            '  await page.getByRole("link").click();',
            '  await capture(page, "clicked-through");',
            "});",
          ].join("\n"),
        ],
      ]),
    });
    expect([...derived.get("/s/[shopSlug]").visual]).toEqual(["storefront"]);
    expect([...derived.get("/").visual]).toEqual([]);
  });

  it("counts an axe scan only from a spec that runs one", () => {
    const derived = deriveCoverage({
      routes: ROUTES,
      specSources: new Map([
        ["a11y.spec.ts", 'await page.goto("/");\nawait expectNoA11yViolations(page);'],
        ["booking.spec.ts", 'await page.goto("/s/blue-mantis");'],
      ]),
    });
    expect([...derived.get("/").a11y]).toEqual(["a11y.spec.ts"]);
    expect([...derived.get("/s/[shopSlug]").e2e]).toEqual(["booking.spec.ts"]);
    expect([...derived.get("/s/[shopSlug]").a11y]).toEqual([]);
  });

  it("passes a route the tree covers with no ledger entry at all", async () => {
    const root = await fixture({
      routes: ["/s/[shopSlug]"],
      specs: ["booking.spec.ts", "visual.spec.ts"],
      sources: { "booking.spec.ts": 'await page.goto("/s/blue-mantis");' },
      visual:
        'test("s", async ({ page }) => {\n  await page.goto("/s/blue-mantis");\n  await capture(page, "storefront");\n});\n',
      ledger: { "//": "note" },
    });
    const world = await collectWorld(root);
    expect(auditLedger(world).violations).toEqual([]);
    expect(effectiveLedger(world)["/s/[shopSlug]"]).toEqual({
      e2e: ["booking.spec.ts", "visual.spec.ts"],
      visual: ["storefront"],
    });
  });

  it("prunes a hand-written column the tree now covers, and keeps the gaps", async () => {
    const root = await fixture({
      routes: ["/s/[shopSlug]"],
      specs: ["booking.spec.ts", "visual.spec.ts"],
      captures: ["storefront"],
      sources: { "booking.spec.ts": 'await page.goto("/s/blue-mantis");' },
      ledger: {
        "//": "note",
        "/s/[shopSlug]": { e2e: ["booking.spec.ts"], visual: ["storefront"] },
      },
    });
    const result = planLedgerWrite(await collectWorld(root));
    // The spec is a literal visit now; the capture is still reached some other way.
    expect(result.next).toEqual({ "/s/[shopSlug]": { visual: ["storefront"] } });
    expect(result.derivedNames).toEqual(['/s/[shopSlug]: e2e "booking.spec.ts"']);
  });
});
