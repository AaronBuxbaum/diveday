import type { Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";
import { findTripOnBoard, openDiverFileGroup, openTripTab, rosterRow } from "./helpers";

signedInAsOwner();

const SHOP = "blue-mantis";
/** A seeded diver on this departure whose SSI card is still pending (`seed-divers.ts`). */
const SEEDED_DIVER = "Tyler Brooks";
const DEPARTURE = /Two-Tank Reef — French Reef/;

type Mode = "match" | "several" | "signed_out";

/**
 * **"Check with PADI", on PADI's DiveChek** (layer 2 of the cert-check
 * extension's second round).
 *
 * DiveChek sits behind the shop's own PADI Pro sign-in, which CI does not
 * have, and its page is a best guess until #2259's real-page test. So, as in
 * `agency-check.spec.ts`, this stands in for the extension at the one seam the
 * app sees: the marker on `<html>` and the `postMessage` request and reply.
 * For PADI it answers with a DiveChek-shaped excerpt, or with the fixed
 * `signed_out` reason the real extension gives when PADI shows its sign-in
 * page. Any other agency finds nobody, so nothing else is written. The
 * verdict, the write and the Undo are the real ones.
 */
async function installFakeExtension(page: Page, mode: Mode) {
  await page.addInitScript((answer) => {
    const announce = () => {
      document.documentElement.setAttribute("data-diveday-cert-check", "1.2.0");
      window.dispatchEvent(new Event("diveday-cert-check-ready"));
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", announce);
    } else {
      announce();
    }
    const counted = window as unknown as { __padiLookups: number };
    counted.__padiLookups = 0;
    window.addEventListener("message", (event) => {
      const data = event.data;
      if (data?.source !== "diveday-page" || data.type !== "agency-check") return;
      const reply = (result: Record<string, unknown>) =>
        window.postMessage(
          {
            source: "diveday-cert-check",
            type: "agency-check-result",
            requestId: data.requestId,
            ...result,
          },
          window.location.origin,
        );
      if (data.query.agency !== "padi") {
        reply({ ok: true, pageText: "No results found" });
        return;
      }
      counted.__padiLookups += 1;
      if (answer === "signed_out") {
        reply({ ok: false, reason: "signed_out" });
        return;
      }
      const name = `${data.query.firstName} ${data.query.lastName}`;
      const [year, month, day] = String(data.query.birthDate).split("-");
      const born = `${month}/${day}/${year}`;
      const record = [name, `Date of Birth: ${born}`, "Open Water Diver 06/15/2015 1506AB1234"];
      const namesake = [name, "Date of Birth: 09/03/1987", "Open Water Diver 02/02/2020"];
      reply({
        ok: true,
        pageText: ["DiveChek", ...record, ...(answer === "several" ? namesake : [])].join("\n"),
      });
    });
  }, mode);
}

function padiLookups(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __padiLookups: number }).__padiLookups);
}

/**
 * A new diver with a birth date on file and a pending PADI Open Water card,
 * made on the diver pages; the page is on their record after. DiveChek is
 * searched by name and birth date, so the date is what makes the card
 * checkable.
 */
async function diverWithPendingPadiCard(page: Page) {
  const stamp = Date.now();
  const name = `Padi ${stamp} Checker`;
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
  await form.locator('select[name="agency"]').selectOption("padi");
  await form.locator('select[name="card"]').selectOption("level:open_water");
  await form.getByLabel("Certification number").fill(`1506AB${String(stamp).slice(-4)}`);
  await form.getByRole("button", { name: "Capture for review", exact: true }).click();
  const cards = await openDiverFileGroup(page, "Certification records");
  await expect(cards.getByRole("button", { name: "Check with PADI" })).toBeVisible();
  return { name, cards };
}

test("DiveChek showing the diver, born that day, at that level certifies the PADI card, with Undo", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await installFakeExtension(page, "match");
  const { cards } = await diverWithPendingPadiCard(page);

  await cards.getByRole("button", { name: "Check with PADI" }).click();

  const toast = page
    .getByRole("status")
    .filter({ hasText: "PADI shows this certification. Marked certified." });
  await expect(toast).toBeVisible();
  await expect(cards.getByText(/^Checked with PADI by /)).toBeVisible();
  expect(await padiLookups(page)).toBe(1);

  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(cards.getByRole("button", { name: "Check with PADI" })).toBeVisible();
});

test("signed out of PADI, the check says to sign in first and writes nothing", async ({ page }) => {
  test.setTimeout(60_000);
  await installFakeExtension(page, "signed_out");
  const { cards } = await diverWithPendingPadiCard(page);

  await cards.getByRole("button", { name: "Check with PADI" }).click();

  await expect(cards.getByText("Sign in to PADI first, then check again.")).toBeVisible();
  await expect(cards.getByText("Couldn’t read PADI’s page.")).toHaveCount(0);
  await expect(cards.getByRole("link", { name: "Check with PADI (member sign-in)" })).toBeVisible();
  await expect(cards.getByRole("button", { name: "Check with PADI" })).toBeEnabled();
  await expect(page.getByText("PADI shows this certification. Marked certified.")).toHaveCount(0);
});

test("a DiveChek page listing several divers by this name certifies nothing", async ({ page }) => {
  test.setTimeout(60_000);
  await installFakeExtension(page, "several");
  const { cards } = await diverWithPendingPadiCard(page);

  await cards.getByRole("button", { name: "Check with PADI" }).click();

  await expect(cards.getByText("PADI lists more than one diver by this name.")).toBeVisible();
  await expect(page.getByText("PADI shows this certification. Marked certified.")).toHaveCount(0);
  await expect(cards.getByRole("button", { name: "Mark certified" })).toBeVisible();
});

test("Check all on a departure stops at the first PADI card when signed out of PADI", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await installFakeExtension(page, "signed_out");
  const { name } = await diverWithPendingPadiCard(page);
  const trip = await findTripOnBoard(page, SHOP, DEPARTURE);
  await trip.click();
  await openTripTab(page, "Trip");
  const addDiver = page.locator("#add-diver").filter({ visible: true });
  await addDiver.getByLabel("Find a returning diver").filter({ visible: true }).fill(name);
  await addDiver.getByLabel("Find a returning diver").filter({ visible: true }).press("Enter");
  await addDiver.getByRole("button", { name: `Add ${name} to the trip` }).click();
  await expect(
    rosterRow(page, name).getByRole("button", { name: "Check with PADI" }),
  ).toBeVisible();
  await expect(rosterRow(page, SEEDED_DIVER)).toBeVisible();

  await page.getByRole("button", { name: /^Check all \d+ cards with their agencies$/ }).click();

  await expect(
    page.getByText(`Stopped at ${name}: sign in to PADI first.`, { exact: false }),
  ).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/couldn’t read PADI’s page/)).toHaveCount(0);
  expect(await padiLookups(page)).toBe(1);
  await expect(
    rosterRow(page, name).getByText("Sign in to PADI first, then check again."),
  ).toBeVisible();
  await expect(
    rosterRow(page, name).getByRole("button", { name: "Check with PADI" }),
  ).toBeEnabled();
  await expect(page.getByText("PADI shows this certification. Marked certified.")).toHaveCount(0);
});
