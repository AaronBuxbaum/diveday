import { expect, READ_ONLY, test } from "./fixtures";
import { holdClientChunk } from "./hold-client-chunk";

test.use({ serviceWorkers: "block" });

test("language picker becomes actionable only when its client handler is ready", {
  tag: READ_ONLY,
}, async ({ page }) => {
  const browserPage = await page.context().newPage();
  const chunk = await holdClientChunk(browserPage, "data-language-picker");
  try {
    // diveday:allow-e2e-hygiene pre-hydration-click: hold the picker chunk and inspect the disabled control before releasing it.
    await browserPage.goto("/s/blue-mantis", { waitUntil: "commit" });
    await chunk.requested;
    const trigger = browserPage.getByRole("button", { name: "Change language" });
    await expect(trigger).toBeVisible();
    await expect(trigger).toBeDisabled();
    chunk.release();
    await expect(trigger).toBeEnabled();
    // diveday:allow-e2e-hygiene pre-hydration-click: the disabled-to-enabled transition proves the held picker has committed.
    await trigger.click();
    await expect(browserPage.getByRole("button", { name: "English" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(browserPage.getByRole("button", { name: "Español" })).toBeVisible();
  } finally {
    chunk.release();
    await browserPage.unrouteAll({ behavior: "wait" });
    await browserPage.close();
  }
});
