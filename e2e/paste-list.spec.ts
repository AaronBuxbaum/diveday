import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import { addGuestForm, createTrip, daysFromNow, e2eNow, openTripFromBoard } from "./helpers";

signedInAsOwner();

const t = staffTranslator("en-US");

/**
 * **Paste a list onto one trip** ("Try it Saturday", item 1): a booking
 * tool's manifest, pasted on the departure's add band, previewed, then
 * everybody seated on a seat of their own. The boat takes three; the fourth
 * person is named as not added and the rest sail.
 */
test("pastes a trip's list, previews it, and seats who fits", async ({ page }) => {
  const title = `Pasted list ${e2eNow().getTime()}`;
  await createTrip(page, {
    title,
    date: daysFromNow(4),
    departsAt: "09:00",
    returnsAt: "12:00",
    capacity: 3,
  });
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, title);

  const band = await addGuestForm(page);
  await band.getByText(t("trips.pasteList.heading"), { exact: true }).click();
  const stamp = e2eNow().getTime();
  await band
    .getByLabel(t("trips.pasteList.listLabel"))
    .fill(
      [
        "Guest Name\tEmail\tPhone",
        `Paste Ana\tana-${stamp}@example.com\t`,
        "Paste Ben\t\t+1 305 555 0101",
        "Paste Carla\t\t",
        "Paste Dario\t\t",
        "4\t\t",
      ].join("\n"),
    );
  await band.getByRole("button", { name: t("trips.pasteList.read") }).click();

  const preview = band.getByTestId("paste-list-preview");
  await expect(preview.getByText("4 people to add")).toBeVisible();
  await expect(preview.getByText("1 row without a name left out")).toBeVisible();
  await expect(preview.getByTestId("paste-list-skipped")).toHaveText("4");
  await expect(preview.getByText(t("trips.pasteList.linksGo"))).toBeVisible();
  await expect(preview.getByText("Paste Dario")).toBeVisible();

  await preview.getByRole("button", { name: "Add 4 people" }).click();
  const result = band.getByTestId("paste-list-result");
  await expect(result.getByText("3 people added")).toBeVisible();
  await expect(result.getByText("1 not added")).toBeVisible();
  await expect(result.getByTestId("paste-list-refused")).toContainText("Paste Dario");
  await expect(result.getByTestId("paste-list-refused")).toContainText(
    t("trips.pasteList.refusal.full"),
  );

  // Done refreshes the guest list: the three are on it, each their own seat.
  await result.getByRole("button", { name: t("trips.pasteList.done") }).click();
  await expect(page.locator('[data-trip-phases] a[data-phase="filling"]')).toContainText("3 of 3");
});
