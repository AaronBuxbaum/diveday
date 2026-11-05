import {
  expect,
  READ_ONLY,
  STAFF_HYDRATION_PROBE,
  settleStaffHydration,
  signedInAs,
  test,
} from "./fixtures";
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
  // #3640: the hub is server-rendered with every group and picks its selected
  // setting after hydration. A wait that returned on the Search trigger alone let a
  // capture photograph the whole directory (390x3115) one run and the one setting
  // (390x858) the next. The selection chunk is held, so the order is not luck.
  test(
    "a staff navigation returns only once the hub has picked its setting",
    { tag: READ_ONLY },
    async ({ page }, testInfo) => {
      const browserPage = await page.context().newPage();
      let releaseSelectionChunk!: () => void;
      let resolveSelectionChunk!: () => void;
      const selectionChunkGate = new Promise<void>((resolve) => (releaseSelectionChunk = resolve));
      const selectionChunkRequested = new Promise<void>(
        (resolve) => (resolveSelectionChunk = resolve),
      );
      try {
        await browserPage.route(/\/_next\/static\/chunks\/.*\.js(?:\?.*)?$/, async (route) => {
          const response = await route.fetch({ timeout: 10_000 });
          const body = await response.body();
          if (body.includes(Buffer.from("settings-selection-change"))) {
            resolveSelectionChunk();
            await selectionChunkGate;
          }
          await route.fulfill({ response, body });
        });
        // diveday:allow-e2e-hygiene pre-hydration-click: no click here; the spec holds the SettingsSelection chunk and settles by hand.
        await browserPage.goto(`${e2eBaseURL(testInfo.workerIndex)}/shop/blue-mantis/settings`, {
          waitUntil: "commit",
        });
        await selectionChunkRequested;
        const selection = browserPage.locator("[data-settings-selection-root]");
        let settled = false;
        const settling = settleStaffHydration(browserPage).then(() => {
          settled = true;
        });
        // The rest of the shell is React's; the hub is the page still in the server's hands.
        await expect(browserPage.locator(STAFF_HYDRATION_PROBE).first()).toHaveAttribute(
          "data-hydrated",
          "true",
        );
        await expect(selection).not.toHaveAttribute("data-hydrated", "true");
        expect(settled).toBe(false);
        releaseSelectionChunk();
        await settling;
        // Read once, not awaited: the wait is what must have made it true.
        expect(await selection.getAttribute("data-hydrated")).toBe("true");
        expect(await selection.getAttribute("data-settings-selection")).not.toBeNull();
      } finally {
        releaseSelectionChunk();
        await browserPage.unrouteAll({ behavior: "wait" });
        await browserPage.close();
      }
    },
  );
  // #3750: a disclosure toggled while React is still adopting it is the one place a
  // click and hydration interleave. The disclosure chunk is held, so a wait that
  // returned before it was React's would show here, not on a slow runner.
  test(
    "a staff navigation returns only once its disclosures are React's",
    { tag: READ_ONLY },
    async ({ page }, testInfo) => {
      const browserPage = await page.context().newPage();
      let releaseChunk!: () => void;
      let resolveChunk!: () => void;
      const chunkGate = new Promise<void>((resolve) => (releaseChunk = resolve));
      const chunkRequested = new Promise<void>((resolve) => (resolveChunk = resolve));
      try {
        await browserPage.route(/\/_next\/static\/chunks\/.*\.js(?:\?.*)?$/, async (route) => {
          const response = await route.fetch({ timeout: 10_000 });
          const body = await response.body();
          if (body.includes(Buffer.from("data-auto-open-details"))) {
            resolveChunk();
            await chunkGate;
          }
          await route.fulfill({ response, body });
        });
        // diveday:allow-e2e-hygiene pre-hydration-click: no click here; the spec holds the disclosure chunk and settles by hand.
        await browserPage.goto(
          `${e2eBaseURL(testInfo.workerIndex)}/shop/blue-mantis/settings/emergency-reference`,
          { waitUntil: "commit" },
        );
        await chunkRequested;
        const disclosure = browserPage.locator("#emergency-contact-new");
        await expect(disclosure).toBeAttached();
        const settling = settleStaffHydration(browserPage);
        await expect(browserPage.locator(STAFF_HYDRATION_PROBE).first()).toHaveAttribute(
          "data-hydrated",
          "true",
        );
        await expect(disclosure).not.toHaveAttribute("data-hydrated", "true");
        releaseChunk();
        await settling;
        // Read once, not awaited: the wait is what must have made it true.
        expect(await disclosure.getAttribute("data-hydrated")).toBe("true");
      } finally {
        releaseChunk();
        await browserPage.unrouteAll({ behavior: "wait" });
        await browserPage.close();
      }
    },
  );
});
