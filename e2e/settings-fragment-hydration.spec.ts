import {
  expect,
  READ_ONLY,
  STAFF_HYDRATION_PROBE,
  settleStaffHydration,
  signedInAs,
  test,
} from "./fixtures";
import { holdClientChunk } from "./hold-client-chunk";

const DATA_DOOR = "Export, import, backups and integrations";

test.describe("Settings fragment hydration", () => {
  signedInAs("owner");
  test.use({ serviceWorkers: "block" });

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

  test("keeps the Your data click when slow hydration selects the fragment", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    const browserPage = await page.context().newPage();
    const chunk = await holdClientChunk(browserPage, "settings-selection-change");
    try {
      // diveday:allow-e2e-hygiene pre-hydration-click: this spec holds the SettingsSelection chunk to reproduce the click during its layout change.
      await browserPage.goto("/shop/blue-mantis/settings#data", {
        waitUntil: "commit",
      });
      await chunk.requested;
      const selection = browserPage.locator("[data-settings-selection-root]");
      const link = browserPage.getByRole("main").getByRole("link", { name: DATA_DOOR });
      await expect(link).toBeVisible();
      await link.scrollIntoViewIfNeeded();
      const box = await link.boundingBox();
      if (!box) throw new Error("Your data door has no box before hydration");

      await browserPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await browserPage.mouse.down();
      chunk.release();
      await expect(selection).toHaveAttribute("data-hydrated", "true");
      await expect(selection).toHaveAttribute("data-selection-pending", "true");
      await expect(selection).not.toHaveAttribute("data-settings-selection", "group:data");
      await browserPage.mouse.up();
      await expect(browserPage).toHaveURL(/\/settings\/(export|import|integrations)(?:\?|$)/);
    } finally {
      chunk.release();
      await browserPage.unrouteAll({ behavior: "wait" });
      await browserPage.close();
    }
  });
  // #3640: the hub is server-rendered with every group and picks its selected
  // setting after hydration. A wait that returned on the Search trigger alone let a
  // capture photograph the whole directory (390x3115) one run and the one setting
  // (390x858) the next. The selection chunk is held, so the order is not luck.
  test("a staff navigation returns only once the hub has picked its setting", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    const browserPage = await page.context().newPage();
    const chunk = await holdClientChunk(browserPage, "settings-selection-change");
    let settling: Promise<void> | undefined;
    try {
      // diveday:allow-e2e-hygiene pre-hydration-click: no click here; the spec holds the SettingsSelection chunk and settles by hand.
      await browserPage.goto("/shop/blue-mantis/settings", {
        waitUntil: "commit",
      });
      await chunk.requested;
      const selection = browserPage.locator("[data-settings-selection-root]");
      // commit can return before the streamed header or page body has arrived.
      // Start the hydration experiment on rendered content, not its staging div.
      await expect(selection).toBeVisible();
      await expect(browserPage.locator(STAFF_HYDRATION_PROBE).first()).toHaveAttribute(
        "data-hydrated",
        "true",
      );
      let settled = false;
      settling = settleStaffHydration(browserPage).then(() => {
        settled = true;
      });
      void settling.catch(() => undefined);
      await expect(selection).not.toHaveAttribute("data-hydrated", "true");
      expect(settled).toBe(false);
      chunk.release();
      await settling;
      // Read once, not awaited: the wait is what must have made it true.
      expect(await selection.getAttribute("data-hydrated")).toBe("true");
      expect(await selection.getAttribute("data-settings-selection")).not.toBeNull();
    } finally {
      chunk.release();
      await settling?.catch(() => undefined);
      await browserPage.unrouteAll({ behavior: "wait" });
      await browserPage.close();
    }
  });
  // #3750: a disclosure toggled while React is still adopting it is the one place a
  // click and hydration interleave. The disclosure chunk is held, so a wait that
  // returned before it was React's would show here, not on a slow runner.
  test("a staff navigation returns only once its disclosures are React's", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    const browserPage = await page.context().newPage();
    const chunk = await holdClientChunk(browserPage, "data-auto-open-details");
    let settling: Promise<void> | undefined;
    try {
      // diveday:allow-e2e-hygiene pre-hydration-click: no click here; the spec holds the disclosure chunk and settles by hand.
      await browserPage.goto("/shop/blue-mantis/settings/emergency-reference", {
        waitUntil: "commit",
      });
      await chunk.requested;
      const disclosure = browserPage.locator("#emergency-contact-new");
      await expect(disclosure).toBeVisible();
      await expect(browserPage.locator(STAFF_HYDRATION_PROBE).first()).toHaveAttribute(
        "data-hydrated",
        "true",
      );
      let settled = false;
      settling = settleStaffHydration(browserPage).then(() => {
        settled = true;
      });
      void settling.catch(() => undefined);
      await expect(disclosure).not.toHaveAttribute("data-hydrated", "true");
      expect(settled).toBe(false);
      chunk.release();
      await settling;
      // Read once, not awaited: the wait is what must have made it true.
      expect(await disclosure.getAttribute("data-hydrated")).toBe("true");
    } finally {
      chunk.release();
      await settling?.catch(() => undefined);
      await browserPage.unrouteAll({ behavior: "wait" });
      await browserPage.close();
    }
  });
});
