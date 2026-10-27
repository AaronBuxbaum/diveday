import type { Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";
import { findTripOnBoard, openDiverFileGroup, openTripTab, rosterRow } from "./helpers";

signedInAsOwner();

const SHOP = "blue-mantis";
/** A seeded diver on this departure whose SSI card is still pending (`seed-divers.ts`, index 34). */
const SEEDED_DIVER = "Tyler Brooks";
const DEPARTURE = /Two-Tank Reef — French Reef/;
const LEAD = "NAUI also shows these certifications. Add them? Each waits for Mark certified.";
const ADDED = "Added";

/**
 * **The other cards the agency's page lists, after a match** (layer 3 of ADR
 * 20261008-cert-check-extension).
 *
 * As in `agency-check.spec.ts` (the installed extension is
 * `agency-check-extension.spec.ts`'s), the agencies' pages are not ours to hit, so this stands in for it at the one
 * seam the app sees: the marker on `<html>` and the `postMessage` request and
 * reply. NAUI's page here names the diver, their birth date and their level, then
 * their nitrox and Deep cards. The verdict, the offer, the write and the
 * one-tap confirm are the real ones.
 */
async function installFakeExtension(page: Page) {
  await page.addInitScript(() => {
    const announce = () => {
      document.documentElement.setAttribute("data-diveday-cert-check", "1.6.0");
      window.dispatchEvent(new Event("diveday-cert-check-ready"));
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", announce);
    } else {
      announce();
    }
    window.addEventListener("message", (event) => {
      const data = event.data;
      if (data?.source !== "diveday-page" || data.type !== "agency-check") return;
      const name = `${data.query.firstName} ${data.query.lastName}`;
      window.postMessage(
        {
          source: "diveday-cert-check",
          type: "agency-check-result",
          requestId: data.requestId,
          ok: true,
          pageText: [
            "NAUI certification lookup",
            name,
            "Date of Birth: 04/12/1990",
            "Open Water Diver",
            "Enriched Air Nitrox Diver · Deep Diver",
          ].join("\n"),
        },
        window.location.origin,
      );
    });
  });
}

/** A diver with a birth date and pending NAUI card, captured on their record. */
async function newDiverWithPendingCard(page: Page, prefix: string) {
  const stamp = Date.now();
  const name = `${prefix} Listed${stamp}`;
  await page.goto(`/shop/${SHOP}/divers`);
  await page.getByRole("searchbox", { name: "Search divers" }).fill(name);
  await page.getByRole("button", { name: "Add diver", exact: true }).click();
  await expect(page).toHaveURL(/\/divers\/[0-9a-f-]+(\?edit=1)?$/);
  await page.getByLabel("Date of birth").fill("1990-04-12");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByRole("status")).toContainText("Diver details updated");
  const group = await openDiverFileGroup(page, "Certification records");
  await group.getByText("Add certification", { exact: true }).click();
  const form = page
    .locator("form", { has: page.getByRole("button", { name: "Capture for review", exact: true }) })
    .filter({ visible: true });
  await form.locator('select[name="agency"]').selectOption("naui");
  await form.locator('select[name="card"]').selectOption("level:open_water");
  await form.getByLabel("Certification number").fill(`NAUI-${stamp}`);
  await form.getByRole("button", { name: "Capture for review", exact: true }).click();
  const cards = await openDiverFileGroup(page, "Certification records");
  await expect(cards.getByRole("button", { name: "Check with NAUI" })).toBeVisible();
  return { name, cards };
}

test("a match offers the page's other cards, which land pending for a one-tap confirm", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await installFakeExtension(page);
  const { cards } = await newDiverWithPendingCard(page, "Ada");

  await cards.getByRole("button", { name: "Check with NAUI" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "NAUI shows this certification. Marked certified." }),
  ).toBeVisible();
  const offer = cards.getByRole("group", { name: LEAD });
  await expect(offer.getByRole("checkbox", { name: "Enriched Air Nitrox Diver" })).toBeChecked();
  await expect(offer.getByRole("checkbox", { name: "Deep Diver" })).toBeChecked();

  // Only the nitrox card: Deep stays off the record.
  await offer.getByRole("checkbox", { name: "Deep Diver" }).uncheck();
  await offer.getByRole("button", { name: "Add" }).click();
  await expect(cards.getByText(ADDED)).toBeVisible();

  const nitrox = cards.getByRole("listitem").filter({ hasText: "NAUI · Nitrox" });
  await expect(nitrox.getByText("Listed on NAUI’s page.")).toBeVisible();
  await expect(nitrox.getByText(/Enriched Air Nitrox Diver · Deep Diver$/)).toBeVisible();
  await expect(cards.getByRole("listitem").filter({ hasText: "NAUI · Deep" })).toHaveCount(0);

  // The staffer's one tap certifies it, and the agency's words stay, still
  // saying where they came from.
  await nitrox.getByRole("button", { name: "Mark certified" }).click();
  await expect(nitrox.getByRole("button", { name: "Mark certified" })).toHaveCount(0);
  await expect(nitrox.getByText("Listed on NAUI’s page.")).toBeVisible();
  await expect(nitrox.getByText(/Enriched Air Nitrox Diver · Deep Diver$/)).toBeVisible();
});

test("Check all leaves each diver's offer under their row once the run has finished", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await installFakeExtension(page);
  const { name: newcomer } = await newDiverWithPendingCard(page, "Rory");
  const { name: other } = await newDiverWithPendingCard(page, "Robin");
  const trip = await findTripOnBoard(page, SHOP, DEPARTURE);
  await trip.click();
  await openTripTab(page, "Trip");
  const addDiver = page.locator("#add-diver").filter({ visible: true });
  await addDiver.getByLabel("Find a returning diver").filter({ visible: true }).fill(newcomer);
  await addDiver.getByLabel("Find a returning diver").filter({ visible: true }).press("Enter");
  await addDiver.getByRole("button", { name: `Add ${newcomer} to the trip` }).click();
  await expect(rosterRow(page, newcomer)).toBeVisible();
  await addDiver.getByLabel("Find a returning diver").filter({ visible: true }).fill(other);
  await addDiver.getByLabel("Find a returning diver").filter({ visible: true }).press("Enter");
  await addDiver.getByRole("button", { name: `Add ${other} to the trip` }).click();
  await expect(rosterRow(page, other)).toBeVisible();
  await expect(rosterRow(page, SEEDED_DIVER)).toBeVisible();

  await page.getByRole("button", { name: "Check all 2 cards with their agencies" }).click();

  await expect(page.getByText("Checked 2. Certified: 2.")).toBeVisible({ timeout: 20_000 });
  for (const diver of [other, newcomer]) {
    await expect(rosterRow(page, diver).getByRole("group", { name: LEAD })).toBeVisible();
  }

  const offer = rosterRow(page, newcomer).getByRole("group", { name: LEAD });
  await offer.getByRole("button", { name: "Add" }).click();
  await expect(rosterRow(page, newcomer).getByText(ADDED)).toBeVisible();
  // The other diver's offer is theirs to take or leave.
  await expect(rosterRow(page, other).getByRole("group", { name: LEAD })).toBeVisible();
});
