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
  await expect(filing.getByRole("button", { name: "File report" })).toBeDisabled();

  // The account, in the shop's own zone.
  await page.getByLabel("Date", { exact: true }).fill(daysFromNow(0));
  await page.getByLabel("Time", { exact: true }).fill("09:10");
  await page
    .getByLabel("What happened")
    .fill("Diver surfaced from 18 m short of breath after a fast ascent. Brought aboard.");
  const care = page.getByRole("region", { name: "Care given" });
  await care.getByRole("group", { name: "Was first aid given?" }).getByLabel("Yes").check();
  await care.getByRole("group", { name: "Was oxygen given?" }).getByLabel("Yes").check();
  await care.getByLabel("Minutes on oxygen").fill("20");
  await care
    .getByRole("group", { name: "Were emergency services called?" })
    .getByLabel("No")
    .check();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();

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
  const listed = page
    .getByRole("region", { name: "Incident reports" })
    .getByRole("link", { name: /Two-Tank Reef/ });
  await expect(listed).toBeVisible();
  await listed.click();
  await expect(page.getByText("Diver called at 18:00: discharged, feeling fine.")).toBeVisible();
});
