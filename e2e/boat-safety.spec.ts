import type { Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";
import { daysFromNow, tripPathByTitle } from "./helpers";

const REEF = "Two-Tank Reef — Molasses & French";
const BOAT = "Mantis I";
/** The demo's departure on the other hull, Mantis II. */
const WRECK = "Wreck Trip — Spiegel Grove";

/** The fleet row whose name box holds this boat. */
function boatRow(page: Page, name: string) {
  return page.locator("form").filter({ has: page.locator(`input[name="name"][value="${name}"]`) });
}

/**
 * **The boat as a machine with papers and an emergency kit** (roadmap N-08,
 * N-10). The owner records the reef boat's certificate and an insurance date
 * that has already passed, hangs an AED aboard it with pads twelve days from
 * expiry, and the departure that sails today on that boat says all three
 * things above its boat check. The insurance, being expired, is an owner row
 * on the shop home.
 *
 * On a private shop: a boat's papers are shop settings, and this flow writes
 * them through Settings. No `signedInAsOwner()` for it: the fixture signs the
 * page in as the minted shop's own owner, and a blue-mantis session in the
 * same context would race it for the cookie.
 */
test("a boat's papers and the kit aboard it reach the departure that sails on it", async ({
  page,
  privateShop,
}) => {
  // The mint and the live sign-in the fixture pays for are inside this test's
  // own budget, and the flow is four legs; the same aggregate budget as
  // backup.spec.ts's private-shop tests.
  test.setTimeout(60_000);
  const shop = `/shop/${privateShop.slug}`;

  // 1. Settings, Boats: the certificate and a lapsed insurance date.
  await page.goto(`${shop}/settings/boats`);
  const row = boatRow(page, BOAT);
  await row.getByLabel("Passenger limit on the boat’s certificate").fill("10");
  await row.getByLabel("Insurance expires").fill(daysFromNow(-3));
  await row.getByRole("button", { name: "Save boat" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Boat updated." })).toBeVisible();
  await expect(boatRow(page, BOAT).getByText("Insurance expired 3 days ago")).toBeVisible();
  await expect(
    boatRow(page, BOAT).getByText(/seats on sale; the certificate allows 10\./),
  ).toBeVisible();

  // 2. The gear register: an AED, aboard the boat, with its pads' date.
  await page.goto(`${shop}/gear`);
  const panel = page.locator("details:has(> summary#add-unit)");
  await expect(panel).toHaveAttribute("data-hydrated", "true");
  await page.locator("summary#add-unit").click();
  await page.getByLabel("Kind", { exact: true }).selectOption({ label: "AED" });
  await page.getByLabel("Tag").fill("AED e2e");
  await page.getByRole("button", { name: "Add to the register" }).click();
  await expect(page.getByRole("status").filter({ hasText: "On the register." })).toBeVisible();
  await page.getByRole("link", { name: "AED e2e" }).click();

  await page.getByText("Edit details").click();
  await page.getByLabel("Aboard").selectOption({ label: BOAT });
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await expect(page.getByText(`Aboard ${BOAT}`)).toBeVisible();

  await page.getByText("Log a service").click();
  await page.getByLabel("What was done").selectOption({ label: "Pads" });
  await page.getByLabel("Next due").fill(daysFromNow(12));
  await page.getByRole("button", { name: "Log it" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Logged." })).toBeVisible();

  // 3. Today's reef departure on that boat says all of it, above the boat
  //    check — and on the printed sheet too.
  const reefManifest = `${await tripPathByTitle(page, privateShop.slug, REEF)}/manifest`;
  await page.goto(reefManifest);
  const section = page.getByRole("region", { name: `${BOAT}: papers and safety kit` });
  await expect(section).toBeVisible();
  await expect(
    section.getByText(/people booked; the boat’s certificate allows 10\./),
  ).toBeVisible();
  await expect(section.getByText("Insurance expired 3 days ago")).toBeVisible();
  await expect(section.getByText("AED e2e: pads expire in 12 days")).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(section.getByText("AED e2e: pads expire in 12 days")).toBeVisible();
  await page.emulateMedia({ media: "screen" });

  // 4. On the shop home: the lapsed insurance is the owner's errand, and the
  //    pads coming due on a boat sailing today are a row on that departure,
  //    pointing at its Boat tab.
  await page.goto(shop);
  await expect(page.getByText("Insurance expired 3 days ago").first()).toBeVisible();
  await expect(page.getByText("AED e2e: pads expire in 12 days").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Open boat check" }).first()).toHaveAttribute(
    "href",
    reefManifest,
  );

  // 5. The other hull speaks for itself: the shop keeps an AED now, Mantis II
  //    has none aboard, and none of Mantis I's papers or kit are its lines.
  await page.goto(`${await tripPathByTitle(page, privateShop.slug, WRECK)}/manifest`);
  const other = page.getByRole("region", { name: "Mantis II: papers and safety kit" });
  await expect(other.getByText("No AED aboard")).toBeVisible();
  await expect(other.getByText(/Insurance|AED e2e/)).toHaveCount(0);
});

/**
 * The trouble state the visual capture uses: the reef boat's kit lapsing,
 * addressed by id, says what it seeded — so a capture of the panel is never a
 * capture of nothing.
 */
test.describe("a seeded lapse on the demo's reef boat", () => {
  signedInAsOwner();

  test("names the missing oxygen, the expired flares and the AED pads coming due", async ({
    page,
    request,
  }) => {
    const seeded = await request.post("/api/test/seed-trouble-states?boatSafety=1");
    expect(seeded.ok()).toBe(true);
    const { boatSafety } = (await seeded.json()) as { boatSafety?: { tripId: string } };
    if (!boatSafety) throw new Error("seed-trouble-states found no reef departure on a boat");

    await page.goto(`/shop/blue-mantis/trips/${boatSafety.tripId}/manifest`);
    const section = page.getByRole("region", { name: `${BOAT}: papers and safety kit` });
    await expect(section.getByText("No emergency oxygen aboard")).toBeVisible();
    await expect(section.getByText("Flares (Mantis): expired 3 days ago")).toBeVisible();
    await expect(section.getByText("AED (Mantis): pads expire in 12 days")).toBeVisible();
    await expect(section.getByText(/the boat’s certificate allows/)).toBeVisible();
  });
});
