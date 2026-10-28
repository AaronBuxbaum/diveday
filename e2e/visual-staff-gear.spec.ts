/**
 * Visual captures: the gear register, work orders and counter rentals.
 *
 * One of the per-feature `e2e/visual-*.spec.ts` files; the capture mechanics are
 * `e2e/visual-harness.ts`, and the procedure is the e2e-and-visual skill.
 */
import { DEMO_SHOP_TIMEZONE } from "../src/db/seed-clock";
import { calendarDateInTimezone, formatCalendarDate } from "../src/lib/calendar-date";
import { DAY_MS } from "../src/lib/clock";
import { expect, signedInAsOwner, test } from "./fixtures";
import { e2eNow } from "./helpers";
import {
  capture,
  captureStickyFoot,
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
    // Base viewport for navigation and clicks; `capture` resizes to each entry
    // in VIEWPORTS for the screenshots and restores this afterward.
    test.use({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });

    test.describe("staff", () => {
      signedInAsOwner();

      // The gear register on a calm morning (ADR 20260827-the-shops-shelves,
      // slice 9d): the kind chips, one "On the wall" group of hairline rows
      // carrying their reserved-for and service sentences, the register's own
      // coral line — nothing is out — and the add-a-unit form. The three stat
      // tiles and the Returns panel that used to sit above this are gone; the
      // groups are the states now.
      test(`the gear register renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/gear");
        await page.getByRole("heading", { level: 1, name: "Gear" }).waitFor();
        // The last seeded tank's row — the ledger below the fold has settled.
        await page.getByRole("link", { name: "AL63-02" }).waitFor();
        await capture(page, "gear-register", scheme);
      });

      // The bench on an ordinary Monday (ADR 20261008-gear-work-orders): the
      // Gear section's two tabs, the open statuses in counter order with
      // their late and ready badges, and the collected tail under them.
      test(`the work-order board renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/gear/work-orders");
        await page.getByRole("heading", { level: 1, name: "Work orders" }).waitFor();
        // The last seeded group's row — the board below the fold has settled.
        await page
          .getByRole("link", { name: /Battery hatch leaked/ })
          .first()
          .waitFor();
        await capture(page, "work-order-board", scheme);
      });

      // One ticket, whole: the moves, the job, the pieces, the Work done
      // form, the parts and labor with their running total, and the
      // history. The seeded in-progress ticket is the one carrying all of
      // them at once.
      test(`a work order renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/gear/work-orders");
        await page
          .getByRole("link", { name: /Breathes wet at depth/ })
          .first()
          .click();
        await page.getByRole("heading", { level: 2, name: "Parts and labor" }).waitFor();
        await capture(page, "work-order-ticket", scheme);
      });

      // A collected ticket: no moves left, and the Work done record read
      // back (how the job ended, each check, the next due date it set).
      test(`a collected work order renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/gear/work-orders");
        await page
          .getByRole("link", { name: /Battery hatch leaked/ })
          .first()
          .click();
        await page.getByRole("heading", { level: 2, name: "Work done" }).waitFor();
        await capture(page, "work-order-ticket-collected", scheme);
      });

      // The shop's own unit on the bench: off the wall while it is here, and
      // the Work done form carrying the unit's own interval forward.
      test(`a work order on a shop unit renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/gear/work-orders");
        await page
          .getByRole("link", { name: /Second stage free-flows on the surface/ })
          .first()
          .click();
        await page.getByRole("heading", { level: 2, name: "Work done" }).waitFor();
        await capture(page, "work-order-ticket-unit", scheme);
      });

      // Opening a ticket, with the diver chosen: the pieces of theirs on file
      // as the checklist of what came in, and the job block under it.
      test(`the new work-order form renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/gear/work-orders/new?diverq=Diego+Alvarez");
        await page.getByRole("link", { name: "Diego Alvarez" }).first().click();
        await page.getByRole("heading", { level: 2, name: "The job" }).waitFor();
        await capture(page, "work-order-new", scheme);
      });

      // The claim tag as it prints: what we have, what you told us, and when
      // to come back — no total and nothing to sign (the rental slip's
      // posture, ADR 20261008-gear-work-orders).
      test(`a work order's claim tag renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/gear/work-orders");
        await page
          .getByRole("link", { name: /Breathes wet at depth/ })
          .first()
          .click();
        await page.getByRole("link", { name: "Print claim tag" }).click();
        await page.getByRole("heading", { level: 2, name: "What we have" }).waitFor();
        await capture(page, "work-order-claim-tag", scheme);
      });

      // What the customer hears and what they owe (ADR
      // 20261008-work-order-follow-up), on a shop that can take money: the
      // ready message still to come and the bill's own button. The calm
      // ticket capture above shows the unconnected shape ("collected at the
      // counter"); this is the other one.
      test(`a work order's bill renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        await request.post("/api/test/seed-stripe-account");
        await page.goto("/shop/blue-mantis/gear/work-orders");
        await page
          .getByRole("link", { name: /Inflator sticks open/ })
          .first()
          .click();
        await page.getByRole("button", { name: "Send the bill" }).waitFor();
        await capture(page, "work-order-bill", scheme);
      });

      // The bench running behind, on Today: a ticket past its promised day and
      // one ready for a week that nobody has collected, through the opt-in
      // `?bench=1` trouble state (never seeded into blue-mantis).
      test(`Today asks about the bench (${scheme})`, async ({ page, request }) => {
        await request.post("/api/test/seed-trouble-states?bench=1");
        await page.goto("/shop/blue-mantis");
        const benchDate = (daysAgo: number) =>
          formatCalendarDate(
            calendarDateInTimezone(
              new Date(e2eNow().getTime() - daysAgo * DAY_MS),
              DEMO_SHOP_TIMEZONE,
            ),
            "en-US",
          );
        await page
          .getByRole("listitem")
          .filter({
            hasText: staffCopy("benchFollowUp.today.pastPromise", { date: benchDate(2) }),
          })
          .first()
          .waitFor();
        await page
          .getByRole("listitem")
          .filter({
            hasText: staffCopy("benchFollowUp.today.uncollected", { date: benchDate(9) }),
          })
          .first()
          .waitFor();
        await capture(page, "today-bench", scheme);
      });

      // One unit's record — chosen for the tank whose seeded visual
      // inspection lands inside the due-soon window, so the clock grammar
      // (amber state line + per-clock list) is in frame alongside the
      // service log form and history.
      test(`a gear unit's record renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/gear");
        await page.getByRole("link", { name: "AL80-03" }).click();
        await page.getByRole("heading", { level: 1, name: "AL80-03" }).waitFor();
        await capture(page, "gear-unit", scheme);
      });

      // **A unit already on the bench that came home with a concern** (issue
      // #2570, #2540): the status card names the return and its words. Reg #4
      // is the demo's benched regulator; the opt-in `?gearConcern=1` state
      // gives it a rental that came home yesterday, never seeded standing.
      test(`a benched unit's record names the concern it came home with (${scheme})`, async ({
        page,
        request,
      }) => {
        const seeded = await request.post("/api/test/seed-trouble-states?gearConcern=1");
        expect(seeded.ok()).toBe(true);
        const { gearConcern } = (await seeded.json()) as {
          gearConcern?: { gearItemId: string; label: string };
        };
        if (!gearConcern)
          throw new Error("seed-trouble-states could not return Reg #4 with a concern");
        await page.goto(`/shop/blue-mantis/gear/${gearConcern.gearItemId}`);
        await page.getByRole("heading", { level: 1, name: gearConcern.label }).waitFor();
        await page.getByText(/^Returned .+ with a concern: /).waitFor();
        await capture(page, "gear-unit-concern", scheme);
      });

      // Renting gear out at the counter (ADR 20260815-minimal-gear-register,
      // amended 2026-10-08; redrawn 2026-10-09): the person chosen, today's
      // window, the free units of one kind as tiles, the bill with its total,
      // and how they pay. Priya has signed nothing, so the person step also
      // holds the unsigned waiver line and its Send waiver (issue #2346).
      test(`the rent-out form renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/gear/rentals/new?q=Priya");
        await page.getByRole("link", { name: "Rent to Priya Sharma" }).click();
        await page.getByRole("group", { name: "Kind of gear" }).waitFor();
        // Two picks and a payment, so the bill, its total and the bar are in frame.
        for (const [kind, label] of [
          ["Mask", /^Mask #1\b/],
          ["Fins", /^Fins #1\b/],
        ] as const) {
          await page
            .getByRole("group", { name: "Kind of gear" })
            .getByRole("button", { name: new RegExp(`^${kind}\\b`) })
            .click();
          await page.getByRole("button", { name: label }).click();
        }
        await page.getByRole("button", { name: "Remove Fins #1" }).waitFor();
        await page.getByRole("radio", { name: /^Cash/ }).check();
        await capture(page, "counter-rental-form", scheme);
        // The bar at the foot, which a full-page capture cannot paint where it
        // stands: how many items and how much, beside Rent out.
        await captureStickyFoot(page, "counter-rental-form-foot", scheme);
      });

      test(`a counter tank offers air when nitrox is unconfirmed (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/gear/rentals/new?q=Lena");
        await page.getByRole("link", { name: "Rent to Lena Fischer" }).click();
        await page
          .getByRole("group", { name: "Kind of gear" })
          .getByRole("button", { name: /^Tank\b/ })
          .click();
        const tank = page
          .getByRole("button", { name: /^AL(?:80|63)-/ })
          .and(page.locator(":enabled"))
          .first();
        await tank.click();
        await expect(page.getByText(staffCopy("counterRentals.new.fillUnavailable"))).toBeVisible();
        await capture(page, "counter-rental-unconfirmed-nitrox", scheme);
      });

      // The ticket the person walks off with: who, the tags, the back-by
      // date, and on screen the acts. Rented here rather than seeded so the
      // capture is the ticket a counter lands on, notice and all. Priya has
      // signed nothing at blue-mantis, so the frame also holds the unsigned
      // waiver line and its Send waiver (issue #2261, H-108).
      test(`a counter rental's ticket renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/gear/rentals/new?q=Priya");
        await page.getByRole("link", { name: "Rent to Priya Sharma" }).click();
        for (const [kind, label] of [
          ["Mask", /^Mask #1\b/],
          ["Fins", /^Fins #1\b/],
        ] as const) {
          await page
            .getByRole("group", { name: "Kind of gear" })
            .getByRole("button", { name: new RegExp(`^${kind}\\b`) })
            .click();
          await page.getByRole("button", { name: label }).click();
        }
        await page.getByRole("button", { name: "Remove Fins #1" }).waitFor();
        await page.getByRole("radio", { name: /^Cash/ }).check();
        await page.getByRole("button", { name: "Rent out", exact: true }).click();
        await page.getByRole("status").filter({ hasText: "Payment recorded." }).waitFor();
        await page.getByRole("button", { name: "Hand over" }).waitFor();
        await page.getByText("Waiver: Not signed").waitFor();
        await capture(page, "counter-rental-ticket", scheme);
      });

      test(`a counter tank rental keeps its gas correction controls level (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/gear/rentals/new?q=Priya");
        await page.getByRole("link", { name: "Rent to Priya Sharma" }).click();
        await page
          .getByRole("group", { name: "Kind of gear" })
          .getByRole("button", { name: /^Tank\b/ })
          .click();
        const tank = page
          .getByRole("button", { name: /^AL(?:80|63)-/ })
          .and(page.locator(":enabled"))
          .first();
        await tank.click();
        await expect(tank).toHaveAttribute("aria-pressed", "true");
        await page.getByRole("combobox", { name: /^Fill for / }).selectOption("21");
        await page.getByRole("radio", { name: /^No charge/ }).check();
        await page.getByRole("button", { name: "Rent out", exact: true }).click();
        await page.waitForURL(/\/gear\/rentals\/[0-9a-f-]{36}(?:[?#]|$)/);
        await page.locator('[data-tank-gas] select[name="fill"]').waitFor();
        await capture(page, "counter-rental-tank-gas-correction", scheme);
      });

      // The way back to a deleted unit (ADR 20260820-every-delete-is-soft):
      // the Deleted chip in the filter band, and the list whose one act is
      // Restore. Photographed after deleting a unit rather than seeding one —
      // the shop's demo fleet is what a shop should see, and a permanently
      // deleted regulator in it would be a worse demo.
      test(`the gear register's deleted units render true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/gear");
        await page.getByRole("link", { name: "Reg #5", exact: true }).click();
        await page.getByRole("heading", { level: 1, name: "Reg #5" }).waitFor();
        await page.getByRole("button", { name: "Delete unit" }).click();
        await page.getByRole("status").filter({ hasText: "Unit deleted" }).waitFor();

        await page.goto("/shop/blue-mantis/gear?view=deleted");
        await page.getByRole("button", { name: "Restore Reg #5" }).waitFor();
        await capture(page, "gear-register-deleted", scheme);
      });

      // The same unit's own record while it is deleted (issue #614): the
      // Deleted badge in the header, the service clocks and the unfolded
      // paper trail that are the reason the row survived the delete, and a
      // page carrying no control but Restore. The read-only shape is what
      // this watches — a write form creeping back in is invisible in a diff
      // of the page, which branches in five places.
      test(`a deleted unit's record renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/gear");
        await page.getByRole("link", { name: "Reg #5", exact: true }).click();
        await page.getByRole("heading", { level: 1, name: "Reg #5" }).waitFor();
        const record = page.url();
        await page.getByRole("button", { name: "Delete unit" }).click();
        await page.getByRole("status").filter({ hasText: "Unit deleted" }).waitFor();

        await page.goto(record);
        await page.getByRole("button", { name: "Restore unit" }).waitFor();
        await capture(page, "gear-unit-deleted", scheme);
      });

      // The register on a working morning, through /api/test/seed-trouble-states
      // (never seeded into blue-mantis, whose whole fleet is calm): all three
      // of the register's groups in one frame — a unit out with a diver and due
      // back today at a named time, a checked-out unit gone overdue carrying
      // the warning word and its drawn mark, and the wall beneath them with a
      // lapsed tank inspection in its service sentence. `?gearOut=1` is opt-in
      // because a unit due back today is also a row on Today (ADR
      // 20260827-the-shops-shelves, slice 9d).
      test(`the gear register's out and overdue groups render true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        const seeded = await request.post(
          "/api/test/seed-trouble-states?gearOut=1&gearUncollected=1",
        );
        expect(seeded.ok()).toBe(true);
        await page.goto("/shop/blue-mantis/gear");
        await page.getByRole("heading", { level: 1, name: "Gear" }).waitFor();
        // Both group headings, so the capture can never land on a half-built
        // ledger — and the wall's own rows are what the `AL63-02` wait below
        // proves have arrived.
        await page.getByRole("heading", { level: 2, name: /^Out/ }).waitFor();
        await page.getByRole("heading", { level: 2, name: /^Overdue/ }).waitFor();
        await page.getByRole("link", { name: "AL63-02" }).waitFor();
        await expect(
          page.getByText(staffCopy("gear.phase.neverPickedUp"), { exact: true }),
        ).toHaveCount(1);
        for (const label of ["BCD #3", "BCD #4"]) {
          await expect(
            page.getByRole("button", {
              name: staffCopy("gear.fleet.acts.releaseUnit", { label }),
              exact: true,
            }),
          ).toBeVisible();
        }
        await capture(page, "gear-register-trouble", scheme);
      });

      // The register's fleet-wide service reading (ADR 20260827-the-shops-shelves,
      // slice 9d as amended after review): the one question the three groups
      // do not answer, reached from the band's own chip. Two shapes in one
      // frame off the calm demo fleet — Reg #4 pulled off the wall and leading
      // because it is stopped now, and AL80-03's visual inspection three weeks
      // out, which is the month-ahead heads-up Today's six-day queue never
      // mentions. No trouble seed: this is a shop having an ordinary week.
      test(`the register's service-due view renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/gear?view=service");
        await page.getByRole("heading", { level: 1, name: "Gear" }).waitFor();
        // The last row of the list, so the capture cannot land half-built.
        await page.getByRole("link", { name: "AL80-03" }).waitFor();
        await capture(page, "gear-register-service-due", scheme);
      });

      // **Who has the shop's gear** (plan `rental-tracking`, layer 2): the
      // register's Rentals view, every open rental under the person holding
      // it. Through the trouble seed with `?gearOut=1`, so one frame holds the
      // three things the view says: a set gone overdue leading the page, one
      // of its units dragged onto today and saying its own state beside its
      // tag, and a set still reserved for the wreck trip below it.
      test(`the register's rentals view renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        await request.post("/api/test/seed-trouble-states?gearOut=1");
        await page.goto("/shop/blue-mantis/gear?view=rentals");
        await page.getByRole("heading", { level: 1, name: "Gear" }).waitFor();
        const rentals = page.getByRole("region", { name: "Rentals" });
        // Both sets, so the capture cannot land on half a list.
        await rentals.getByRole("link", { name: "BCD #2" }).waitFor();
        await rentals.getByRole("link", { name: "BCD #5" }).waitFor();
        await capture(page, "gear-register-rentals", scheme);
      });

      // **A counter rental out to someone with no waiver on file** (issue
      // #2570, #2261): the Rentals list's "Waiver: …" word in the warning ink.
      // The opt-in `?rentalWaiverWarning=1` state lends Mask #1 to a new person.
      test(`the rentals view warns about a holder's waiver (${scheme})`, async ({
        page,
        request,
      }) => {
        const seeded = await request.post(
          "/api/test/seed-trouble-states?gearOut=1&rentalWaiverWarning=1",
        );
        expect(seeded.ok()).toBe(true);
        await page.goto("/shop/blue-mantis/gear?view=rentals");
        await page.getByRole("heading", { level: 1, name: "Gear" }).waitFor();
        const rentals = page.getByRole("region", { name: "Rentals" });
        await rentals.getByRole("link", { name: "Mask #1" }).waitFor();
        await rentals
          .getByText(/^Waiver: /)
          .first()
          .waitFor();
        await capture(page, "gear-register-rentals-waiver", scheme);
      });

      // The front desk's invoice builder. It redirects to Divers for a shop
      // that can't take money, so mark the demo shop connected first:
      // /api/test/seed-stripe-account is a pure DB write that never calls
      // Stripe (same use as the recap tip section above), and no order is
      // created here — this is the empty form, which is the whole surface.
      // Its own test also keeps that connected-shop write off every other
      // capture: a connected shop changes what several staff surfaces render.
      test(`the invoice builder renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        await request.post("/api/test/seed-stripe-account");
        await page.goto("/shop/blue-mantis/orders/new");
        await page.getByRole("heading", { level: 1, name: "New order" }).waitFor();
        await capture(page, "orders-new", scheme);
        await page.getByRole("button", { name: "Add another item", exact: true }).click();
        await page
          .locator('input[name="description-0"]')
          .filter({ visible: true })
          .fill("Two-tank reef trip");
        await page.locator('input[name="unitAmount-0"]').filter({ visible: true }).fill("129.00");
        await page
          .locator('input[name="description-1"]')
          .filter({ visible: true })
          .fill("Rental set");
        await page.locator('input[name="unitAmount-1"]').filter({ visible: true }).fill("35.00");
        await expect(page.getByText("$164.00", { exact: true })).toBeVisible();
        await capture(page, "orders-new-multiple-lines", scheme);
        await captureStickyFoot(page, "orders-new-subtotal", scheme);
      });
    });
  });
}
