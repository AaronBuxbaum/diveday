import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openSettingsRow } from "./helpers";
import { E2E_FROZEN_CLOCK } from "./servers";

/**
 * **The reef's calendar** (issue #1485): a shop writes its own week, and a
 * diver reads it on the storefront while it is running.
 *
 * Every test here takes a **shop of its own**. `season_events` is one of the
 * tables `resetDemoSchedule` deliberately leaves standing — a season is shop
 * configuration, like a hull or a kind of day — so a season written into
 * blue-mantis would survive into whatever spec this worker runs next, including
 * the captures that photograph that shop's storefront (ADR
 * 20260815-per-test-private-shops).
 *
 * A minted shop arrives with the demo calendar already on it
 * (`src/db/seed-season-events.ts`), so every assertion below names the season
 * this test wrote rather than counting bands.
 *
 * The fleet's clock is frozen, so the dates are computed against that one
 * instant: the form, the server and the assertion all mean the same day.
 */
const frozenDay = (offsetDays: number) =>
  new Date(Date.parse(E2E_FROZEN_CLOCK) + offsetDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

/**
 * The Settings row itself. Scoped, because the vocabulary row above it carries
 * an "Add" button of its own and a bare role lookup would answer from whichever
 * one the DOM reached first — a closed `<details>` still has its children.
 */
function seasonRow(page: Page) {
  return page
    .locator("details")
    .filter({
      has: page.getByRole("heading", { level: 3, name: "Seasons and events", exact: true }),
    })
    .first();
}

function addForm(page: Page) {
  return seasonRow(page)
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "Add", exact: true }) });
}

async function fillSeason(
  page: Page,
  season: { name: string; note?: string; startsOn: string; endsOn: string },
) {
  await openSettingsRow(page, "Seasons and events");
  const form = addForm(page);
  await form.getByLabel("Name").fill(season.name);
  await form.getByLabel("First day").fill(season.startsOn);
  await form.getByLabel("Last day").fill(season.endsOn);
  if (season.note) await form.getByLabel("What you want divers to know").fill(season.note);
  await form.getByRole("button", { name: "Add", exact: true }).click();
}

test.describe("the shop's own year", () => {
  test("a season the shop writes reaches the storefront while it is running", async ({
    page,
    privateShop,
  }) => {
    // The live sign-in the fixture pays for comes out of this test's budget.
    test.setTimeout(60_000);
    await page.goto(`/shop/${privateShop.slug}/settings`);
    await expect(page.getByRole("heading", { level: 3, name: "Seasons and events" })).toBeVisible();

    await fillSeason(page, {
      name: "Grouper aggregation",
      note: "They stack up on the wreck for two weeks. Come early, stay off them.",
      startsOn: frozenDay(-1),
      endsOn: frozenDay(1),
    });
    await expect(page.getByText("Season added.")).toBeVisible();

    // The one badge in the inset marks the week that is on the storefront now.
    await openSettingsRow(page, "Seasons and events");
    await expect(seasonRow(page).getByText("Running now").first()).toBeVisible();

    // The diver's side, with no session at all — the storefront is anonymous.
    await page.context().clearCookies();
    await page.goto(`/s/${privateShop.slug}`);
    await expect(page.getByText("Grouper aggregation")).toBeVisible();
    // The shop's own sentence, verbatim: DiveDay writes the frame around these
    // words and nothing inside them.
    await expect(
      page.getByText("They stack up on the wreck for two weeks. Come early, stay off them."),
    ).toBeVisible();
  });

  test("a season that has not opened yet says nothing to a diver", async ({
    page,
    privateShop,
  }) => {
    test.setTimeout(60_000);
    await page.goto(`/shop/${privateShop.slug}/settings`);
    await expect(page.getByRole("heading", { level: 3, name: "Seasons and events" })).toBeVisible();

    await fillSeason(page, {
      name: "Lionfish derby",
      note: "One day, one boat, and a prize for the ugliest fish.",
      startsOn: frozenDay(20),
      endsOn: frozenDay(20),
    });
    await expect(page.getByText("Season added.")).toBeVisible();

    await page.context().clearCookies();
    await page.goto(`/s/${privateShop.slug}`);
    await expect(page.getByRole("heading", { level: 2, name: "Schedule" })).toBeVisible();
    await expect(page.getByText("Lionfish derby")).toHaveCount(0);
  });

  test("a window that ends before it starts is refused, and nothing is written", async ({
    page,
    privateShop,
  }) => {
    test.setTimeout(60_000);
    await page.goto(`/shop/${privateShop.slug}/settings`);
    await expect(page.getByRole("heading", { level: 3, name: "Seasons and events" })).toBeVisible();

    await fillSeason(page, {
      name: "Backwards week",
      startsOn: frozenDay(5),
      endsOn: frozenDay(2),
    });

    await openSettingsRow(page, "Seasons and events");
    await expect(
      page.getByText("Give the season a name and two days, ending on or after it starts."),
    ).toBeVisible();
    // The refusal is not cosmetic: nothing by that name reached the calendar.
    await expect(seasonRow(page).locator('input[value="Backwards week"]')).toHaveCount(0);
  });
});
