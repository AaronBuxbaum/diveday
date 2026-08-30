import { expect, signedInAsOwner, test } from "./fixtures";
import { daysFromNow, e2eNow, openTripAbout, openTripFromBoard } from "./helpers";

signedInAsOwner();

test("a repeating trip is scheduled on two weekdays, stopped, and cancelled as one", async ({
  page,
}) => {
  // A repeating trip is scheduled from the board's own add panel (ADR
  // 20260806-one-trip-create-form), so this walk pays a board render on the way
  // in and another on the way out — plus the trip-page navigations it already
  // had. Aggregate per-navigation cost across a long sequence, not a hang; same
  // reasoning as e2e/role-permissions.spec.ts.
  test.setTimeout(30_000);
  // Unique title so the assertions target this spec's own run.
  const title = `Series Test ${e2eNow().getTime()}`;
  // The clock is frozen at the harness boundary, so "four days out" is a fixed
  // weekday for every run — which is what lets the day chips be asserted by
  // name below.
  const startDate = daysFromNow(4);
  const startWeekday = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(`${startDate}T00:00:00Z`));

  await page.goto("/shop/blue-mantis/schedule/board?add=full");
  await page.getByLabel("What is it").fill(title);
  await page.getByLabel("Date").fill(startDate);
  await page.getByLabel("Departs").fill("08:00");
  await page.getByLabel("Returns").fill("11:00");
  await page.getByLabel("Seats").fill("6");
  await page.getByLabel("How often").selectOption("1");

  // The chosen date's own weekday is pre-checked, so the shop only adds the
  // second day it runs — "Monday and Thursday" is one repeating trip.
  const repeatsOn = page.getByRole("group", { name: "Repeats on" });
  await expect(repeatsOn.getByRole("checkbox", { name: startWeekday })).toBeChecked();
  const secondDay = startWeekday === "Wed" ? "Sat" : "Wed";
  // Click the chip, not the checkbox: the input inside it is visually hidden
  // (the chip *is* its label), so it has no clickable box of its own.
  await repeatsOn.getByText(secondDay, { exact: true }).click();
  await expect(repeatsOn.getByRole("checkbox", { name: secondDay })).toBeChecked();

  await page.getByRole("button", { name: "Put it on the board" }).click();
  await expect(page.getByRole("status")).toContainText(title);

  // Open the first instance and confirm the run reads as unlimited, on both days.
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, title);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  const tripUrl = page.url();
  await openTripAbout(page);
  const series = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Repeating trip" }) })
    .filter({ visible: true });
  await expect(series).toBeVisible();
  await expect(series).toContainText("keeps going");
  await expect(series).toContainText(startWeekday);
  await expect(series).toContainText(secondDay);

  // Widen the run from the trip page: a third day joins it, and nothing that is
  // already on the board is disturbed.
  // The cadence editor is a closed <details>; its fields are not reachable
  // until the summary is clicked.
  await series.getByText("Change the days it runs").click();
  const thirdDay = ["Mon", "Tue", "Thu"].find(
    (day) => day !== startWeekday && day !== secondDay,
  ) as string;
  await series.getByText(thirdDay, { exact: true }).click();
  await series.getByRole("button", { name: "Save the days" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  // Scoped to the panel: the page header carries the same sentence.
  await expect(series.getByText(new RegExp(`Repeats weekly on .*${thirdDay}`))).toBeVisible();

  // Narrowing it back is never a silent bulk cancellation: the dates that no
  // longer fit are listed, with head counts, and left on the board until asked.
  await page.goto(tripUrl);
  await openTripAbout(page);
  await series.getByText("Change the days it runs").click();
  await series.getByText(thirdDay, { exact: true }).click();
  await series.getByRole("button", { name: "Save the days" }).click();
  await expect(series).toContainText("no longer part of this run");
  await expect(series.getByRole("button", { name: /^Cancel those \d+ dates$/ })).toBeVisible();

  // Stopping the repeat keeps every date already on the board and closes the run.
  await page.goto(tripUrl);
  await openTripAbout(page);
  await series.getByRole("button", { name: "Stop repeating" }).click();
  await expect(page.getByRole("status")).toContainText("Stopped repeating");

  // Reload to clear the notice, then cancel every upcoming date at once.
  await page.goto(tripUrl);
  await openTripAbout(page);
  await page.getByRole("button", { name: "Cancel every upcoming date" }).click();
  await expect(page.getByText(/Cancelled every upcoming date in this series/)).toBeVisible();
});
