import type { Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";
import { findTripOnBoard, openDiverFileGroup, openTripTab, rosterRow } from "./helpers";

const SHOP = "blue-mantis";
/** A seeded diver on this departure whose SSI card is still pending (`seed-divers.ts`). */
const SEEDED_DIVER = "Tyler Brooks";
const DEPARTURE = /Two-Tank Reef — French Reef/;

type Mode = "match" | "several" | "signed_out";
const PADI_CHECKS_OFF =
  "PADI checks are off for this shop. An owner or manager can turn them on in Settings, Features.";

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
 *
 * The checks are a per-shop switch, on for every new and seeded shop since
 * 2026-10-23 (H-121). The last test turns it off on a minted `privateShop`,
 * shows the link alone, and turns it back on in Settings.
 */
async function installFakeExtension(page: Page, mode: Mode) {
  await page.addInitScript((answer) => {
    const announce = () => {
      document.documentElement.setAttribute("data-diveday-cert-check", "1.5.0");
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
      // DiveChek's row carries the card's number, which the server needs when
      // the card has one; the test hands the fake the number it typed.
      const number = window.sessionStorage.getItem("padiCardNumber") ?? "1506AB1234";
      const record = [name, `Date of Birth: ${born}`, `Open Water Diver 06/15/2015 ${number}`];
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
async function diverWithPendingPadiCard(
  page: Page,
  { shop = SHOP, checks = true }: { shop?: string; checks?: boolean } = {},
) {
  const stamp = Date.now();
  const name = `Padi ${stamp} Checker`;
  await page.goto(`/shop/${shop}/divers`);
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
  const cardNumber = `1506AB${String(stamp).slice(-4)}`;
  await form.getByLabel("Certification number").fill(cardNumber);
  await page.evaluate(
    (number) => window.sessionStorage.setItem("padiCardNumber", number),
    cardNumber,
  );
  await form.getByRole("button", { name: "Capture for review", exact: true }).click();
  const cards = await openDiverFileGroup(page, "Certification records");
  if (checks) {
    await expect(cards.getByRole("button", { name: "Check with PADI" })).toBeVisible();
  } else {
    await expect(
      cards.getByRole("link", { name: "Check with PADI (member sign-in)" }),
    ).toBeVisible();
  }
  return { name, cards, record: page.url() };
}

test.describe("at the seeded demo, which runs the PADI checks", () => {
  signedInAsOwner();

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

  test("signed out of PADI, the check says to sign in first and writes nothing", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await installFakeExtension(page, "signed_out");
    const { cards } = await diverWithPendingPadiCard(page);

    await cards.getByRole("button", { name: "Check with PADI" }).click();

    await expect(
      cards.getByText("Sign in to the PADI Pros’ Site first, then check again."),
    ).toBeVisible();
    await expect(cards.getByText("Couldn’t read PADI’s page.")).toHaveCount(0);
    await expect(
      cards.getByRole("link", { name: "Check with PADI (member sign-in)" }),
    ).toBeVisible();
    await expect(cards.getByRole("button", { name: "Check with PADI" })).toBeEnabled();
    await expect(page.getByText("PADI shows this certification. Marked certified.")).toHaveCount(0);
  });

  test("a DiveChek page listing several divers by this name certifies nothing", async ({
    page,
  }) => {
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
      page.getByText(`Stopped at ${name}: sign in to the PADI Pros’ Site first.`, { exact: false }),
    ).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/couldn’t read PADI’s page/)).toHaveCount(0);
    expect(await padiLookups(page)).toBe(1);
    await expect(
      rosterRow(page, name).getByText("Sign in to the PADI Pros’ Site first, then check again."),
    ).toBeVisible();
    await expect(
      rosterRow(page, name).getByRole("button", { name: "Check with PADI" }),
    ).toBeEnabled();
    await expect(page.getByText("PADI shows this certification. Marked certified.")).toHaveCount(0);
  });
});

/**
 * No `signedInAsOwner()` here: the `privateShop` fixture signs the page in as
 * the minted shop's owner. A minted shop starts with the PADI checks on, so
 * the test turns them off first.
 */
test("a shop that has not turned PADI checks on keeps the link and offers no check, until Settings turns them on", async ({
  page,
  privateShop,
}) => {
  test.setTimeout(120_000);
  await installFakeExtension(page, "match");
  const features = `/shop/${privateShop.slug}/settings/features`;
  const row = page.locator("li#padiChecks");
  await page.goto(features);
  await expect(row.getByRole("checkbox")).toBeChecked();
  await row.getByRole("checkbox").uncheck();
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/notice=feature-saved/);
  await expect(row.getByRole("checkbox")).not.toBeChecked();

  const { name, cards, record } = await diverWithPendingPadiCard(page, {
    shop: privateShop.slug,
    checks: false,
  });
  await expect(cards.getByRole("button", { name: "Check with PADI" })).toHaveCount(0);
  // With the extension here, the record says why there is no button, and who can change it.
  await expect(cards.getByText(PADI_CHECKS_OFF)).toBeVisible();

  // The departure's Divers tab offers the SSI card beside it, never the PADI one.
  const trip = await findTripOnBoard(page, privateShop.slug, DEPARTURE);
  await trip.click();
  await openTripTab(page, "Trip");
  const addDiver = page.locator("#add-diver").filter({ visible: true });
  await addDiver.getByLabel("Find a returning diver").filter({ visible: true }).fill(name);
  await addDiver.getByLabel("Find a returning diver").filter({ visible: true }).press("Enter");
  await addDiver.getByRole("button", { name: `Add ${name} to the trip` }).click();
  await expect(rosterRow(page, name)).toBeVisible();
  await expect(
    rosterRow(page, SEEDED_DIVER).getByRole("button", { name: "Check with SSI" }),
  ).toBeVisible();
  await expect(rosterRow(page, name).getByRole("button", { name: "Check with PADI" })).toHaveCount(
    0,
  );
  // Check all counts the SSI card alone: one card, so no "Check all" (with
  // PADI's switch on, the seeded demo's test above presses "Check all 2").
  await expect(
    page.getByRole("button", { name: /^Check all \d+ cards with their agencies$/ }),
  ).toHaveCount(0);
  expect(await padiLookups(page)).toBe(0);

  // Settings > Features: the switch, off, and turned back on.
  await page.goto(features);
  await expect(row.getByRole("checkbox")).not.toBeChecked();
  await expect(
    row.getByText(/^Check a diver’s PADI card and eLearning in one click/),
  ).toBeVisible();
  await row.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/notice=feature-saved/);
  await expect(row.getByRole("checkbox")).toBeChecked();

  await page.goto(record);
  const after = await openDiverFileGroup(page, "Certification records");
  await expect(after.getByRole("button", { name: "Check with PADI" })).toBeVisible();
  await expect(after.getByText(PADI_CHECKS_OFF)).toHaveCount(0);
});
