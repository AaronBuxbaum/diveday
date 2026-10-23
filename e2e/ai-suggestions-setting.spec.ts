import { expect, test } from "./fixtures";

/**
 * **The AI switch says why it stays dark** (Aaron, 2026-10-23): the switch read
 * on while every page said suggestions were off. The fleet runs with outbound
 * calls switched off, so here AI is dark with its switch on: the row names the
 * reason, and the notes-for-AI box, which nothing would read, is not drawn.
 * The lit box is driven in `visual-claude-assists.spec.ts`. A shop of its own
 * (`privateShop`) signs its owner in.
 */
test("the AI switch names why suggestions stay hidden, and draws no notes box", async ({
  page,
  privateShop,
}) => {
  await page.goto(`/shop/${privateShop.slug}/settings/features`);
  const row = page.locator("li#claudeSuggestions");
  await expect(row.getByLabel("Show AI suggestions")).toBeChecked();
  await expect(row.getByText(/^AI isn.t connected on this server yet/)).toBeVisible();
  await expect(page.locator("li#replyNotes")).toHaveCount(0);
});
