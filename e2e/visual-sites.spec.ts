import { expect, signedInAsOwner, test } from "./fixtures";
import { openIfClosed } from "./helpers";
import {
  capture,
  installVisualBuildGuard,
  SURFACE_TIMEOUT_MS,
  staffCopy,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use(VISUAL_STEP_BOUNDS);
for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });
    test.describe("staff", () => {
      signedInAsOwner();

      // A site's own briefing form, which is where the route a shop draws is
      // drawn. Captured on a seeded site that already has one, so the frame
      // holds the map, the curve, and its start/finish dots rather than the
      // empty state — the thing worth having a baseline of. The terrain
      // embed is a third-party iframe and renders nothing deterministic in
      // CI, which is exactly why the overlay is what this watches: the SVG is
      // ours and is drawn from the row.
      test(`the dive-site briefing form renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/dive-sites");
        await page.getByRole("link", { name: "Molasses Reef" }).first().click();
        await page.getByRole("heading", { level: 1, name: "Molasses Reef" }).waitFor();
        // The route is what this frame is for, and it and the station line sit
        // in closed rows since the fold (visual review 2026-10-24, A11): both
        // open. The route's caption box renders once the editor has mounted
        // and read the coordinate fields beside it.
        await openIfClosed(page.locator("details#briefing-route").filter({ visible: true }));
        await openIfClosed(page.locator("details#briefing-forecast").filter({ visible: true }));
        await page.getByLabel("What the route is called").waitFor();
        // What the seven-digit station id actually names (issue #1468), read
        // off the fixture station the fleet serves in place of NOAA. Waited on
        // rather than assumed: a lookup that answered nothing renders no line
        // at all, and this is the capture that would otherwise photograph the
        // absence without failing. Carysfort is genuinely the nearest station
        // to this reef, so no distance warning belongs in this frame.
        await page.getByText("8723583 · Carysfort Reef, FL").waitFor({ state: "attached" });
        await capture(page, "dive-site-edit", scheme);
        await openIfClosed(page.locator("details#briefing-template").filter({ visible: true }));
        await expect(
          page
            .getByText(staffCopy("diveSites.edit.templateUpdates.current"), { exact: true })
            .first(),
        ).toBeVisible();
        await expect(
          page
            .getByText(staffCopy("diveSites.edit.templateUpdates.template"), { exact: true })
            .first(),
        ).toBeVisible();
        await capture(page, "dive-site-template-values", scheme);
      });

      /**
       * **The same editor with the one thing the frame above deliberately
       * excludes** (issue #1772): the implausible-station advisory, and the
       * box that answers it.
       *
       * The capture above says in as many words that "no distance warning
       * belongs in this frame" — Carysfort genuinely is the nearest station to
       * that reef — so the warning tone, its two-line wrap under the field, and
       * the checkbox that follows the grid had no baseline at all. They are
       * what a shop sees on the one occasion this form has anything to say
       * beyond echoing an id back.
       *
       * Seeded, not typed: `fixtureTideStation` answers Carysfort for every id,
       * so no station a spec could type is far from anything. The distance has
       * to come from the site, and a site that remote is one the demo shop must
       * not carry standing (`.claude/rules/surfaces.md`), so it arrives through
       * `/api/test/seed-trouble-states` and leaves with the next reset.
       */
      test(`the dive-site editor warns about a station nowhere near it (${scheme})`, async ({
        page,
        request,
      }) => {
        const seeded = await request.post("/api/test/seed-trouble-states?farStation=1");
        expect(seeded.ok()).toBe(true);
        const { farStation } = (await seeded.json()) as {
          farStation?: { siteId: string; name: string; slug: string };
        };
        if (!farStation) throw new Error("seed-trouble-states seeded no far-station site");

        await page.goto(`/shop/blue-mantis/dive-sites/${farStation.siteId}`);
        await page.getByRole("heading", { level: 1, name: farStation.name }).waitFor();
        // The editor's own mounted marker.
        await page.locator("form[data-hydrated]").filter({ visible: true }).waitFor();
        // The sentence itself, not the echo line: the echo renders whether or
        // not the station is far, so waiting on it would photograph the calm
        // state without failing.
        // Forecast is a closed row (visual review 2026-10-24, A11); the advisory
        // is what this frame is for, so it is opened.
        await openIfClosed(page.locator("details#briefing-forecast").filter({ visible: true }));
        await page.getByText(/so the turn it predicts can reach this water/).waitFor();
        await capture(page, "dive-site-far-station", scheme);
      });

      /**
       * The same long form with nothing in it — a landmark editor, a creature
       * picker, and every field a shop meets before it has anything to edit.
       * Its sibling above was captured and this one never was (issue #727),
       * and an empty form is a different picture: every placeholder, every
       * "(optional)", and the empty states of both list editors.
       */
      test(`the new-dive-site form renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/dive-sites/new");
        await page.locator("form[data-hydrated]").filter({ visible: true }).waitFor();
        await capture(page, "dive-site-new", scheme);
      });

      test(`the empty site editors fit intermediate widths (${scheme})`, async ({
        page,
      }, testInfo) => {
        await page.goto("/shop/blue-mantis/dive-sites/new");
        await page.locator("form[data-hydrated]").filter({ visible: true }).waitFor();
        await openIfClosed(page.locator("details#briefing-route").filter({ visible: true }));
        await openIfClosed(page.locator("details#briefing-landmarks").filter({ visible: true }));
        await openIfClosed(page.locator("details#briefing-field-guide").filter({ visible: true }));
        await expect(
          page.getByText(staffCopy("diveSites.form.route.needsCoordinates")),
        ).toBeVisible();
        const species = page.getByLabel("Find a species");
        await expect(species).toBeVisible();
        for (const width of [990, 1024, 1050]) {
          await page.setViewportSize({ width, height: 800 });
          const box = await species.boundingBox();
          if (!box) throw new Error("The species field has no visible box");
          expect(box.x + box.width).toBeLessThanOrEqual(width);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(width);
          if (width === 1024) {
            await testInfo.attach("expanded site editors at 1024px", {
              body: await page.screenshot({ fullPage: true }),
              contentType: "image/png",
            });
          }
        }
        await capture(page, "dive-site-empty-editors", scheme);
      });

      /**
       * The same editor mid-edit — the one state neither capture above can
       * hold. ADR 20260827-the-shops-shelves' long-form editor pattern put a
       * section rail beside the form and a sentence beside the one Save; the
       * rail's current entry and that sentence are both *derived*, so a resting
       * capture photographs neither. This types into two sections, which is
       * what turns the sentence from a name into a count.
       */
      test(`the briefing editor mid-edit renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/dive-sites/new");
        await page.locator("form[data-hydrated]").filter({ visible: true }).waitFor();
        await page.getByLabel("Name").fill("Turtle Ledge");
        await page.getByLabel("Depth note").fill("20-45 ft");
        await page.getByText("Unsaved changes in 2 sections").waitFor();
        // **Focus is put back before each width** (issue #2570). The capture
        // shoots 390 first, where the folded depth section is
        // `max-lg:hidden`, so the field loses focus there and the 1280 shot
        // showed no ring. A hidden field is left alone.
        const depth = page.getByLabel("Depth note");
        await capture(page, "dive-site-editor-unsaved", scheme, {
          beforeShot: async () => {
            if (await depth.isVisible()) await depth.focus();
          },
        });
      });
    });
  });
}
