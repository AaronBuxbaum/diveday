import type { Locator, Page } from "@playwright/test";
import type { RentalLookupFleet } from "../src/app/api/test/seed-trouble-states/rental-lookup-state";
import { gearItemKindLabel } from "../src/i18n/gear-labels";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";

const t = staffTranslator("en-US");

/**
 * Deterministic viewport jumps count scrolling, not human lookup time. Each
 * task starts at the grid's first row, uses 75% of the 844px viewport per
 * jump, and stops once the target tile is wholly visible. The bounded loop
 * is a workload measurement, not a retry for a failing assertion.
 */
async function scrollToCandidate(page: Page, grid: Locator, target: Locator) {
  const top = await grid.evaluate(
    (element) => element.getBoundingClientRect().top + window.scrollY,
  );
  await page.evaluate((y) => window.scrollTo({ top: y - 100, behavior: "instant" }), top);
  const startY = await page.evaluate(() => window.scrollY);
  let viewportScrollSteps = 0;
  for (; viewportScrollSteps < 60; viewportScrollSteps += 1) {
    const visible = await target.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= window.innerHeight - 100;
    });
    if (visible) break;
    await page.evaluate(() =>
      window.scrollBy({ top: Math.floor(window.innerHeight * 0.75), behavior: "instant" }),
    );
  }
  expect(viewportScrollSteps).toBeLessThan(60);
  const endY = await page.evaluate(() => window.scrollY);
  return { viewportScrollSteps, scrollDistancePx: endY - startY };
}

test.describe("counter rental lookup at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  signedInAsOwner();

  test("offers gas choices for the selected diver's confirmed card", async ({
    page,
    request,
  }, info) => {
    const seeded = await request.post("/api/test/seed-trouble-states?rentalLookup=1");
    expect(seeded.ok()).toBe(true);
    const { rentalLookup } = (await seeded.json()) as { rentalLookup: RentalLookupFleet };
    const chooseTank = async () => {
      const gear = page.getByRole("region", { name: t("counterRentals.new.gearHeading") });
      await gear.getByRole("button", { name: gearItemKindLabel(t, "tank"), exact: true }).click();
      await gear
        .getByRole("searchbox", { name: t("counterRentals.new.filterLabel") })
        .fill(rentalLookup.tankTarget);
      await gear
        .getByRole("button", { name: `${rentalLookup.tankTarget} · AL80`, exact: true })
        .click();
      return page.getByRole("combobox", {
        name: t("counterRentals.new.fillAria", { label: rentalLookup.tankTarget }),
      });
    };
    await page.goto(`/shop/blue-mantis/gear/rentals/new?personId=${rentalLookup.personId}`);
    const certifiedFill = await chooseTank();
    await expect(certifiedFill.locator('option[value="32"]')).toHaveCount(1);
    await page.goto("/shop/blue-mantis/gear/rentals/new?q=Lena");
    await page.getByRole("link", { name: "Rent to Lena Fischer" }).click();
    const unconfirmedFill = await chooseTank();
    await expect(unconfirmedFill.locator('option[value="32"]')).toHaveCount(0);
    await expect(unconfirmedFill.locator('option[value="21"]')).toHaveCount(1);
    await expect(page.getByText(t("counterRentals.new.fillUnavailable"))).toBeVisible();
    await unconfirmedFill.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("nitrox-picker-mobile.png") });
    await page.setViewportSize({ width: 1280, height: 720 });
    await unconfirmedFill.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("nitrox-picker-desktop.png") });
  });

  test("compares unfiltered and filtered lookup in the synthetic fleet", async ({
    page,
    request,
  }, info) => {
    const seeded = await request.post("/api/test/seed-trouble-states?rentalLookup=1");
    expect(seeded.ok()).toBe(true);
    const { rentalLookup } = (await seeded.json()) as { rentalLookup: RentalLookupFleet };
    expect(rentalLookup.personId).toBeTruthy();
    await page.goto(`/shop/blue-mantis/gear/rentals/new?personId=${rentalLookup.personId}`);
    const gear = page.getByRole("region", { name: t("counterRentals.new.gearHeading") });
    const kinds = gear.getByRole("group", { name: t("counterRentals.new.kindsAria") });
    const grid = gear.getByRole("list");
    const filter = gear.getByRole("searchbox", { name: t("counterRentals.new.filterLabel") });
    const tasks = [];

    await kinds.getByRole("button", { name: gearItemKindLabel(t, "tank"), exact: true }).click();
    await expect(grid.getByRole("button")).toHaveCount(100);
    const tank = grid.getByRole("button", {
      name: `${rentalLookup.tankTarget} · AL80`,
      exact: true,
    });
    const tankLabels = await grid.getByRole("button").allTextContents();
    const tankScroll = await scrollToCandidate(page, grid, tank);
    await filter.fill(rentalLookup.tankTarget);
    await expect(grid.getByRole("button")).toHaveCount(1);
    const filteredTankScroll = await scrollToCandidate(page, grid, tank);
    await tank.click();
    await expect(tank).toHaveAttribute("aria-pressed", "true");
    tasks.push({
      task: "exact tag",
      query: rentalLookup.tankTarget,
      unfiltered: {
        renderedCandidates: tankLabels.length,
        targetPosition:
          tankLabels.findIndex((label) => label.includes(rentalLookup.tankTarget)) + 1,
        kindClicks: 1,
        ...tankScroll,
      },
      filtered: {
        renderedCandidates: 1,
        targetPosition: 1,
        queryChanges: 1,
        unitClicks: 1,
        ...filteredTankScroll,
      },
    });
    await info.attach("exact-tag-390px", {
      body: await page.screenshot(),
      contentType: "image/png",
    });

    await kinds.getByRole("button", { name: gearItemKindLabel(t, "wetsuit"), exact: true }).click();
    await expect(filter).toHaveValue("");
    await expect(grid.getByRole("button")).toHaveCount(80);
    const suit = grid.getByRole("button", {
      name: `${rentalLookup.suitTarget} · ${rentalLookup.sizeTarget}`,
      exact: true,
    });
    const suitLabels = await grid.getByRole("button").allTextContents();
    const suitScroll = await scrollToCandidate(page, grid, suit);
    await filter.fill(rentalLookup.sizeTarget);
    await expect(grid.getByRole("button")).toHaveCount(10);
    const filteredSuitScroll = await scrollToCandidate(page, grid, suit);
    await suit.click();
    await expect(suit).toHaveAttribute("aria-pressed", "true");
    tasks.push({
      task: "first matching size",
      query: rentalLookup.sizeTarget,
      unfiltered: {
        renderedCandidates: suitLabels.length,
        matchingCandidates: suitLabels.filter((label) => label.includes(rentalLookup.sizeTarget))
          .length,
        targetPosition:
          suitLabels.findIndex((label) => label.includes(rentalLookup.sizeTarget)) + 1,
        kindClicks: 1,
        ...suitScroll,
      },
      filtered: {
        renderedCandidates: 10,
        targetPosition: 1,
        queryChanges: 1,
        unitClicks: 1,
        ...filteredSuitScroll,
      },
    });
    await info.attach("size-390px", { body: await page.screenshot(), contentType: "image/png" });
    await info.attach("lookup-comparison.json", {
      body: JSON.stringify(
        {
          viewport: { width: 390, height: 844 },
          scope:
            "Unfiltered and filtered current implementation; original browser baseline deferred",
          tasks,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
    const bill = page.getByRole("list", { name: t("counterRentals.new.pickedHeading") });
    await expect(bill).toContainText(rentalLookup.tankTarget);
    await expect(bill).toContainText(rentalLookup.suitTarget);
    await filter.fill("absent");
    await expect(gear.getByRole("status")).toHaveText(t("counterRentals.new.noMatches"));
    const removeTank = bill.getByRole("button", {
      name: t("counterRentals.new.removeAria", { label: rentalLookup.tankTarget }),
    });
    await expect(removeTank).toBeVisible();
    await removeTank.click();
    await expect(bill).not.toContainText(rentalLookup.tankTarget);
    const clear = gear.getByRole("button", { name: t("counterRentals.new.clearFilter") });
    await clear.focus();
    await clear.press("Enter");
    await expect(filter).toHaveValue("");
    await expect(filter).toBeFocused();
    await expect(grid.getByRole("button")).toHaveCount(80);
  });
});
