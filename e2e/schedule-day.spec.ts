import { expect, signedInAsOwner, test } from "./fixtures";
import {
  bookASeatAndOpenThread,
  createTrip,
  daysFromNow,
  openTripFromBoard,
  signInAsOwner,
  signOut,
} from "./helpers";

signedInAsOwner();
const board = "/shop/blue-mantis/schedule/board";

for (const width of [390, 1280]) {
  test(`shows the day's departures and roster at ${width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 844 });
    const date = daysFromNow(8);
    const first = `Day first ${width}`;
    const second = `Day second ${width}`;
    for (const [title, departsAt, returnsAt] of [
      [first, "08:00", "12:00"],
      [second, "13:00", "17:00"],
    ]) {
      await createTrip(page, { title, date, departsAt, returnsAt, capacity: 8, price: 120 });
    }
    await page.goto(board);
    await openTripFromBoard(page, first);
    const tripId = page.url().match(/\/trips\/([^/?#]+)/)?.[1];
    if (!tripId) throw new Error("missing trip ID");
    await signOut(page);
    await page.goto(`/s/blue-mantis/trips/${tripId}`);
    await bookASeatAndOpenThread(page, `Day Diver ${width}`);
    await signInAsOwner(page);
    await page.goto(`${board}?view=day&day=${date}`);
    const source = page.locator("li").filter({ has: page.getByRole("heading", { name: first }) });
    await expect(page.getByRole("heading", { name: second })).toBeVisible();
    await source.getByText(/Divers \(/).click();
    await expect(source.getByText(`Day Diver ${width}`)).toBeVisible();
    await expect(source.getByText("Move", { exact: true })).toHaveCount(0);
    await page.reload();
    await source.getByText(/Divers \(/).click();
    await expect(source.getByText(`Day Diver ${width}`)).toBeVisible();
    await page.getByRole("link", { name: "Week", exact: true }).click();
    await expect(page).toHaveURL(/schedule\/board\?week=/);
    await page.goBack();
    await expect(page.getByRole("heading", { name: first })).toBeVisible();
  });
}
