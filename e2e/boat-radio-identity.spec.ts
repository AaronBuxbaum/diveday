import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { tripPathByTitle } from "./helpers";

const REEF = "Two-Tank Reef — Molasses & French";
const BOAT = "Mantis I";

/** The fleet disclosure whose summary names this boat. */
function boatRow(page: Page, name: string) {
  return page.locator("details").filter({ has: page.getByRole("heading", { name, exact: true }) });
}

/**
 * **The departure's own boat on the emergency card** (fourth review, item 11).
 * The card read one free-text vessel line for the whole shop, so a departure
 * on Mantis I printed Mantis II's MMSI: the number the coastguard asks for
 * first, wrong on the sheet made for that call. Each hull now holds its call
 * sign and MMSI in Settings, Boats, and the card names the departure's own.
 *
 * On a private shop, because this writes a boat's settings; no
 * `signedInAsOwner()`, since the fixture signs in as the minted shop's owner.
 */
test("a boat's call sign, MMSI and working channel reach the emergency card of the departure on it", async ({
  page,
  privateShop,
}) => {
  test.setTimeout(45_000);
  const shop = `/shop/${privateShop.slug}`;

  // A mistyped MMSI is refused with its own sentence, never the name-and-
  // capacity one that sent the owner looking at the two fields that were fine.
  await page.goto(`${shop}/boats`);
  await boatRow(page, BOAT).locator("summary").click();
  await boatRow(page, BOAT).getByLabel("MMSI").fill("33801");
  await boatRow(page, BOAT).getByRole("button", { name: "Save boat" }).click();
  await expect(page.getByText("Check the call sign")).toBeVisible();
  await expect(boatRow(page, BOAT)).toHaveAttribute("open");

  // 16 is every boat's distress channel, never its working one (dock review S4).
  await boatRow(page, BOAT).getByLabel("Working channel").fill("16");
  await boatRow(page, BOAT).getByRole("button", { name: "Save boat" }).click();
  await expect(page.getByText("Channels 16 and 70")).toBeVisible();
  await expect(boatRow(page, BOAT)).toHaveAttribute("open");

  // Typed the way it is read over the radio; stored the way it is printed.
  await boatRow(page, BOAT).getByLabel("Call sign").fill("wdm 3301");
  await boatRow(page, BOAT).getByLabel("MMSI").fill("338 012 345");
  // The channel the boat works on (issue #2672), kept as the shop says it.
  await boatRow(page, BOAT).getByLabel("Working channel").fill(" 68 ");
  await boatRow(page, BOAT).getByRole("button", { name: "Save boat" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Boat updated" })).toBeVisible();
  await page.reload();
  await boatRow(page, BOAT).locator("summary").click();
  await expect(boatRow(page, BOAT).getByLabel("Call sign")).toHaveValue("WDM 3301");
  await expect(boatRow(page, BOAT).getByLabel("MMSI")).toHaveValue("338012345");
  await expect(boatRow(page, BOAT).getByLabel("Working channel")).toHaveValue("68");

  await page.goto(`${await tripPathByTitle(page, privateShop.slug, REEF)}/manifest`);
  await page
    .getByRole("button", { name: "Emergency numbers & response plan" })
    .filter({ visible: true })
    .click();
  const card = page.getByRole("region", { name: "In an emergency" });
  await expect(card.getByText(`Vessel: ${BOAT}`)).toBeVisible();
  await expect(card.getByText("Call sign: WDM 3301")).toBeVisible();
  await expect(card.getByText("MMSI: 338012345")).toBeVisible();
  await expect(card.getByText("Working channel (VHF): 68")).toBeVisible();
});
