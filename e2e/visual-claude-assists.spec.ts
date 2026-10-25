/**
 * Visual captures: Claude's assists, lit.
 *
 * One of the per-feature `e2e/visual-*.spec.ts` files; the capture mechanics are
 * `e2e/visual-harness.ts`, and the procedure is the e2e-and-visual skill.
 */
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { staffTranslator } from "../src/i18n/staff-messages";
import { demoEmail } from "../src/lib/simulator-email";
import { expect, test } from "./fixtures";
import {
  offlineCopySaved,
  openDiverFileGroup,
  openIfClosed,
  openTripAbout,
  openTripAboutRow,
  openTripFromBoard,
  openTripTab,
} from "./helpers";
import {
  capture,
  FLOW_TIMEOUT_MS,
  installVisualBuildGuard,
  REEF_TRIP,
  SAILED_TRIP,
  SURFACE_TIMEOUT_MS,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

/**
 * The diver on the waiting review `/api/test/claude-fixtures?review=1` seeds:
 * the first name, A to Z, among the seats on the latest sailed departure.
 */
// i18n-exempt: seed data, a diver's name
const WAITING_REVIEW_DIVER = "Carmen Ruiz";

const staff = staffTranslator("en-US");

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use(VISUAL_STEP_BOUNDS);

/**
 * **Claude's assists, lit** (ADR 20261018-claude-assists): the inbox row with
 * its intent and translation, the reply draft, the website setup tab, the
 * import mapping, the card-photo prefill, the review flags, the Draft buttons
 * on a departure and a dive site, the sightings box and the recap line.
 *
 * Every shop the fleet holds is a demo, and a demo is dark, so each test takes
 * a minted shop and `/api/test/claude-fixtures` clears its demo flag and arms
 * the canned provider for it: every answer comes from
 * `src/lib/assists/e2e-fixtures.ts` and nothing leaves the machine. The route's
 * DELETE makes it a demo again before the private-shop teardown, which drops
 * demo shops only. Light only: the assists draw with the page's own controls,
 * and dark already shoots those.
 *
 * **A pinned identity**, for the same reason `manifest-emergency-empty` has
 * one: the minted shop's name renders in the staff header.
 */
test.describe("light mode — Claude's assists, lit", () => {
  test.use({
    colorScheme: "light",
    viewport: { width: 1280, height: 800 },
    privateShopSlug: "lit-lantern-dive-co",
  });

  async function lit(
    request: APIRequestContext,
    slug: string,
    body: () => Promise<void>,
  ): Promise<void> {
    const armed = await request.post(
      `/api/test/claude-fixtures?slug=${encodeURIComponent(slug)}&review=1`,
    );
    expect(armed.ok()).toBe(true);
    try {
      await body();
    } finally {
      await request.delete(`/api/test/claude-fixtures?slug=${encodeURIComponent(slug)}`);
    }
  }

  /** The page again until `target` shows: these assists read after the response. */
  async function reloadUntil(page: Page, target: Locator): Promise<void> {
    await expect(async () => {
      await page.reload();
      await expect(target).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
  }

  test("the inbox row and the reply draft", async ({ page, request, privateShop }) => {
    test.setTimeout(FLOW_TIMEOUT_MS);
    await lit(request, privateShop.slug, async () => {
      const sent = await request.post("/api/test/inbound-message", {
        data: {
          shopSlug: privateShop.slug,
          from: demoEmail("Diego Alvarez"),
          channel: "email",
          // i18n-exempt: a diver's own words, delivered as the provider would
          body: "Hola, ¿podemos cambiar el buceo al domingo? Gracias",
        },
      });
      expect(sent.ok()).toBe(true);
      await page.goto(`/shop/${privateShop.slug}/inbox`);
      const row = page.getByRole("listitem").filter({ hasText: "Diego Alvarez" }).first();
      await reloadUntil(page, row.getByText("Wants to move"));
      await expect(row.getByText(/^In Spanish: /)).toBeVisible();
      await capture(page, "assist-inbox-row", "light");

      // The row opens in place (visual review A15); its first act is the
      // door to the diver's record.
      await row.getByRole("button", { name: "More for the message from Diego Alvarez" }).click();
      await row.getByRole("link", { name: "Open the record for Diego Alvarez" }).click();
      await page.waitForURL(/\/divers\/[0-9a-f-]{36}/);
      const conversation = page.getByRole("region", { name: "Conversation" });
      await conversation.getByRole("button", { name: "Draft a reply" }).click();
      await expect(conversation.locator("textarea").first()).toHaveValue(
        /Thanks for getting in touch/,
      );
      await page.mouse.move(0, 0);
      await capture(page, "assist-reply-draft", "light");
    });
  });

  // **Notes for AI** (Aaron, 2026-10-22 and 10-23): under the AI switch in
  // Settings, drawn only while the shop's assists are lit. An owner writes a
  // fact once and saves it with the page's one Save.
  test("the notes for AI under the AI switch", async ({ page, request, privateShop }) => {
    await lit(request, privateShop.slug, async () => {
      await page.goto(`/shop/${privateShop.slug}/settings/features`);
      const notes = page.locator("li#replyNotes");
      const box = notes.getByLabel("What should AI know about your shop?");
      // i18n-exempt: the shop's own words, typed as a staffer would
      const typed = "Park behind the shop by the tank racks. The gate opens at 7:15.";
      // The staff chrome hydrating says nothing about this box: a fill that lands
      // before React owns it is cut beside the old notes (#2973). The exact value,
      // after the fill and after the save, so a doubled note fails here.
      await expect(box).toHaveAttribute("data-hydrated", "true");
      await box.fill(typed);
      await expect(box).toHaveValue(typed);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForURL(/notice=feature-saved/);
      await expect(box).toHaveValue(typed);
      // The save's "Saved" toast leaves on its own timer; the capture is of
      // the notes at rest, so it waits for the toast to show and then to go,
      // never for whichever side of the timer the shot happened to land on.
      const saved = page
        .getByRole("status")
        .filter({ hasText: staff("settings.main.features.saved") });
      await expect(saved).toBeVisible();
      await expect(saved).toBeHidden();
      await page.locator("li#replyNotes").scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await capture(page, "assist-reply-notes", "light");
    });
  });

  test("the website setup tab and the import mapping", async ({ page, request, privateShop }) => {
    test.setTimeout(FLOW_TIMEOUT_MS);
    await lit(request, privateShop.slug, async () => {
      await page.goto(`/shop/${privateShop.slug}/settings/import?what=website`);
      const read = page.getByRole("button", { name: "Read the site" });
      await page
        .locator("form", { has: read })
        .getByLabel("Your website")
        .fill("https://lit-lantern.example.com");
      await read.click();
      await page.waitForURL(/notice=setup-read/);
      await page.getByText("Read. Accept the lines that are right.").waitFor();
      await page.mouse.move(0, 0);
      await capture(page, "assist-website-setup", "light");

      await page.goto(`/shop/${privateShop.slug}/settings/import`);
      const file = page.locator('input[type="file"]');
      await expect(file).toHaveAttribute("data-hydrated", "true");
      await file.setInputFiles({
        name: "divers.csv",
        mimeType: "text/csv",
        // i18n-exempt: an imported file's own headers and rows
        buffer: Buffer.from(
          "name,email,Cell Ph,Cert Level\n" +
            "Rosa Vega,rosa.vega@example.com,305 555 0144,Adv OW\n" +
            "Tomas Reyes,tomas.reyes@example.com,305 555 0177,Adv OW\n",
        ),
      });
      await page.getByRole("button", { name: "Map the other columns" }).click();
      await page
        .getByText(/, suggested$/)
        .first()
        .waitFor();
      await page.mouse.move(0, 0);
      await capture(page, "assist-import-mapping", "light");
    });
  });

  test("the card-photo prefill and the review flags", async ({ page, request, privateShop }) => {
    test.setTimeout(FLOW_TIMEOUT_MS);
    await lit(request, privateShop.slug, async () => {
      await page.goto(`/shop/${privateShop.slug}/divers`);
      await page
        .getByRole("link", { name: /Adaeze Nwosu/ })
        .first()
        .click();
      await page.waitForURL(/\/divers\/[0-9a-f-]{36}/);
      const group = await openDiverFileGroup(page, "Certification records");
      await group.getByText("Add certification", { exact: true }).click();
      const form = page
        .locator("form", {
          has: page.getByRole("button", { name: "Capture for review", exact: true }),
        })
        .filter({ visible: true });
      await form
        .locator('input[type="file"][accept="image/*"]')
        .setInputFiles("public/dive-sites/AtlanticGoliathGrouper.jpg");
      await expect(form.getByLabel("Certification number")).toHaveValue("OW-48213");
      await page.mouse.move(0, 0);
      await capture(page, "assist-card-photo", "light");

      await page.goto(`/shop/${privateShop.slug}/reviews`);
      await reloadUntil(page, page.getByText("Phone or email", { exact: true }).first());
      await expect(page.getByText(WAITING_REVIEW_DIVER, { exact: true })).toBeVisible();
      await page.mouse.move(0, 0);
      await capture(page, "assist-review-flags", "light");
    });
  });

  test("the Draft buttons on a departure and a dive site", async ({
    page,
    request,
    privateShop,
  }) => {
    test.setTimeout(FLOW_TIMEOUT_MS);
    await lit(request, privateShop.slug, async () => {
      await page.goto(`/shop/${privateShop.slug}/schedule/board`);
      await openTripFromBoard(page, REEF_TRIP);
      await openTripAbout(page);
      await openTripAboutRow(page, "The plan");
      await page.getByRole("button", { name: "Draft it", exact: true }).click();
      await expect(page.locator('textarea[name="description"]')).toHaveValue(
        /a crew who know the reef well/,
      );
      // The Spanish box is for a description already on file, so save first.
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByRole("status")).toContainText("Changes saved");
      await page.getByRole("button", { name: "Draft in Spanish" }).click();
      await expect(page.getByLabel("Description, in Spanish", { exact: true })).toHaveValue(
        /español/,
      );
      await page.mouse.move(0, 0);
      await capture(page, "assist-trip-draft", "light");

      await page.goto(`/shop/${privateShop.slug}/dive-sites`);
      await page.getByRole("link", { name: "Molasses Reef", exact: true }).first().click();
      await page.getByRole("heading", { level: 1, name: "Molasses Reef" }).waitFor();
      await page.getByRole("button", { name: "Draft from these fields" }).click();
      await expect
        .poll(() =>
          page
            .locator("textarea")
            .evaluateAll((boxes) =>
              boxes.some((box) => (box as HTMLTextAreaElement).value.includes("sand edge")),
            ),
        )
        .toBe(true);
      await page.mouse.move(0, 0);
      await capture(page, "assist-site-brief", "light");
    });
  });

  test("the sightings box and the recap line", async ({ page, request, privateShop }) => {
    test.setTimeout(FLOW_TIMEOUT_MS);
    await lit(request, privateShop.slug, async () => {
      await page.goto(`/shop/${privateShop.slug}`);
      await page.getByRole("link", { name: SAILED_TRIP, exact: true }).first().click();
      await expect(page).toHaveURL(/\/trips\/[a-f0-9-]+$/);
      await openTripTab(page, "Manifest");
      await offlineCopySaved(page);
      await page
        .getByRole("link", { name: "After dive 1" })
        .evaluate((link: HTMLElement) => link.click());
      await page.waitForURL(/checkpoint=after_dive_1/);
      const seen = page.getByRole("region", { name: "Seen" });
      // i18n-exempt: what the crew said, typed as they would
      await seen.getByLabel("Or say what you saw").fill("two stingrays and a big grouper");
      await seen.getByRole("button", { name: "Match" }).click();
      const add = seen.getByRole("button", { name: "Add these" });
      await add.waitFor();
      await add.evaluate((button) => button.scrollIntoView({ block: "center" }));
      await page.mouse.move(0, 0);
      await capture(page, "assist-sightings", "light");
      await add.click();
      await expect(seen.getByRole("listitem").first()).toBeVisible();

      await page.goto(`/shop/${privateShop.slug}`);
      const recap = page.locator("details", { hasText: "Recap" }).first();
      await openIfClosed(recap);
      await recap.getByRole("button", { name: "Draft it", exact: true }).click();
      await expect(recap.getByLabel("Note to divers")).toHaveValue(/ at /);
      await page.mouse.move(0, 0);
      await capture(page, "assist-recap-line", "light");
    });
  });
});
