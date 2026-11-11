import { diverTranslator } from "../src/i18n/messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  bookASeatAndOpenThread,
  createTrip,
  daysFromNow,
  findTripOnBoard,
  openThreadStep,
  signInAsOwner,
  signOut,
} from "./helpers";

const diver = diverTranslator("en-US");
const note = "Please identify the boat clearly at the dock.";

for (const width of [1280, 390]) {
  test.describe(`day-of details at ${width}px`, () => {
    signedInAsOwner();
    test.use({ viewport: { width, height: 844 } });

    test("carries the diver's saved note to the staff file before departure", async ({ page }) => {
      // One test, three sessions: creates a trip, books and saves as a diver, then reads the file as staff.
      test.slow();
      const name = `Day Of Diver ${width}`;
      const title = `Day Of Departure ${width}`;
      await createTrip(page, {
        title,
        date: daysFromNow(1),
        departsAt: "11:00",
        returnsAt: "14:00",
        capacity: 6,
      });
      const tripLink = await findTripOnBoard(page, "blue-mantis", title);
      const tripPath = await tripLink.getAttribute("href");
      if (!tripPath) throw new Error("created trip has no staff link");
      const tripId = tripPath.split("/").at(-1);
      await signOut(page);
      await page.goto(`/s/blue-mantis/trips/${tripId}`);
      await bookASeatAndOpenThread(page, name, `day-of-${width}@example.com`);
      await openThreadStep(page, "dayof");
      await page.getByLabel(diver("rental.anythingElse")).fill(note);
      // Asking for orientation is independent of opting into a first-trip welcome.
      await expect(
        page.getByRole("checkbox", { name: diver("ready.welcomeShareLabel") }),
      ).not.toBeChecked();
      await page.getByRole("radio", { name: diver("ready.helpFirstTimer") }).check();
      await page.getByRole("button", { name: "Save day-of details" }).click();
      await expect(
        page.getByRole("status").filter({ hasText: diver("ready.dayOfSaved") }),
      ).toBeVisible();
      await page.reload();
      await openThreadStep(page, "dayof");
      await expect(page.getByLabel(diver("rental.anythingElse"))).toHaveValue(note);
      await expect(page.getByText(diver("ready.helpSent"), { exact: true })).toBeVisible();

      await signInAsOwner(page);
      await page.goto(tripPath);
      const personPath = await page.getByRole("link", { name, exact: true }).getAttribute("href");
      if (!personPath) throw new Error("booked diver has no staff record link");
      await page.goto(`${personPath}#gear`);
      await expect(page.getByText(note, { exact: true })).toBeVisible();
    });
  });
}
