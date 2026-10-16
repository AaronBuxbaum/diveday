import { expect, signedInAsOwner, test } from "./fixtures";
import { daysFromNow, openTripAbout, openTripFromBoard } from "./helpers";

signedInAsOwner();

/**
 * An incident report on a departure (ADR 20261012-incident-reports), end to
 * end: started from the Details tab, written as a draft, a diver named by
 * their seat, filed once, a dated note added after, and the report found
 * again on the Safety tab beside Reports. Safety-critical record, so the
 * whole path runs in a browser.
 */
test("a report is written, filed, amended and found on the Safety tab", async ({ page }) => {
  // Board → trip → report, five writes, then Reports: several full round trips.
  test.setTimeout(60_000);
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripAbout(page);

  const section = page.getByRole("region", { name: "Incident reports" });
  await section.getByRole("button", { name: "Report an incident" }).click();
  await page.waitForURL(/\/incidents\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { level: 1, name: "Incident report" })).toBeVisible();

  // A blank draft cannot be filed, and says what it still needs.
  const filing = page.getByRole("region", { name: "File the report" });
  await expect(filing.getByText("Whether oxygen was given")).toBeVisible();
  await expect(filing.getByText("How serious it was")).toBeVisible();
  await expect(filing.getByRole("button", { name: "File report" })).toBeDisabled();

  // The account, in the shop's own zone.
  await page.getByLabel("Date", { exact: true }).fill(daysFromNow(0));
  await page.getByLabel("Time", { exact: true }).fill("09:10");
  await page.getByLabel("Where, in words").fill("Boat deck, at the ladder");
  await page
    .getByLabel("What happened")
    .fill("Diver surfaced from 18 m short of breath after a fast ascent. Brought aboard.");
  // What sort of thing it was, and how bad (ADR 20261014-incident-kind-severity).
  await page.getByLabel("What kind of incident").selectOption({ label: "Injury or illness" });
  await page.getByLabel("How serious").selectOption({ label: "Moderate" });
  const care = page.getByRole("region", { name: "Care given" });
  await care.getByRole("group", { name: "Was first aid given?" }).getByLabel("Yes").check();
  await care.getByRole("group", { name: "Was oxygen given?" }).getByLabel("Yes").check();
  await care.getByLabel("Minutes on oxygen").fill("20");
  await care
    .getByRole("group", { name: "Were emergency services called?" })
    .getByLabel("No")
    .check();
  // Oxygen was given, so where the diver went is part of the account.
  await page.getByLabel("Who took over care").selectOption({ label: "Stayed with the crew" });
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();

  // Unfiled, it is one line on the owner's Today, and the line opens it.
  const reportPath = new URL(page.url()).pathname;
  await page.goto("/shop/blue-mantis");
  await expect(page.getByText(/1 incident report not filed, started today by /)).toBeVisible();
  await page.getByRole("link", { name: "Open report" }).click();
  await page.waitForURL((url) => url.pathname === reportPath);

  // A diver, named by their seat on this departure.
  const people = page.getByRole("region", { name: "People involved" });
  const who = people.getByLabel("Who");
  const firstSeat = await who.locator("optgroup").first().locator("option").first().textContent();
  if (!firstSeat) throw new Error("expected a seat on the reef trip");
  await who.selectOption({ label: firstSeat });
  await people.getByRole("button", { name: "Add to the report" }).click();
  await expect(page.getByText("Added to the report.")).toBeVisible();
  await expect(people.getByText(firstSeat, { exact: true })).toBeVisible();

  // Filed: it reads as a record from here, with its answers in words.
  await page.getByRole("button", { name: "File report" }).click();
  await expect(page.getByText("Report filed.")).toBeVisible();
  await expect(page.getByText("Yes, for 20 minutes")).toBeVisible();
  await expect(page.getByText("Stayed with the crew")).toBeVisible();
  await expect(page.getByText("Injury or illness", { exact: true })).toBeVisible();
  await expect(page.getByText("Moderate", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save draft" })).toHaveCount(0);

  // Anything learned later is a dated note, never an edit.
  const addenda = page.getByRole("region", { name: "Later notes" });
  await addenda.getByLabel("Add a note").fill("Diver called at 18:00: discharged, feeling fine.");
  await addenda.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("Note added.")).toBeVisible();
  await expect(addenda.getByText("Diver called at 18:00: discharged, feeling fine.")).toBeVisible();

  // The month's Safety tab lists it, beside the money.
  await page.goto("/shop/blue-mantis/reports");
  await page.getByRole("link", { name: "Safety" }).click();
  await page.waitForURL(/\/reports\/safety/);
  // The demo crew have no credential on file, and the tab says so rather than
  // reading a clean zero (third review, item 2).
  await expect(page.getByText(/No credential on file for \d+ of/)).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Crew who sailed with no credential on file" }),
  ).toBeVisible();
  const listed = page
    .getByRole("region", { name: "Incident reports" })
    .getByRole("link", { name: /Two-Tank Reef/ });
  await expect(listed).toBeVisible();
  await expect(listed).toContainText("Injury or illness");
  await expect(listed).toContainText("Moderate");
  await listed.click();
  await expect(page.getByText("Diver called at 18:00: discharged, feeling fine.")).toBeVisible();
});
