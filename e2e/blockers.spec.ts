import { expect, signedInAsOwner, test } from "./fixtures";

signedInAsOwner();

test("the one-tap waiver send on the blockers queue reports success inline", async ({ page }) => {
  await page.goto("/shop/blue-mantis/blockers");
  await expect(page.getByRole("heading", { name: "Not ready", level: 1 })).toBeVisible();

  // Filtered by the diver's name rather than the send button's label: that
  // label itself changes once a link exists ("Send waiver" → "Nudge
  // waiver"), so a locator keyed on it would stop matching this row right
  // after the click that's being tested. Priya is blocked on two departures
  // ("fix once" — the same tap clears both), so narrow to the first row.
  const row = page.locator("li").filter({ hasText: "Priya Sharma" }).first();
  await row.getByRole("button", { name: "Send waiver", exact: true }).click();

  // The tap posts the shared server action in place — the outcome renders
  // inline (translated copy from staff.json, not a hardcoded English string)
  // instead of navigating away or leaving the tap looking like a no-op. The
  // demo shop has no email provider configured, so the fallback-link path is
  // what actually renders here — a private link staff copy and hand over.
  const outcome = row.getByRole("status");
  await expect(outcome).toBeVisible();
  await expect(outcome).toContainText("This shop has no email provider configured yet");
  await expect(outcome).toContainText("share this private link");
  await expect(outcome.getByRole("button", { name: "Copy link" })).toBeVisible();
});
