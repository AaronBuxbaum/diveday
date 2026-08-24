import { expect, test } from "./fixtures";
import { createTrip, daysFromNow, e2eNow, findTripOnBoard } from "./helpers";

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
  // not "Deutsch"; this session reads English.
  await captainCard.getByLabel("German").check();
  await captainCard.getByLabel("Japanese").check();
  await captainCard.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Languages saved.")).toBeVisible();

  // The checkboxes stayed checked across the round trip — not just a
  // confirmation banner with nothing actually stored.
  await page.reload();
  const reloadedCard = page.locator("li").filter({ hasText: "Sal Moretti" });
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
});

test("a shop with no recorded languages shows no line at all", async ({ page, privateShop }) => {
  await page.goto(`/s/${privateShop.slug}`);
  await expect(page.getByText(/We speak/)).toHaveCount(0);
});

/**
 * Issue #970 — the per-trip half #708 deliberately left out: which
 * languages *this sailing's* assigned crew can point to, not the shop-wide
 * set. A departure with no assigned crew, or an assigned crew with no
 * recorded language, says nothing rather than repeating the shop-wide line.
 */
test.describe("the per-trip languages line", () => {
  test("names the languages of the crew assigned to this sailing, not the whole shop's set", async ({
    page,
    privateShop,
  }) => {
    test.setTimeout(45_000);

    await page.goto(`/shop/${privateShop.slug}/settings/team`);
    const captainCard = page.locator("li").filter({ hasText: "Sal Moretti" });
    await captainCard.getByLabel("German").check();
    await captainCard.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Languages saved.")).toBeVisible();

    const title = `Language line charter ${e2eNow().getTime()}`;
    await createTrip(page, {
      title,
      date: daysFromNow(21),
      departsAt: "08:00",
      returnsAt: "12:00",
      shopSlug: privateShop.slug,
    });
    const link = await findTripOnBoard(page, privateShop.slug, title);
    const href = await link.getAttribute("href");
    if (!href) throw new Error(`no trip card found for ${title}`);
    await page.goto(href);
    await expect(page.getByLabel("Assign crew")).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Assign crew").selectOption({ label: "Sal Moretti" });
    await expect(page.getByRole("button", { name: "Unassign Sal Moretti" })).toBeVisible();

    const tripId = new URL(page.url()).pathname.split("/").pop();
    await page.goto(`/s/${privateShop.slug}/trips/${tripId}`);
    await expect(page.getByText(/Your crew speaks/)).toContainText("Deutsch");
  });

  test("says nothing when the trip's assigned crew has recorded no language", async ({
    page,
    privateShop,
  }) => {
    test.setTimeout(30_000);
    const title = `Silent language line charter ${e2eNow().getTime()}`;
    await createTrip(page, {
      title,
      date: daysFromNow(22),
      departsAt: "08:00",
      returnsAt: "12:00",
      shopSlug: privateShop.slug,
    });
    const link = await findTripOnBoard(page, privateShop.slug, title);
    const href = await link.getAttribute("href");
    if (!href) throw new Error(`no trip card found for ${title}`);
    await page.goto(href);
    await expect(page.getByLabel("Assign crew")).toHaveAttribute("data-hydrated", "true");
    // Sal has no recorded language in this test's own private shop — a fresh
    // mint, unaffected by the other test in this file.
    await page.getByLabel("Assign crew").selectOption({ label: "Sal Moretti" });
    await expect(page.getByRole("button", { name: "Unassign Sal Moretti" })).toBeVisible();

    const tripId = new URL(page.url()).pathname.split("/").pop();
    await page.goto(`/s/${privateShop.slug}/trips/${tripId}`);
    await expect(page.getByText(/Your crew speaks/)).toHaveCount(0);
  });
});
