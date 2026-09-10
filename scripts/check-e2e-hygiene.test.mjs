import { describe, expect, it } from "vitest";

import { ACKNOWLEDGEMENT, findHygieneViolations } from "./check-e2e-hygiene.mjs";

const ruleIds = (source) => findHygieneViolations(source).map((v) => v.rule);

describe("sleeps", () => {
  it("catches waitForTimeout on page and locator alike", () => {
    expect(ruleIds("await page.waitForTimeout(500);")).toEqual(["sleep"]);
    expect(ruleIds("await row.waitForTimeout( 1_000 )")).toEqual(["sleep"]);
  });

  it("never flags test.setTimeout — a per-test budget is policy, not a sleep", () => {
    expect(ruleIds("test.setTimeout(45_000);")).toEqual([]);
  });

  it("never flags a raw setTimeout inside an injected page function", () => {
    // visual.spec.ts legitimately schedules browser-side work this way.
    expect(ruleIds("new Promise((resolve) => setTimeout(resolve, remaining))")).toEqual([]);
  });
});

describe("networkidle", () => {
  it("catches the wait state in any quote style", () => {
    expect(ruleIds('await page.waitForLoadState("networkidle");')).toEqual(["networkidle"]);
    expect(ruleIds("await page.goto(url, { waitUntil: 'networkidle' })")).toEqual(["networkidle"]);
  });
});

describe("retries", () => {
  it("catches a spec-level retries override", () => {
    expect(ruleIds("test.describe.configure({ retries: 2 });")).toEqual(["retries"]);
  });

  it("never flags prose mentioning retries without configuring them", () => {
    // The real comment in visual.spec.ts: "the suite has no retries (playwright.config.ts)".
    expect(ruleIds("// and the suite has no retries (playwright.config.ts).")).toEqual([]);
  });

  it("never flags the timeout key beside it", () => {
    expect(ruleIds("test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });")).toEqual([]);
  });
});

describe("retry loops", () => {
  it("catches the attempt-counter loop shape that #411 removed", () => {
    expect(ruleIds("for (let attempt = 0; attempt < 3; attempt += 1) {")).toEqual(["retry-loop"]);
    expect(ruleIds("while (retryCount < MAX) {")).toEqual(["retry-loop"]);
    expect(ruleIds("while (retry < MAX) {")).toEqual(["retry-loop"]);
  });

  it("catches while-loops that declare an attempt counter inline", () => {
    expect(ruleIds("for (var tries = 0; tries < 5; tries++) {")).toEqual(["retry-loop"]);
  });

  it("never flags ordinary iteration", () => {
    expect(ruleIds("for (const row of rows) {")).toEqual([]);
    expect(ruleIds("for (let index = 0; index < count; index += 1) {")).toEqual([]);
  });
});

describe("acknowledgement marker", () => {
  it("passes a violation acknowledged on the same line", () => {
    expect(
      ruleIds(
        `await page.waitForTimeout(50); // ${ACKNOWLEDGEMENT} sleep: clock-freeze tick, deterministic by construction`,
      ),
    ).toEqual([]);
  });

  it("passes a violation acknowledged on the line above", () => {
    const source = [
      `// ${ACKNOWLEDGEMENT} sleep: service-worker registration has no DOM signal`,
      "await page.waitForTimeout(100);",
    ].join("\n");
    expect(ruleIds(source)).toEqual([]);
  });

  it("does not let one marker cover a later line", () => {
    const source = [
      `// ${ACKNOWLEDGEMENT} sleep: covered`,
      "await page.waitForTimeout(100);",
      "await page.waitForTimeout(200);",
    ].join("\n");
    expect(findHygieneViolations(source)).toHaveLength(1);
  });
});

describe("includeHidden", () => {
  it("catches the option the fixture silently discards", () => {
    expect(ruleIds('page.getByRole("link", { name: "Show later", includeHidden: true })')).toEqual([
      "include-hidden",
    ]);
    expect(ruleIds("  includeHidden : true,")).toEqual(["include-hidden"]);
  });

  it("never flags the raw locator that is the correct answer", () => {
    expect(ruleIds(`const later = page.locator("a[data-board-pager='next']");`)).toEqual([]);
  });
});

describe("empty .all()", () => {
  it("catches a loop over .all() with nothing proving the list is not empty", () => {
    const source = [
      'const chipLinks = chips.getByRole("link");',
      "for (const chip of await chipLinks.all()) {",
      "  expect((await chip.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);",
      "}",
    ].join("\n");
    expect(ruleIds(source)).toEqual(["empty-all"]);
  });

  it("stays quiet once a count assertion above it proves the list is not empty", () => {
    const source = [
      'const chipLinks = chips.getByRole("link");',
      "await expect(chipLinks).not.toHaveCount(0);",
      "for (const chip of await chipLinks.all()) {",
    ].join("\n");
    expect(ruleIds(source)).toEqual([]);
  });

  it("looks backwards only — a proof written after the loop has already let it run on nothing", () => {
    const source = [
      "for (const chip of await chipLinks.all()) {",
      "}",
      "await expect(chipLinks).not.toHaveCount(0);",
    ].join("\n");
    expect(ruleIds(source)).toEqual(["empty-all"]);
  });

  it("does not reach past its window", () => {
    const source = [
      "await expect(chipLinks).not.toHaveCount(0);",
      ...Array.from({ length: 8 }, (_, index) => `const filler${index} = index;`),
      "for (const chip of await chipLinks.all()) {",
    ].join("\n");
    expect(ruleIds(source)).toEqual(["empty-all"]);
  });

  it("takes the acknowledgement, like every other rule", () => {
    const source = [
      `// ${ACKNOWLEDGEMENT} empty-all: the panel renders no rows at all before a shop adds one, and acting on none is the case under test.`,
      "for (const row of await rows.all()) await row.click();",
    ].join("\n");
    expect(ruleIds(source)).toEqual([]);
  });

  it("never flags an awaited count, which is not a loop over nothing", () => {
    expect(ruleIds("const total = await rows.count();")).toEqual([]);
  });
});

describe("action races", () => {
  it("catches a navigation in the statement straight after a submit", () => {
    // The two that reached CI. The first closed the destination's stream early
    // and read as a server error; the second burned the visual shard's whole
    // 210-second budget and failed forty lines below, which is how a race like
    // this gets misread as slow CI.
    expect(
      ruleIds(
        [
          'await page.getByRole("button", { name: "Put it on the board" }).click();',
          "await page.goto(`/shop/${unique}`);",
        ].join("\n"),
      ),
    ).toEqual(["action-race"]);
    expect(
      ruleIds(
        [
          'await page.getByRole("button", { name: "Save details" }).click();',
          "await page.reload();",
        ].join("\n"),
      ),
    ).toEqual(["action-race"]);
  });

  it("catches the two the sweep found live, in the shape they were written", () => {
    expect(
      ruleIds(
        [
          'await deepCard.getByRole("button", { name: "Confirm certification" }).click();',
          "",
          'await page.goto("/shop/blue-mantis/schedule/board");',
        ].join("\n"),
      ),
    ).toEqual(["action-race"]);
    expect(
      ruleIds(
        [
          'await page.getByRole("button", { name: "Save changes" }).click();',
          "",
          "    // Back on the week, the warning is gone and the figure is on the entry.",
          "await page.goto(`${BOARD}?week=${addDay}`);",
        ].join("\n"),
      ),
    ).toEqual(["action-race"]);
  });

  it("reads a name in every form the suite writes one", () => {
    // A string, a template literal, and a regular expression with or without a
    // leading anchor. The regex forms were missed until a review caught them
    // (#1561), and `{ name: /Save changes/ }` is ordinary in this suite — a
    // label pattern that only understood quotes let the commonest alternative
    // through in silence.
    for (const name of [
      '"Save changes"',
      "'Save changes'",
      "`Save ${what}`",
      "/Save changes/",
      "/^Save changes/",
      "/^Confirm certification$/",
    ]) {
      expect(
        ruleIds(
          [
            `await page.getByRole("button", { name: ${name} }).click();`,
            'await page.goto("/shop/blue-mantis");',
          ].join("\n"),
        ),
        name,
      ).toEqual(["action-race"]);
    }
  });

  it("reads the whole click statement, however the formatter broke it", () => {
    // Bounded by the previous statement rather than a line count: how many
    // lines a chain occupies is a formatting accident, and a fixed window
    // silently stops catching anything longer.
    expect(
      ruleIds(
        [
          "const other = 1;",
          "await page",
          '  .getByRole("button", {',
          '    name: "Save changes",',
          "    exact: true,",
          "  })",
          "  .click();",
          'await page.goto("/shop/blue-mantis");',
        ].join("\n"),
      ),
    ).toEqual(["action-race"]);
  });

  it("does not borrow a label from the statement before the click", () => {
    // The lookback stops at a line ending in `;`. Without that it would read
    // the label off an unrelated earlier click and flag a navigation after a
    // perfectly ordinary one.
    expect(
      ruleIds(
        [
          'await page.getByRole("button", { name: "Save changes" }).click();',
          'await sidebar.getByRole("link", { name: "Next week" }).click();',
          'await page.goto("/shop/blue-mantis");',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("reads a click built over several lines", () => {
    expect(
      ruleIds(
        [
          "await page",
          '  .getByRole("button", { name: "Publish course" })',
          "  .click();",
          'await page.goto("/s/blue-mantis/courses");',
        ].join("\n"),
      ),
    ).toEqual(["action-race"]);
  });

  /**
   * The negatives carry more weight here than the positives. Nearly every spec
   * in this suite clicks, asserts, then navigates, and a rule that started
   * flagging *that* would be silenced everywhere within a week — which is the
   * failure mode issue #1438 names in its own body.
   */
  it("leaves the prevailing convention alone: an assertion between the two", () => {
    // Verbatim from e2e/dive-sites.spec.ts.
    expect(
      ruleIds(
        [
          'await page.getByRole("button", { name: "Save site" }).click();',
          'await expect(page.getByText("Molasses Reef")).toBeVisible();',
          'await page.goto("/shop/blue-mantis/dive-sites");',
        ].join("\n"),
      ),
    ).toEqual([]);
    expect(
      ruleIds(
        [
          'await page.getByRole("button", { name: "Save changes" }).click();',
          "await page.waitForURL(/[?&]notice=/);",
          "await page.goto(`${BOARD}?week=${addDay}`);",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("does not accept a field read back for what the test just typed", () => {
    // Verbatim from e2e/visual.spec.ts as it stood from 2026-09-05, where it
    // satisfied this rule for five days while waiting for nothing: the field
    // already holds NOTE when the assertion runs, so it passes on the first
    // poll whether or not the write landed (issue #1644).
    expect(
      ruleIds(
        [
          'test("a dive site\'s planning note renders true to the design", async ({ page }) => {',
          '  await page.getByLabel("What to remember about running this site").fill(NOTE);',
          '  await page.getByRole("button", { name: "Save dive site" }).click();',
          '  await expect(page.getByLabel("What to remember about running this site")).toHaveValue(NOTE);',
          "  await page.goto(`/shop/${privateShop.slug}/dive-sites`);",
          "});",
        ].join("\n"),
      ),
    ).toEqual(["action-race"]);
  });

  it("reads the whole assertion, however the formatter broke it", () => {
    expect(
      ruleIds(
        [
          'test("x", async ({ page }) => {',
          '  await page.getByLabel("Note").fill("The entry silted up");',
          '  await page.getByRole("button", { name: "Save dive site" }).click();',
          "  await expect(",
          '    page.getByLabel("Note"),',
          '  ).toHaveValue("The entry silted up");',
          '  await page.goto("/shop/blue-mantis/dive-sites");',
          "});",
        ].join("\n"),
      ),
    ).toEqual(["action-race"]);
  });

  it("keeps the round-trip assertion legal once a real wait stands in front of it", () => {
    // The fix shipped on #1618, and the shape this rule must not push people
    // away from: assert the saved value all you like, after waiting on the
    // action's own redirect.
    expect(
      ruleIds(
        [
          'test("x", async ({ page }) => {',
          '  await page.getByLabel("Note").fill(NOTE);',
          '  await page.getByRole("button", { name: "Save dive site" }).click();',
          "  await page.waitForURL(/[?&]notice=saved/);",
          '  await expect(page.getByLabel("Note")).toHaveValue(NOTE);',
          '  await page.goto("/shop/blue-mantis/dive-sites");',
          "});",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("only steps over an assertion whose value this test typed", () => {
    // A value the destination produced, not the test — an id the save minted,
    // a total the server computed — is a real wait and keeps counting.
    expect(
      ruleIds(
        [
          'test("x", async ({ page }) => {',
          '  await page.getByLabel("Note").fill("typed");',
          '  await page.getByRole("button", { name: "Save dive site" }).click();',
          '  await expect(page.getByLabel("Reference")).toHaveValue(mintedReference);',
          '  await page.goto("/shop/blue-mantis/dive-sites");',
          "});",
        ].join("\n"),
      ),
    ).toEqual([]);
    // And a subject that is not a form control is rendered by the page rather
    // than typed into it, whatever the matcher.
    expect(
      ruleIds(
        [
          'test("x", async ({ page }) => {',
          '  await page.getByLabel("Note").fill(NOTE);',
          '  await page.getByRole("button", { name: "Save dive site" }).click();',
          "  await expect(page.getByRole(\"row\", { name: 'Molasses Reef' })).toContainText(NOTE);",
          '  await page.goto("/shop/blue-mantis/dive-sites");',
          "});",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("reads a ticked box back the same way", () => {
    expect(
      ruleIds(
        [
          'test("x", async ({ page }) => {',
          '  await page.getByLabel("Nitrox available").check();',
          '  await page.getByRole("button", { name: "Save dive site" }).click();',
          '  await expect(page.getByLabel("Nitrox available")).toBeChecked();',
          '  await page.goto("/shop/blue-mantis/dive-sites");',
          "});",
        ].join("\n"),
      ),
    ).toEqual(["action-race"]);
  });

  it("cannot borrow a fill from a sibling test", () => {
    // "Earlier in the same body" is bounded by the enclosing test, so the
    // assertion below is asserting a value this test never typed.
    expect(
      ruleIds(
        [
          'test("one", async ({ page }) => {',
          '  await page.getByLabel("Note").fill(NOTE);',
          "});",
          'test("two", async ({ page }) => {',
          '  await page.getByRole("button", { name: "Save dive site" }).click();',
          '  await expect(page.getByLabel("Note")).toHaveValue(NOTE);',
          '  await page.goto("/shop/blue-mantis/dive-sites");',
          "});",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("leaves a click whose label is not a submit alone", () => {
    // Both live instances of this shape — `waiverLinkFromToast` opens by
    // awaiting the toast, so the navigation cannot outrun anything. Dropping
    // the label clause would take the sweep from 2 hits and 0 false positives
    // to 2 and 2.
    expect(
      ruleIds(
        [
          'await waiverGroup.getByRole("button", { name: "Copy link" }).click();',
          "await page.goto(await waiverLinkFromToast(page));",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("leaves a navigation with no click before it alone", () => {
    expect(
      ruleIds(["const title = uniqueTitle();", 'await page.goto("/shop/blue-mantis");'].join("\n")),
    ).toEqual([]);
  });

  it("is not fooled by a comment sitting between the click and the navigation", () => {
    // Prose does not make a race safe, so the lookback skips it — the same
    // trimmed test the scanner uses to ignore comment lines outright.
    expect(
      ruleIds(
        [
          'await page.getByRole("button", { name: "Confirm certification" }).click();',
          "// the board shows it straight away",
          'await page.goto("/shop/blue-mantis/schedule/board");',
        ].join("\n"),
      ),
    ).toEqual(["action-race"]);
  });

  it("takes the acknowledgement, like every other rule", () => {
    const source = [
      'await page.getByRole("button", { name: "Send" }).click();',
      `// ${ACKNOWLEDGEMENT} action-race: "Send" here is a client-only clipboard button with no server action behind it.`,
      "await page.goto(target);",
    ].join("\n");
    expect(ruleIds(source)).toEqual([]);
  });
});

describe("comment lines", () => {
  it("never flags prose about a banned pattern", () => {
    expect(ruleIds("// never reaches the `networkidle` state the scan waits for")).toEqual([]);
    expect(
      ruleIds(' * scan". Each scan costs ~3.5s here (the `networkidle` wait dominates)'),
    ).toEqual([]);
  });
});

describe("reporting", () => {
  it("reports rule id and 1-indexed line", () => {
    const source = ["const a = 1;", 'await page.waitForLoadState("networkidle");'].join("\n");
    expect(findHygieneViolations(source)).toEqual([
      { rule: "networkidle", line: 2, text: 'await page.waitForLoadState("networkidle");' },
    ]);
  });
});
