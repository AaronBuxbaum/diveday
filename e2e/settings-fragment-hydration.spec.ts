import { expect, READ_ONLY, signedInAs, test } from "./fixtures";
import { e2eBaseURL } from "./servers";

const DATA_DOOR = "Export, import, backups and integrations";

test.describe("Settings fragment hydration", () => {
  signedInAs("owner");

  test("keeps the Your data door navigable after ordinary hydration", { tag: READ_ONLY }, async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/settings#data");
    const selection = page.locator("[data-settings-selection-root]");
    await expect(selection).toHaveAttribute("data-hydrated", "true");
    await expect(selection).toHaveAttribute("data-settings-selection", "group:data");
    const link = page.getByRole("main").getByRole("link", { name: DATA_DOOR });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/settings\/(export|import|integrations)(?:\?|$)/);
  });

  test(
    "keeps the Your data click when slow hydration selects the fragment",
    { tag: READ_ONLY },
    async ({ page }, testInfo) => {
      const browserPage = await page.context().newPage();
      let releaseSelectionChunk!: () => void;
      let resolveSelectionChunk!: () => void;
      const selectionChunkGate = new Promise<void>((resolve) => (releaseSelectionChunk = resolve));
      const selectionChunkRequested = new Promise<void>(
        (resolve) => (resolveSelectionChunk = resolve),
      );
      const chunkRoute = /\/_next\/static\/chunks\/.*\.js(?:\?.*)?$/;
      try {
        await browserPage.route(chunkRoute, async (route) => {
          // Keep handler cleanup within the test's 15-second teardown budget.
          const response = await route.fetch({ timeout: 10_000 });
          const body = await response.body();
          if (body.includes(Buffer.from("settings-selection-change"))) {
            resolveSelectionChunk();
            await selectionChunkGate;
          }
          await route.fulfill({ response, body });
        });

        // diveday:allow-e2e-hygiene pre-hydration-click: this spec holds the SettingsSelection chunk to reproduce the click during its layout change.
        await browserPage.goto(
          `${e2eBaseURL(testInfo.workerIndex)}/shop/blue-mantis/settings#data`,
          {
            waitUntil: "commit",
          },
        );
        await selectionChunkRequested;
        const selection = browserPage.locator("[data-settings-selection-root]");
        const link = browserPage.getByRole("main").getByRole("link", { name: DATA_DOOR });
        await expect(link).toBeVisible();
        await link.scrollIntoViewIfNeeded();
        const box = await link.boundingBox();
        if (!box) throw new Error("Your data door has no box before hydration");

        await browserPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await browserPage.mouse.down();
        releaseSelectionChunk();
        await expect(selection).toHaveAttribute("data-hydrated", "true");
        await expect(selection).toHaveAttribute("data-selection-pending", "true");
        await expect(selection).not.toHaveAttribute("data-settings-selection", "group:data");
        await browserPage.mouse.up();
        await expect(browserPage).toHaveURL(/\/settings\/(export|import|integrations)(?:\?|$)/);
      } finally {
        releaseSelectionChunk();
        await browserPage.unrouteAll({ behavior: "wait" });
        await browserPage.close();
      }
    },
  );
});
