import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import { createTrip, daysFromNow, e2eNow, openNewGuestForm, openTripFromBoard } from "./helpers";

signedInAsOwner();

const t = staffTranslator("en-US");

/**
 * **A trip that sells elsewhere** ("Try it Saturday", items 4 and 5): a
 * departure put on the board three weeks out with no price lands the board on
 * its own week, and its Filling leads with who is ready, not with seats to
 * sell. A party added from it lands on its waivers saying who the links
 * reached (which channels, `partyReachedParam`, is unit tested: the demo shop
 * holds every send); a guest with no email and no phone is told apart from one
 * with an address.
 */
test("an unpriced trip leads with readiness, and the add says who the links reached", async ({
  page,
}) => {
  test.slow(); // a board add, a party add and two trip page loads, each a cold compile locally
  const title = `Sold elsewhere ${e2eNow().getTime()}`;
  const date = daysFromNow(17);
  await createTrip(page, { title, date, departsAt: "09:00", returnsAt: "12:00", capacity: 6 });
  // The board opened on the new departure's week, so it is in view.
  await expect(page).toHaveURL(new RegExp(`[?&]week=${date}`));
  await openTripFromBoard(page, title);

  const sentence = page.locator("[data-trip-sentence]");
  await expect(sentence).toContainText(t("trips.clock.sentence.noGuests"));
  await expect(
    page.getByRole("heading", { name: t("trips.clock.filling.addGuests"), exact: true }),
  ).toBeVisible();
  await expect(page.getByText(t("trips.clock.filling.bookingLink"), { exact: true })).toHaveCount(
    0,
  );

  await openNewGuestForm(page);
  const stamp = e2eNow().getTime();
  await page.getByLabel("Full name").first().fill("Elsa Elsewhere");
  await page.getByLabel("Email").first().fill(`elsa-${stamp}@example.com`);
  await page.getByRole("button", { name: "Add another person" }).click();
  await page
    .getByRole("group", { name: "Person 2" })
    .getByLabel("Full name")
    .fill("Nico Nocontact");
  await page.getByRole("button", { name: "Add to trip" }).click();

  await expect(page).toHaveURL(/\/party\/[0-9a-f-]{36}\/waivers\?reached=/);
  const nico = page.getByRole("listitem").filter({ hasText: "Nico Nocontact" });
  await expect(nico.getByText(t("trips.partyWaiverQueue.notSent"), { exact: true })).toBeVisible();
  await expect(nico.getByRole("button", { name: /Show waiver QR code for Nico/ })).toBeVisible();
  // The demo shop holds every send, so here no link went out to anyone, and the landing says so.
  await expect(
    page.getByText(t("trips.partyWaiverQueue.reachedNone"), { exact: true }),
  ).toBeVisible();

  await page.getByRole("link", { name: t("trips.partyWaiverQueue.back") }).click();
  await expect(sentence).toContainText(t("trips.clock.sentence.readyOf", { ready: 0, total: 2 }));
  // Nico's waiver is open, but nothing could carry it: the list says so, not "sent".
  await expect(
    page.getByRole("button", { name: "Nico Nocontact" }).first(),
  ).toHaveAccessibleDescription(new RegExp(t("trips.fixList.reason.waiverNothingSent")));
  await expect(
    page.getByRole("button", { name: "Elsa Elsewhere" }).first(),
  ).toHaveAccessibleDescription(new RegExp(t("trips.fixList.reason.waiverPending")));
});
