import { expect, test } from "./fixtures";

/**
 * Issue #708 — recording which languages a staff member speaks, and the
 * public payoff: a shop's own "we speak …" line, shown where a diver
 * chooses a shop rather than only after booking.
 *
 * Recording a language is shop-wide staff configuration, the same shape
 * disabling an account is — not restored by the shared `demoReset` fixture
 * — so this takes a private shop of its own (ADR 20260815-per-test-private-shops).
 */
test("an owner records a captain's languages, and the public schedule says so", async ({
  page,
  privateShop,
}) => {
  test.setTimeout(30_000);

  await page.goto(`/shop/${privateShop.slug}/settings/team`);
  const captainCard = page.locator("li").filter({ hasText: "Sal Moretti" });
  // Each option is named in the *staffer's own reading language* here
  // ("German", "Japanese") — unlike the public badge below, which uses each
  // language's own endonym. A Spanish-reading staffer would see "alemán",
  // not "Deutsch"; this session reads English. The choices are intentionally
  // collapsed at rest so a long roster stays calm on narrow screens.
  await captainCard.locator("summary").filter({ hasText: "Languages this person speaks" }).click();
  await captainCard.getByLabel("German").check();
  await captainCard.getByLabel("Japanese").check();
  await captainCard.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Languages saved.")).toBeVisible();

  // The checkboxes stayed checked across the round trip — not just a
  // confirmation banner with nothing actually stored.
  await page.reload();
  const reloadedCard = page.locator("li").filter({ hasText: "Sal Moretti" });
  const reloadedLanguages = reloadedCard
    .locator("details")
    .filter({ hasText: "Languages this person speaks" });
  if ((await reloadedLanguages.getAttribute("open")) === null) {
    await reloadedLanguages.locator("summary").click();
  }
  await expect(reloadedCard.getByLabel("German")).toBeChecked();
  await expect(reloadedCard.getByLabel("Japanese")).toBeChecked();

  // Every language recorded by any active staff member, not only Sal's —
  // and named in each language's own endonym on the public page, which
  // renders in whatever locale the visitor negotiated. The join order isn't
  // semantically meaningful (it's a set), so this checks both names appear
  // rather than pinning a specific order.
  await page.goto(`/s/${privateShop.slug}`);
  const spokenLanguagesLine = page.getByText(/We speak/);
  await expect(spokenLanguagesLine).toBeVisible();
  await expect(spokenLanguagesLine).toContainText("Deutsch");
  await expect(spokenLanguagesLine).toContainText("日本語");

  // The same captain is assigned to the seeded reef charter. The public trip
  // page exposes the aggregate languages, never a crew roster or a promise
  // that a named guide will be aboard.
  await page.getByRole("link", { name: "Two-Tank Reef — Molasses & French" }).click();
  // "Deutsch, English and 日本語 aboard", inside the conditions line above the
  // form — the label moved into the phrase when the four conditions tiles
  // collapsed into one line (ADR 20260827-the-divers-thread, decision 2).
  const aboardLanguages = page.getByText(/aboard$/);
  await expect(aboardLanguages).toBeVisible();
  await expect(aboardLanguages).toContainText("Deutsch");
  await expect(aboardLanguages).toContainText("日本語");
});

/**
 * **The people, not a faceless crew label** (issue #1181, D21) — and the
 * boundary that makes it publishable.
 *
 * The demo's cast is seeded with two of its five crew having agreed to be
 * named and three not, so this page is the one place the *difference* is
 * visible end to end: a shop where some staff said yes is the shape a real
 * shop has, and somebody who declined has to be indistinguishable from
 * somebody who was never rostered.
 */
test("the public trip page names the crew who agreed, by first name only", async ({ page }) => {
  await page.goto("/s/blue-mantis");
  await page.getByRole("link", { name: "Two-Tank Reef — Molasses & French" }).first().click();

  const crew = page.getByRole("heading", { name: "Who you're diving with" });
  await expect(crew).toBeVisible();
  const list = crew.locator("xpath=..").getByRole("list");
  await expect(list).toContainText("Marcus");

  // **No surname, anywhere on the page.** It is not part of what anybody
  // consented to, and a "who you're diving with" line does not need one.
  await expect(page.getByText("Webb")).toHaveCount(0);
  // And nobody who did not agree: Talia speaks two languages and has not
  // switched this on, which is exactly the pairing the seed exists to prove —
  // filling in languages is not what publishes a name.
  await expect(page.getByText("Talia")).toHaveCount(0);
});

test("a shop with no recorded languages shows no line at all", async ({ page, privateShop }) => {
  await page.goto(`/s/${privateShop.slug}`);
  await expect(page.getByText(/We speak/)).toHaveCount(0);
  await page.getByRole("link", { name: "Two-Tank Reef — Molasses & French" }).click();
  await expect(page.getByText(/aboard$/)).toHaveCount(0);
  // A minted shop configures nothing, so nobody has agreed to be named either
  // — the seed deliberately leaves both blank on this path (issue #1181).
  await expect(page.getByRole("heading", { name: "Who you're diving with" })).toHaveCount(0);
});
