// Every test in this file only reads — no writes, so it opts out of the per-test demo reset.
import { expect, readOnlyTest as test } from "./fixtures";

test("the schedule page leads with a quick link to the next departure with room", async ({
  page,
}) => {
  await page.goto("/s/blue-mantis");
  const card = page.getByRole("link", { name: /Next boat out/ });
  await expect(card).toBeVisible();
  // "3 spots left" / "Full" — whichever it is, the card names it, not a
  // silent link with no idea whether there's room.
  await expect(card).toContainText(/spot|full/i);
  const href = await card.getAttribute("href");
  expect(href).toMatch(/^\/s\/blue-mantis\/trips\/[0-9a-f-]{36}#book$/);

  await card.click();
  await expect(page).toHaveURL(/\/s\/blue-mantis\/trips\/[0-9a-f-]{36}#book$/);
  await expect(page.getByLabel("Number of divers")).toBeVisible();
});
