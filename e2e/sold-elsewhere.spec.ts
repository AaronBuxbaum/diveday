import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  addGuestForm,
  createTrip,
  daysFromNow,
  e2eNow,
  openNewGuestForm,
  openTripFromBoard,
} from "./helpers";

signedInAsOwner();

const t = staffTranslator("en-US");

/**
 * **A trip that sells elsewhere** ("Try it Saturday", items 4 and 5): a
 * departure put on the board three weeks out with no price lands the board on
 * its own week, and its Filling leads with who is ready, not with seats to
 * sell, with "Add a guest" the one primary beside the sentence. A party added from it lands on its waivers saying who the links
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
  // With nobody booked the sentence says how guests get here, beside the one primary.
  await expect(sentence).toContainText(t("trips.clock.filling.typeOrPaste"));
  const addGuest = sentence.getByRole("link", { name: t("trips.clock.addGuest"), exact: true });
  await expect(addGuest).toBeVisible();
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
  // One count, the one the bar draws: no "booked" line beside it, and the primary stays.
  await expect(sentence).not.toContainText(
    t("trips.clock.sentence.booked", { booked: 2, capacity: 6 }),
  );
  await expect(addGuest).toBeVisible();
  await expect(page.locator('[data-fix-group="booked"]')).toBeVisible();
  // Nico's waiver is open, but nothing could carry it: the list says so, not "sent".
  await expect(
    page.getByRole("button", { name: "Nico Nocontact" }).first(),
  ).toHaveAccessibleDescription(new RegExp(t("trips.fixList.reason.waiverNothingSent")));
  await expect(
    page.getByRole("button", { name: "Elsa Elsewhere" }).first(),
  ).toHaveAccessibleDescription(new RegExp(t("trips.fixList.reason.waiverPending")));
});

/**
 * **Try it Saturday, the whole path** (brief item 6): a shop keeps its booking
 * tool, puts one trip on the board with no price, pastes that tool's list onto
 * it, reads per person whether a link went out, and lands on a Filling that
 * counts who is ready. The nightly rehearsal runs this file
 * (`.github/workflows/simulate-day.yml`), so a break anywhere on the path turns
 * the night red. The demo shop holds every send, so each person reads "no link
 * sent"; which channel a live shop's link took is unit tested
 * (`seat-diver-texts.test.ts`, `PasteListPanel.test.tsx`).
 */
test("a list pasted onto an unpriced trip says what went out, then who is ready", async ({
  page,
}) => {
  test.slow(); // a board add, a read and a seat of three, and the trip page again, each a cold compile locally
  const title = `Pasted elsewhere ${e2eNow().getTime()}`;
  await createTrip(page, {
    title,
    date: daysFromNow(10),
    departsAt: "09:00",
    returnsAt: "12:00",
    capacity: 6,
  });
  await openTripFromBoard(page, title);
  const sentence = page.locator("[data-trip-sentence]");
  await expect(sentence).toContainText(t("trips.clock.sentence.noGuests"));

  const band = await addGuestForm(page);
  await band.getByText(t("trips.pasteList.heading"), { exact: true }).click();
  const stamp = e2eNow().getTime();
  await band
    .getByLabel(t("trips.pasteList.listLabel"))
    .fill(
      [`Pia Pasted,pia-${stamp}@example.com,`, "Omar Pasted,,+1 305 555 0102", "Lu Pasted,,"].join(
        "\n",
      ),
    );
  await band.getByRole("button", { name: t("trips.pasteList.read") }).click();
  const preview = band.getByTestId("paste-list-preview");
  await expect(preview.getByText(t("trips.pasteList.toAddOther", { count: 3 }))).toBeVisible();
  await preview.getByRole("button", { name: t("trips.pasteList.seatOther", { count: 3 }) }).click();

  const result = band.getByTestId("paste-list-result");
  await expect(result.getByText(t("trips.pasteList.addedOther", { count: 3 }))).toBeVisible();
  for (const name of ["Pia Pasted", "Omar Pasted", "Lu Pasted"]) {
    await expect(result.getByRole("listitem").filter({ hasText: name })).toContainText(
      t("trips.pasteList.nothingSent"),
    );
  }
  await expect(result.getByTestId("paste-list-refused")).toHaveCount(0);

  await result.getByRole("button", { name: t("trips.pasteList.done") }).click();
  await expect(sentence).toContainText(t("trips.clock.sentence.readyOf", { ready: 0, total: 3 }));
  await expect(page.getByRole("button", { name: "Lu Pasted" }).first()).toHaveAccessibleDescription(
    new RegExp(t("trips.fixList.reason.waiverNothingSent")),
  );
  await expect(
    page.getByRole("button", { name: "Pia Pasted" }).first(),
  ).toHaveAccessibleDescription(new RegExp(t("trips.fixList.reason.waiverPending")));
});
