import type { Page } from "@playwright/test";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  createTrip,
  daysFromNow,
  e2eNow,
  openIfClosed,
  openTripAbout,
  openTripAboutRow,
  openTripFromBoard,
  openTripMore,
} from "./helpers";

const staff = staffTranslator("en-US");

signedInAsOwner();

test("a repeating trip is scheduled on two weekdays, stopped, and canceled as one", async ({
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

  await page.goto("/shop/blue-mantis/schedule/board/new?add=full");
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
  // The About panel's "Repeats" row: its label and cadence sentence are the
  // summary, and its editor is the cadence form. There is no headed "Repeating
  // trip" card any more — the row is the heading.
  const series = page.locator("details#series");
  await expect(series).toBeVisible();
  await expect(series).toContainText("keeps going");
  await expect(series).toContainText(startWeekday);
  await expect(series).toContainText(secondDay);

  // Widen the run from the trip page: a third day joins it, and nothing that is
  // already on the board is disturbed.
  // The cadence editor is a closed <details>; its fields are not reachable
  // until the summary is clicked.
  await openIfClosed(series);
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
  await openIfClosed(series);
  await series.getByText(thirdDay, { exact: true }).click();
  await series.getByRole("button", { name: "Save the days" }).click();
  await expect(series).toContainText("no longer part of this run");
  await expect(series.getByRole("button", { name: /^Cancel those \d+ dates$/ })).toBeVisible();

  // Stopping the repeat keeps every date already on the board and closes the
  // run. It lives in the About panel's "More for this departure" list now,
  // with the other series-wide acts — and it is the one of the three that
  // needs no confirm, because the control opposite it puts the run back.
  const more = await openTripMore(page);
  await more.getByRole("button", { name: "Stop repeating" }).click();
  await expect(page.getByRole("status")).toContainText("Stopped repeating");

  // Cancel every upcoming date at once through its confirm on the same fresh
  // Details page; the stop action has returned its updated state there.
  const moreAgain = await openTripMore(page);
  await moreAgain.getByRole("button", { name: "Cancel every upcoming date" }).click();
  // The confirm says who it reaches before anybody taps it: every date goes
  // through the blow-out cascade, so booked divers are told and refunded.
  await expect(
    moreAgain.getByText(/and stops the repeat\. Nobody is booked on them\./),
  ).toBeVisible();
  await moreAgain.getByRole("button", { name: "Yes, cancel every upcoming date" }).click();
  await expect(page.getByText(/Canceled every upcoming date and stopped the repeat/)).toBeVisible();

  // Each date went through the cascade as a run that stopped, and its record
  // says so in the heading and in the browser tab, not in weather words (#2460).
  const tripId = new URL(tripUrl).pathname.split("/").pop();
  await page.goto(`/shop/blue-mantis/schedule/blowout/${tripId}`);
  const runEnded = staff("blowout.record.titleRunEnded");
  await expect(page.getByRole("heading", { level: 1, name: runEnded })).toBeVisible();
  await expect(page).toHaveTitle(`${runEnded} — DiveDay`);
});

test("an open-ended run says it keeps going on the board's last month", async ({ page }) => {
  // The public month rail ends where the series horizon ends, about four months
  // out. On that last month an open-ended run says it keeps going, with the
  // date request open beneath it (UX review 2026-10-11, item 11). One board
  // render to schedule the run, then one public render per month to reach the
  // end: its own test, so the walk above keeps its budget.
  test.setTimeout(30_000);
  const title = `Horizon Test ${e2eNow().getTime()}`;
  await page.goto("/shop/blue-mantis/schedule/board/new?add=full");
  await page.getByLabel("What is it").fill(title);
  await page.getByLabel("Date").fill(daysFromNow(5));
  await page.getByLabel("Departs").fill("08:00");
  await page.getByLabel("Returns").fill("11:00");
  await page.getByLabel("Seats").fill("6");
  await page.getByLabel("How often").selectOption("1");
  await page.getByRole("button", { name: "Put it on the board" }).click();
  await expect(page.getByRole("status")).toContainText(title);

  // Follow the rail's "Next month" by address until it runs out.
  await page.goto("/s/blue-mantis");
  for (let step = 0; step < 8; step += 1) {
    const href = await page
      .getByRole("link", { name: "Next month" })
      .getAttribute("href", { timeout: 1_000 })
      .catch(() => null);
    if (!href) break;
    await page.goto(href);
  }
  await expect(page.getByText(new RegExp(`${title} runs every`))).toBeVisible();
  await expect(page.getByText(/Later dates open as the season goes\./)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Planning further out? Ask us for a day" }),
  ).toBeVisible();
});

/** The path of the one departure called `title` in the board week holding `date`. */
async function tripPathOn(page: Page, date: string, title: string): Promise<string> {
  await page.goto(`/shop/blue-mantis/schedule/board?week=${date}`);
  await page.locator("[data-schedule-builder]").waitFor();
  const href = await page
    .locator("[data-week-board]")
    .getByRole("link", { name: title, exact: true })
    .first()
    .getAttribute("href");
  if (!href) throw new Error(`no ${title} on the board the week of ${date}`);
  return href;
}

test("applying a series' standing crew reaches later dates, and spares one a crew member is busy on", async ({
  page,
}) => {
  // A weekly run, a second departure of its own, two crew assignments, one
  // apply, and three trip pages: the aggregate cost of a whole flow.
  test.setTimeout(60_000);
  const title = `Standing Crew ${e2eNow().getTime()}`;
  const busy = `Busy Charter ${e2eNow().getTime()}`;
  // Early and a day later than the demo shop's own runs would suggest: its
  // courses and charters keep Marcus and Dana out from mid-morning, and the
  // three-day course through Aug 1, so a mid-morning run lands on a clash.
  const first = daysFromNow(5);
  const second = daysFromNow(12);
  const third = daysFromNow(19);

  // A weekly run, open-ended: its dates a week apart are already on the board.
  await page.goto("/shop/blue-mantis/schedule/board/new?add=full");
  await page.getByLabel("What is it").fill(title);
  await page.getByLabel("Date").fill(first);
  await page.getByLabel("Departs").fill("05:00");
  await page.getByLabel("Returns").fill("07:00");
  await page.getByLabel("Seats").fill("6");
  await page.getByLabel("How often").selectOption("1");
  await page.getByRole("button", { name: "Put it on the board" }).click();
  await expect(page.getByRole("status")).toContainText(title);

  // Marcus is already out on another departure the same morning as the run's
  // second date.
  await createTrip(page, { title: busy, date: second, departsAt: "05:00", returnsAt: "07:00" });
  await page.goto(await tripPathOn(page, second, busy));
  await openTripAbout(page);
  await expect(page.getByLabel("Assign crew")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Assign crew").selectOption({ label: "Marcus Webb" });
  await expect(page.getByRole("button", { name: "Unassign Marcus Webb" })).toBeVisible();

  // The run's first date takes a two-person crew.
  const firstPath = await tripPathOn(page, first, title);
  await page.goto(firstPath);
  await openTripAbout(page);
  await expect(page.getByLabel("Assign crew")).toHaveAttribute("data-hydrated", "true");
  for (const name of ["Marcus Webb", "Dana Reyes"]) {
    await page.getByLabel("Assign crew").selectOption({ label: name });
    await expect(page.getByRole("button", { name: `Unassign ${name}` })).toBeVisible();
  }

  // Apply the date's details with the crew box checked.
  const more = await openTripMore(page);
  await more.getByRole("button", { name: /^Apply this date.s details/ }).click();
  await more.getByRole("checkbox", { name: /^Crew every upcoming date with/ }).check();
  await more.getByRole("button", { name: "Yes, apply to every date" }).click();
  // One date kept its own crew: the one Marcus is busy on.
  await expect(page.getByRole("status")).toContainText(
    staff("tripSeries.notices.seriesAppliedCrewPartialCount", { count: 1 }),
  );

  // The panel names the standing crew.
  await openTripAbout(page);
  await expect(page.locator("details#series")).toContainText("crew every date.");

  // A later date carries the same crew.
  await page.goto(await tripPathOn(page, third, title));
  // A crewed row is settled, so it is shut: open it to read the names.
  await openTripAboutRow(page, "Boat & crew");
  await expect(page.getByRole("button", { name: "Unassign Marcus Webb" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Unassign Dana Reyes" })).toBeVisible();

  // The date Marcus is busy on keeps its own crew, which is none.
  await page.goto(await tripPathOn(page, second, title));
  await openTripAbout(page);
  await expect(page.getByLabel("Assign crew")).toBeVisible();
  await expect(page.getByRole("button", { name: "Unassign Marcus Webb" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Unassign Dana Reyes" })).toHaveCount(0);
});
