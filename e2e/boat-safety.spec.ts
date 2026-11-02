import type { Page } from "@playwright/test";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import { daysFromNow, tripPathByTitle } from "./helpers";

const REEF = "Two-Tank Reef — Molasses & French";
const BOAT = "Mantis I";
/** The demo's departure on the other hull, Mantis II. */
const WRECK = "Wreck Trip — Spiegel Grove";

/** The fleet disclosure whose editor holds this boat's name. */
function boatRow(page: Page, name: string) {
  return page
    .locator("details")
    .filter({ has: page.locator(`input[name="name"][value="${name}"]`) });
}

test("a distress-channel refusal reopens the new boat editor", async ({ page, privateShop }) => {
  const t = staffTranslator("en-US");
  const shop = `/shop/${privateShop.slug}`;
  await page.goto(`${shop}/boats`);
  const add = page.locator("#boat-new");
  await add.locator("summary").click();
  await add.getByLabel(t("boats.nameLabel")).fill("Radio test");
  await add.getByLabel(t("boats.capacityLabel")).fill("10");
  await add.getByLabel(t("boats.descriptionLabel")).fill("Dock test boat");
  await add.getByLabel(t("boats.certifiedPassengersLabel")).fill("10");
  await add.getByLabel(t("boats.certifiedTotalPersonsLabel")).fill("12");
  const paperDates = [
    [t("boats.coiExpiresLabel"), daysFromNow(-1)],
    [t("boats.inspectionDueLabel"), daysFromNow(70)],
    [t("boats.registrationExpiresLabel"), daysFromNow(-2)],
    [t("boats.insuranceExpiresLabel"), daysFromNow(-3)],
  ] as const;
  for (const [label, day] of paperDates) await add.getByLabel(label).fill(day);
  const submit = add.getByRole("button", { name: t("boats.addBoat"), exact: true });
  for (const channel of ["16", "70"]) {
    await add.getByLabel(t("boats.workingChannelLabel")).fill(channel);
    // A repeat refusal has the same message, so wait for this submission's
    // answer before checking the retained values on the returned editor.
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === `${shop}/boats` &&
          response.headers()["x-action-redirect"]?.includes("notice=boat-channel-distress") ===
            true,
      ),
      submit.click(),
    ]);
    await expect(submit).toBeEnabled();
    await expect(add.getByRole("alert")).toHaveText(t("boats.boatChannelDistress"));
    await expect(add).toHaveAttribute("open");
    await expect(add.getByLabel(t("boats.workingChannelLabel"))).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(add.getByLabel(t("boats.nameLabel"))).toHaveValue("Radio test");
    await expect(add.getByLabel(t("boats.capacityLabel"))).toHaveValue("10");
    await expect(add.getByLabel(t("boats.descriptionLabel"))).toHaveValue("Dock test boat");
    await expect(add.getByLabel(t("boats.workingChannelLabel"))).toHaveValue(channel);
    for (const [label, day] of paperDates) await expect(add.getByLabel(label)).toHaveValue(day);
    await expect(boatRow(page, BOAT)).not.toHaveAttribute("open");
  }

  await add.getByLabel(t("boats.workingChannelLabel")).fill("68");
  await submit.click();
  await expect(page.getByRole("status").filter({ hasText: t("boats.boatCreated") })).toBeVisible();
  const created = boatRow(page, "Radio test");
  await expect(created).toHaveCount(1);
  await expect(created.locator("summary")).toContainText(t("boats.peopleAboard", { count: 10 }));
  await created.locator("summary").click();
  await expect(created.getByLabel(t("boats.workingChannelLabel"))).toHaveValue("68");
  for (const [label, day] of paperDates) await expect(created.getByLabel(label)).toHaveValue(day);

  if ((await add.getAttribute("open")) === null) await add.locator("summary").click();
  await expect(add.getByLabel(t("boats.nameLabel"))).toHaveValue("");
  await expect(add.getByLabel(t("boats.capacityLabel"))).toHaveValue("");
  await expect(add.getByLabel(t("boats.descriptionLabel"))).toHaveValue("");
  await expect(add.getByLabel(t("boats.workingChannelLabel"))).toHaveValue("");
  for (const [label] of paperDates) await expect(add.getByLabel(label)).toHaveValue("");
});

test("an MMSI refusal reopens the existing boat editor", async ({ page, privateShop }) => {
  const t = staffTranslator("en-US");
  const shop = `/shop/${privateShop.slug}`;
  await page.goto(`${shop}/boats`);
  const row = boatRow(page, BOAT);
  await row.locator("summary").click();
  await row.getByLabel(t("boats.mmsiLabel"), { exact: true }).fill("123");
  await row.getByRole("button", { name: t("boats.submit"), exact: true }).click();
  await expect(row.getByRole("alert")).toHaveText(t("boats.boatRadioInvalid"));
  await expect(row).toHaveAttribute("open");
  await expect(row.getByLabel(t("boats.mmsiLabel"), { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.locator("#boat-new")).not.toHaveAttribute("open");
});

/**
 * **The boat as a machine with papers and an emergency kit** (roadmap N-08,
 * N-10). The owner is refused a certificate under the seats on sale (H-20261009-certificate-caps-seats),
 * then records the reef boat's real certificate and an insurance date
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

  // 1. Settings, Boats. H-20261009-certificate-caps-seats: a certificate under the fourteen seats the
  //    boat sells is refused on the row, and nothing is saved…
  await page.goto(`${shop}/boats`);
  const row = boatRow(page, BOAT);
  await expect(row).not.toHaveAttribute("open");
  await row.locator("summary").click();
  await row.getByLabel("Passengers allowed on the certificate (not crew)").fill("10");
  await row.getByRole("button", { name: "Save boat" }).click();
  const refused = boatRow(page, BOAT).getByRole("alert");
  await expect(refused).toHaveText(
    /The departure on .+ sells more seats than the certificate’s 10\. Lower its capacity first\./,
  );
  await expect(
    boatRow(page, BOAT).getByLabel("Passengers allowed on the certificate (not crew)"),
  ).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("status").filter({ hasText: "Boat updated" })).toHaveCount(0);

  //    …and so are fewer seats under it while today's departure still sells
  //    fourteen on this hull.
  await boatRow(page, BOAT).getByLabel("Total occupants (passengers + crew)").fill("12");
  await boatRow(page, BOAT)
    .getByLabel("Passengers allowed on the certificate (not crew)")
    .fill("12");
  await boatRow(page, BOAT).getByRole("button", { name: "Save boat" }).click();
  await expect(boatRow(page, BOAT).getByRole("alert")).toHaveText(
    /sells? more seats than the certificate’s 12[.,]/,
  );

  //    The certificate the boat really carries, and a lapsed insurance date.
  await boatRow(page, BOAT)
    .getByLabel("Passengers allowed on the certificate (not crew)")
    .fill("14");
  await boatRow(page, BOAT).getByLabel("Insurance expires").fill(daysFromNow(-3));
  await boatRow(page, BOAT).getByRole("button", { name: "Save boat" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Boat updated" })).toBeVisible();
  await expect(boatRow(page, BOAT).getByText(/^Hull insurance ended /)).toBeVisible();
  await expect(boatRow(page, BOAT).getByRole("alert")).toHaveCount(0);

  // 2. The gear register: an AED, aboard the boat, with its pads' date.
  await page.goto(`${shop}/gear`);
  const addUnit = page.getByRole("button", { name: "Add a unit", exact: true });
  await expect(addUnit).toHaveAttribute("data-hydrated", "true");
  await addUnit.click();
  await page.getByLabel("Kind", { exact: true }).selectOption({ label: "AED" });
  await page.getByLabel("Tag").fill("AED e2e");
  await page.getByRole("button", { name: "Add to the register" }).click();
  await expect(page.getByRole("status").filter({ hasText: "On the register" })).toBeVisible();
  await page.getByRole("link", { name: "AED e2e" }).click();

  await page.getByText("Edit details").click();
  await page.getByLabel("Aboard").selectOption({ label: BOAT });
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await expect(page.getByText(`Aboard ${BOAT}`)).toBeVisible();

  await page.getByText("Log a service").click();
  await page.getByLabel("What was done").selectOption({ label: "Pads" });
  await page.getByLabel("Next due").fill(daysFromNow(12));
  await page.getByRole("button", { name: "Log it" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Logged" })).toBeVisible();

  // 3. Today's reef departure on that boat says all of it, above the boat
  //    check — and on the printed sheet too.
  const reefManifest = `${await tripPathByTitle(page, privateShop.slug, REEF)}/manifest`;
  await page.goto(reefManifest);
  const section = page.getByRole("region", { name: `${BOAT}: papers and safety kit` });
  await expect(section).toBeVisible();
  // A lapsed paper is danger ink, named by its date (H-20261015-lapsed-boat-papers-loud).
  await expect(section.getByText(/^Hull insurance ended /)).toHaveClass(/(^| )text-danger( |$)/);
  await expect(section.getByText("AED e2e: pads expire in 12 days")).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(section.getByText("AED e2e: pads expire in 12 days")).toBeVisible();
  await page.emulateMedia({ media: "screen" });

  // 4. On the shop home: the lapsed insurance is the owner's errand, and the
  //    pads coming due on a boat sailing today are a row on that departure,
  //    pointing at its Boat tab.
  await page.goto(shop);
  await expect(page.getByText(/^Hull insurance ended /).first()).toBeVisible();
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
