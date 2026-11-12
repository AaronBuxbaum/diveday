import { expect, signedInAsOwner, test } from "./fixtures";
import {
  bookASeatAndOpenThread,
  createTrip,
  daysFromNow,
  openTripAbout,
  openTripFromBoard,
  signInAsOwner,
  signOut,
  tripPathByTitle,
} from "./helpers";

signedInAsOwner();
const board = "/shop/blue-mantis/schedule/board";

for (const width of [390, 1280]) {
  test(`moves a diver between a day's departures at ${width}px`, async ({ page }) => {
    // Two departures, a public booking and a staff move cross real server boundaries.
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 844 });
    const date = daysFromNow(8);
    const from = `Day source ${width}`;
    const to = `Day target ${width}`;
    await createTrip(page, {
      title: from,
      date,
      departsAt: "08:00",
      returnsAt: "12:00",
      capacity: 8,
      price: 120,
    });
    await createTrip(page, {
      title: to,
      date,
      departsAt: "13:00",
      returnsAt: "17:00",
      capacity: 8,
      price: 120,
    });
    await page.goto(board);
    await openTripFromBoard(page, from);
    const tripId = page.url().match(/\/trips\/([^/?#]+)/)?.[1];
    if (!tripId) throw new Error("missing trip ID");
    await signOut(page);
    await page.goto(`/s/blue-mantis/trips/${tripId}`);
    await bookASeatAndOpenThread(page, `Day Diver ${width}`);
    await signInAsOwner(page);
    await page.goto(`${board}?view=day&day=${date}`);
    const source = page.locator("li").filter({ has: page.getByRole("heading", { name: from }) });
    const destination = page.locator("li").filter({ has: page.getByRole("heading", { name: to }) });
    await source.getByText(/Divers \(/).click();
    const diver = source.locator("li").filter({ hasText: `Day Diver ${width}` });
    await diver.locator("summary").click();
    await diver
      .getByLabel("Move to")
      .selectOption(
        (await diver
          .getByLabel("Move to")
          .locator("option", { hasText: to })
          .getAttribute("value")) ?? "",
      );
    await diver.getByRole("button", { name: "Cancel" }).click();
    await diver.locator("summary").click();
    await expect(diver.getByLabel("Move to")).toHaveValue("");
    await diver
      .getByLabel("Move to")
      .selectOption(
        (await diver
          .getByLabel("Move to")
          .locator("option", { hasText: to })
          .getAttribute("value")) ?? "",
      );
    await diver.getByRole("button", { name: "Move", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Moved");
    await destination.getByText(/Divers \(/).click();
    await expect(destination.getByText(`Day Diver ${width}`)).toBeVisible();
    await page.reload();
    await destination.getByText(/Divers \(/).click();
    await expect(destination.getByText(`Day Diver ${width}`)).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: from })).toBeVisible();
  });
}

for (const width of [390, 1280]) {
  test(`moves crew between the day's departures at ${width}px`, async ({ page }) => {
    // Two departures, a crew assignment and two moves cross real server boundaries.
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 844 });
    const day = daysFromNow(12);
    const from = `Crew source ${width}`;
    const to = `Crew target ${width}`;
    await createTrip(page, {
      title: from,
      date: day,
      departsAt: "08:00",
      returnsAt: "10:00",
      capacity: 8,
      price: 120,
    });
    await createTrip(page, {
      title: to,
      date: day,
      departsAt: "11:00",
      returnsAt: "13:00",
      capacity: 8,
      price: 120,
    });
    await page.goto(await tripPathByTitle(page, "blue-mantis", from));
    await openTripAbout(page);
    await expect(page.getByLabel("Assign crew")).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Assign crew").selectOption({ label: "Marcus Webb" });
    await expect(page.getByRole("button", { name: "Unassign Marcus Webb" })).toBeVisible();
    await page.goto(`${board}?view=day&day=${day}`);
    const source = page.locator("li").filter({ has: page.getByRole("heading", { name: from }) });
    const target = page.locator("li").filter({ has: page.getByRole("heading", { name: to }) });
    await source.getByText(/Crew \(/).click();
    await source.getByLabel("Move Marcus Webb").click();
    const picker = source.getByLabel("Move to");
    await picker.selectOption(
      (await picker.locator("option", { hasText: to }).getAttribute("value")) ?? "",
    );
    await source.getByRole("button", { name: "Move", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Moved");
    await target.getByText(/Crew \(/).click();
    await expect(target.getByText("Marcus Webb")).toBeVisible();
    await target.getByLabel("Move Marcus Webb").click();
    const back = target.getByLabel("Move to");
    await back.selectOption(
      (await back.locator("option", { hasText: from }).getAttribute("value")) ?? "",
    );
    await target.getByRole("button", { name: "Move", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Moved");
    await source.getByText(/Crew \(/).click();
    await expect(source.getByText("Marcus Webb")).toBeVisible();
  });
}
