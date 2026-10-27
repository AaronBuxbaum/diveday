/**
 * Visual captures: settings, orders, data export and import, and the team.
 *
 * One of the per-feature `e2e/visual-*.spec.ts` files; the capture mechanics are
 * `e2e/visual-harness.ts`, and the procedure is the e2e-and-visual skill.
 */
import { expect, signedInAsOwner, test } from "./fixtures";
import { openSettingsRow, openTripTab } from "./helpers";
import { E2E_FROZEN_CLOCK } from "./servers";
import {
  capture,
  FLOW_TIMEOUT_MS,
  installVisualBuildGuard,
  openDisputeSheet,
  openReefTrip,
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

      // The settings hub, the directory every shop setting hangs off.
      test(`shop settings render true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings");
        await page.getByRole("heading", { name: "Trip packing checklist" }).waitFor();
        // One row open in the capture, so the baseline shows the disclosure's
        // open-form treatment as well as the at-rest directory.
        await openSettingsRow(page, "Trip packing checklist");
        await capture(page, "settings-payments", scheme);
      });

      /**
       * What the shop rents and what it charges for it: one table with a tick
       * and a price box per piece, the terms and the service interval, one
       * save (#2815).
       */
      test(`the rentals page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/rentals");
        await page.getByRole("heading", { level: 1, name: "Rentals" }).waitFor();
        await page.getByRole("button", { name: "Save rentals" }).waitFor();
        await capture(page, "settings-rentals", scheme);
      });

      /**
       * The address card, open — one search box and the address it found (ADR
       * 20260811-address-is-one-search-box). It earns its own capture because
       * the row is closed in `settings-payments`, so the shape that replaced
       * five text boxes and a Save button is otherwise never looked at.
       *
       * The fleet configures no `PLACES_AWS_*` credentials, so this captures
       * the unconfigured state — the search box absent, its one sentence in
       * place of it — which is what every local and self-hosted instance sees,
       * and what the seeded shop's stored address and Remove control sit under.
       */
      test(`the shop address card renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings");
        await page.getByRole("heading", { name: "Shop address" }).waitFor();
        await openSettingsRow(page, "Shop address");
        await page.getByRole("button", { name: "Remove address" }).waitFor();
        await capture(page, "settings-address", scheme);
      });

      /**
       * The shop's fleet — a name, a capacity and a line of description per
       * hull, with the delete confirm that names how many departures one has
       * carried. Its own page rather than a hub row: a list plus an add form
       * stopped fitting inside a disclosure.
       */
      test(`the boats page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/boats");
        await page.getByRole("heading", { level: 1, name: "Boats" }).waitFor();
        const boat = page.locator('details[id^="boat-"]:not(#boat-new)').first();
        await boat.locator("summary").waitFor();
        await capture(page, "settings-boats", scheme);
        await boat.locator("summary").click();
        await boat.getByLabel(staffCopy("boats.nameLabel")).waitFor();
        await capture(page, "settings-boats-edit", scheme);
        await boat.locator("summary").click();
        await page.locator("#boat-new summary").click();
        await page.getByRole("button", { name: "Add a boat", exact: true }).waitFor();
        await capture(page, "settings-boats-add", scheme);
      });

      /**
       * The shop's trip tags (ADR 20260904-reef-all-the-way-down, decision 2)
       * — the list a diver then filters the public schedule by.
       */
      test(`the trip-tags page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/trip-tags");
        await page.getByRole("heading", { level: 1, name: "Trip tags" }).waitFor();
        await capture(page, "settings-trip-tags", scheme);
        const tag = page.locator('details[id^="tag-"]:not(#tag-new)').first();
        await tag.locator("summary").click();
        await tag.getByLabel(staffCopy("lenses.nameLabel")).waitFor();
        await capture(page, "settings-trip-tags-edit", scheme);
        await tag.locator("summary").click();
        await page.locator("#tag-new summary").click();
        await page.locator("#tag-new").getByLabel(staffCopy("lenses.nameLabel")).waitFor();
        await capture(page, "settings-trip-tags-add", scheme);
      });

      /**
       * The dock-day rhythm, open — six minute boxes and the live strip of
       * beats they produce (ADR 20260812-configurable-dock-day-rhythm). Its own
       * capture for the same reason the address card has one: the row is closed
       * in `settings-payments`, and this is the only place the form that
       * replaced a single arrival-call box is looked at. The preview strip
       * underneath is the part worth a baseline — it is the same arithmetic the
       * diver's booking page renders, so a change to the model that quietly
       * stops matching shows up as pixels here.
       */
      test(`the dock-day rhythm card renders true to the design (${scheme})`, async ({ page }) => {
        // A page of its own since #1854.
        await page.goto("/shop/blue-mantis/settings/dock-day");
        await page.getByRole("heading", { level: 1, name: "Dock-day rhythm" }).waitFor();
        await page.getByLabel("Surface interval between dives").waitFor();
        await capture(page, "settings-dock-day-rhythm", scheme);
      });

      /**
       * Saved emergency numbers and the response plan read at rest; the same
       * capture also opens the contact, plan and shore-alert editors so their
       * fixed-slot fields and consent controls remain visible in the baseline.
       */
      test(`the emergency reference card renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // A page of its own since #1854.
        await page.goto("/shop/blue-mantis/settings/emergency-reference");
        await page.getByRole("heading", { level: 1, name: "Emergency reference" }).waitFor();
        await page.getByRole("button", { name: "Save emergency reference" }).waitFor();
        await capture(page, "settings-emergency", scheme);
        const contact = page
          .locator('details[id^="emergency-contact-"]:not(#emergency-contact-new)')
          .first();
        await contact.locator("summary").click();
        await page.locator("#emergency-response summary").click();
        await page.locator("#emergency-alerts summary").click();
        await page.getByText(staffCopy("settings.main.emergency.shoreAlertDemo")).waitFor();
        await capture(page, "settings-emergency-edit", scheme);
        await contact.locator("summary").click();
        await page.locator("#emergency-response summary").click();
        await page.locator("#emergency-alerts summary").click();
        await page.locator("#emergency-contact-new summary").click();
        await page.locator('#emergency-contact-new input[name^="emergencyLabel-"]').waitFor();
        await capture(page, "settings-emergency-add", scheme);
      });

      /**
       * **Try the checks** (H-105): the disclosure on the Card checks row
       * (#2817), running the cert-check extension against its own sample
       * pages, after a run. The extension is
       * stood in for at the page's one seam, as the agency-check captures do:
       * it says hello as 1.5.0, passes every sample but NAUI's, and finds a
       * signed-in PADI tab. The report's time is the frozen clock's, and its
       * browser line is pinned here, so a Chromium update moves no pixel.
       */
      test(`the cert-check extension's try-it disclosure renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // Extension handshake plus two distinct result/report captures.
        test.setTimeout(FLOW_TIMEOUT_MS);
        await page.addInitScript(() => {
          Object.defineProperty(navigator, "userAgent", { get: () => "Chromium (visual capture)" });
          const announce = () => {
            document.documentElement.setAttribute("data-diveday-cert-check", "1.5.0");
            window.dispatchEvent(new Event("diveday-cert-check-ready"));
          };
          if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", announce);
          } else {
            announce();
          }
          window.addEventListener("message", (event) => {
            const data = event.data;
            if (data?.source !== "diveday-page") return;
            const answers: Record<string, object> = {
              hello: {
                ok: true,
                version: "1.5.0",
                agencies: ["ssi", "naui", "sdi", "gue", "cmas", "padi"],
                elearning: ["padi"],
              },
              "dry-run": {
                ok: true,
                filled: data.query?.agency !== "naui",
                typed: data.query?.agency !== "naui",
                submitted: data.query?.agency !== "naui",
                hostAccess: true,
                missing: data.query?.agency === "naui" ? ["birthDate"] : [],
              },
              "padi-session": { ok: true, padi: "signed_in" },
            };
            const answer = answers[data.type];
            if (!answer) return;
            window.postMessage(
              {
                source: "diveday-cert-check",
                type: "agency-check-result",
                requestId: data.requestId,
                ...answer,
              },
              window.location.origin,
            );
          });
        });
        await page.goto("/shop/blue-mantis/settings");
        await openSettingsRow(page, "Card checks");
        await page.getByText("Try the checks", { exact: true }).click();
        await page.getByText("Added to this browser (1.5.0)").first().waitFor();
        await page.getByRole("button", { name: "Run the checks" }).click();
        await page.getByText("Signed in", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Copy report" }).waitFor();
        await page.mouse.move(0, 0);
        await capture(page, "settings-cert-checks", scheme);
        await page.getByText(staffCopy("settings.certChecks.viewReport"), { exact: true }).click();
        await page.getByText(/"report": "diveday-cert-check-try"/).waitFor();
        await capture(page, "settings-cert-checks-report", scheme);
      });

      /**
       * The shop's prepaid dive packages — the price list, and the form that
       * adds one (issue #706). Its own page since that list plus a five-field
       * add form stopped fitting inside a directory row.
       *
       * The seeded shop sells none, so this photographs the empty state plus
       * the add form — which is exactly what a shop meets before the feature
       * turns itself on.
       */
      test(`the dive-packages page renders true to the design (${scheme})`, async ({ page }) => {
        // The old address lands on Promos' packages section (A26).
        await page.goto("/shop/blue-mantis/promos/packages");
        await page.getByRole("heading", { level: 2, name: "Dive packages" }).waitFor();
        await page.locator("#package-new summary").waitFor();
        await capture(page, "settings-dive-packages", scheme);
        await page.locator("#package-new summary").click();
        await page.getByRole("button", { name: "Add package", exact: true }).waitFor();
        await capture(page, "settings-dive-packages-add", scheme);
      });

      /**
       * The Features page (issue #2814): every on/off switch a shop owns, once.
       * It replaces the Stripe Tax card's own capture (`settings-tax`): the tax
       * switch is a row here, with the sentence that says what turning it on
       * does. Opening nothing and saving nothing, so the shared fixture's
       * `shops` flags are exactly as the capture found them (ADR
       * 20260815-per-test-private-shops); `e2e/tax.spec.ts` drives the switch
       * on a shop of its own.
       */
      test(`the features page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/features");
        await page.getByRole("heading", { level: 1, name: "Features" }).waitFor();
        await page.getByRole("button", { name: "Save" }).waitFor();
        await capture(page, "settings-features", scheme);
      });

      // Where a shop connects its own WhatsApp Business number (ADR
      // 20260802-whatsapp-embedded-signup). The fleet configures no META_*
      // credentials, so this captures the coming-soon state — which is what
      // every shop sees today, and where all of this surface's copy lives.
      test(`WhatsApp settings render true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/whatsapp");
        await page.getByRole("heading", { name: "No WhatsApp number connected" }).waitFor();
        await capture(page, "settings-whatsapp", scheme);
      });

      // Provider connections are disabled in the browser fleet because their
      // OAuth client secrets are not configured. The useful visual contract is
      // what a shop sees for a provider DiveDay has not switched on: one muted
      // line and no control, which should stay understandable as more providers
      // join the registry.
      test(`integrations settings render true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/integrations");
        await page.getByRole("heading", { level: 1, name: "Your data" }).waitFor();
        await capture(page, "settings-integrations", scheme);
      });

      /**
       * The two orders surfaces — the densest money screens in the app, and
       * until recently the only ones with no baseline at all. That gap was found
       * the honest way: the shop-currency change (ADR 20260731-shop-currency)
       * rewrote how every amount here is formatted, and the visual suite
       * reported nothing, because it had never looked. A surface whose whole
       * job is stating amounts is exactly where a silent pass is worthless.
       *
       * Both render the *order row's own* stored currency, not the shop's
       * current setting: a settled amount is evidence and is never
       * re-denominated by a later settings change.
       */
      test(`the orders list renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/orders");
        await page.getByRole("heading", { level: 1, name: "Money" }).waitFor();
        // A row of the day ledger itself, not just the heading — the ledger
        // streams in and a capture taken on the header alone banks an empty
        // page. (The table became day groups with slice 6f, ADR
        // 20260827-clearwater-surface-language.)
        await page.locator('ul[aria-labelledby^="orders-day-"] > li').first().waitFor();
        await capture(page, "orders", scheme);
      });

      /**
       * The same page on the shop's worst day: a Stripe call nobody confirmed,
       * and divers still owed money for a departure the shop cancelled.
       *
       * Both panels render *only* when something has gone wrong, which is
       * exactly why they had never been photographed — and they are the shape
       * most likely to break, being warning-toned blocks of dense prose with
       * inline links. /api/test/seed-trouble-states puts the demo shop into
       * that state; it is a test-only route rather than seed data because a
       * demo permanently shouting that payments are broken is a worse demo
       * (src/db/seed-front-desk.ts says so at the row it seeds `succeeded`).
       * Safe to mutate: each worker owns its own database and resets it before
       * every test (e2e/servers.ts).
       */
      test(`the orders list renders its unfinished money (${scheme})`, async ({
        page,
        request,
      }) => {
        await request.post("/api/test/seed-trouble-states?owedRefund=1");
        await page.goto("/shop/blue-mantis/orders");
        await page.getByRole("region", { name: "Payments that need a check" }).waitFor();
        await page.getByRole("region", { name: "Refunds you still owe" }).waitFor();
        await page.getByRole("region", { name: "Paid after the checkout closed" }).waitFor();
        await page.getByRole("region", { name: "Refunds that failed" }).waitFor();
        await capture(page, "orders-unconfirmed-and-owed", scheme);
      });

      /**
       * The one order that has given money back and is still holding some.
       *
       * `partly_refunded` arrived with the staff partial refund (issue #699)
       * and had no capture at all: the seeded example sorts onto a later page
       * of the index, so the only pixel that moved on the whole visual suite
       * was the pager counting one more order. A new money status, a new badge
       * tone, and the refund control's amount field — the actual new UI —
       * photographed nowhere, which is the silent pass the two comments above
       * were written about.
       *
       * Reached through the index's own `?status=` filter rather than a
       * hardcoded id, because the seeded order's uuid is regenerated on every
       * seed. This narrows *which order* is on screen, never the page itself —
       * the surface is captured whole, and the list it lands on is bounded by
       * the same pager the unfiltered one wears (AGENTS.md's rule is against
       * shrinking a capture to dodge an unbounded page, which this is not).
       */
      test(`a part-refunded order renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/orders?status=partly_refunded");
        await page
          .locator('ul[aria-labelledby^="orders-day-"] > li a[href*="/orders/"]')
          .filter({ visible: true })
          .first()
          .click();
        // "Diver record" for the reason the sibling capture below gives: the
        // eyebrow text is identical on the list this came from, so waiting on
        // it resolves instantly against the old page.
        await page.getByRole("link", { name: "Diver record" }).waitFor();
        // The refund control is the point of the capture, so the capture waits
        // for it rather than for the heading that arrives before it.
        await page.getByRole("button", { name: "Refund payment" }).waitFor();
        await capture(page, "order-detail-partly-refunded", scheme);
      });

      // One order in full: the total, and the per-line-item amounts that a
      // literal `$` and a hardcoded `/ 100` used to compose by hand.
      test(`an order's detail renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/orders");
        const ledgerRow = page.locator('ul[aria-labelledby^="orders-day-"] > li');
        await ledgerRow.filter({ visible: true }).first().waitFor();
        await ledgerRow.locator('a[href*="/orders/"]').filter({ visible: true }).first().click();
        // Not "Money": the index this just navigated from wears that word as
        // its own `<h1>`, already on screen, so waiting on it resolves
        // instantly against the *old* page instead of the new one — capture()
        // then fires while orders/[id] is still behind its own loading.tsx
        // skeleton. "Diver record" only exists on the detail page.
        await page.getByRole("link", { name: "Diver record" }).waitFor();
        await capture(page, "order-detail", scheme);
      });

      // An open demo order (market sheet 2026-10-22, item 6): Record payment
      // offers cash and the card machine as live buttons; Refresh and Void
      // stay disabled beside the demo note.
      test(`an open demo order's Record payment renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/orders?status=open&range=all");
        const ledgerRow = page.locator('ul[aria-labelledby^="orders-day-"] > li');
        await ledgerRow.filter({ visible: true }).first().waitFor();
        await ledgerRow.locator('a[href*="/orders/"]').filter({ visible: true }).first().click();
        await page.getByRole("button", { name: "Card machine", exact: true }).waitFor();
        await capture(page, "order-detail-open-demo", scheme);
      });

      // **The dispute sheet on screen** (issue #2390): a seat's order, the
      // signed release, the check-in and the roll call, reached the way an
      // owner reaches it, from the order's own "Dispute sheet" door.
      test(`a seat's dispute sheet renders true to the design (${scheme})`, async ({ page }) => {
        await openDisputeSheet(page);
        await capture(page, "order-dispute-sheet", scheme);
      });

      // A deposit names the departure it was raised for and what the seat
      // still owes (third UX review, item 32).
      test(`a deposit order's detail names its departure (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/orders?q=Trip+deposit");
        const ledgerRow = page.locator('ul[aria-labelledby^="orders-day-"] > li');
        await ledgerRow.filter({ visible: true }).first().waitFor();
        await ledgerRow.locator('a[href*="/orders/"]').filter({ visible: true }).first().click();
        await page.getByRole("link", { name: "Open the departure" }).waitFor();
        await capture(page, "order-detail-deposit", scheme);
      });

      /**
       * The one data-out surface: the "your data is yours" promise, concrete,
       * in both halves (ADR 20260806-one-data-out-surface) — the bundle you
       * would download now, and the weekly copy already landing in storage the
       * shop owns. The `settings-backup` capture retired into this one; the
       * seed ships blue-mantis configured with six weekly deliveries and one
       * failed week, so the backup half still photographs doing its real job:
       * proving where the data went and naming the week it didn't.
       */
      test(`the data-export page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/export");
        await page.getByRole("heading", { level: 1, name: "Your data" }).waitFor();
        // The crew sheet (N-43) is the second thing that leaves this page.
        await page.getByRole("heading", { name: "Crew sheet" }).waitFor();
        await capture(page, "settings-export", scheme);
      });

      // The Backups tab of the same page set: the destination and the delivery
      // history, which used to sit under the download on one long page.
      test(`the backups tab renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/export/backups");
        await page.getByRole("heading", { level: 1, name: "Your data" }).waitFor();
        await page.getByRole("heading", { name: "Delivery history" }).waitFor();
        // The history rows, not just the heading — the table is half the
        // surface, and a capture taken on the heading alone banks an empty one.
        await page.getByRole("cell", { name: "Failed" }).waitFor();
        await capture(page, "settings-backups", scheme);
      });

      // The shop's activity log (D5): who did what, to what, when, across the
      // whole team, with its four filters above the first page of lines.
      test(`the activity log renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/activity");
        await page.getByRole("heading", { level: 1, name: "Activity" }).waitFor();
        // The lines, not just the heading: a capture on the heading alone banks
        // the skeleton's list.
        await page.getByTestId("shop-activity").getByRole("listitem").first().waitFor();
        await capture(page, "settings-activity", scheme);
      });

      // The import surface: the honesty table stating what does and doesn't
      // come across, before any file is chosen.
      test(`the data-import page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/import");
        await page.getByText("What comes across", { exact: true }).waitFor();
        await capture(page, "settings-import", scheme);
      });

      // A bookings export that holds seats sold for after today (market sheet
      // 2026-10-22, item 3): the preview counts them, names the system the
      // guide came from, and lists them. The browser's clock is the frozen
      // one, so "today" is the seed's day and the list never moves.
      test(`the import preview lists bookings after today (${scheme})`, async ({ page }) => {
        await page.clock.install({ time: E2E_FROZEN_CLOCK });
        await page.goto("/shop/blue-mantis/settings/import?from=fareharbor");
        await page
          .locator('input[type="file"][data-hydrated="true"]')
          .filter({ visible: true })
          .waitFor({ state: "attached" });
        await page.setInputFiles('input[type="file"]', {
          name: "bookings.csv",
          mimeType: "text/csv",
          buffer: Buffer.from(
            [
              "Customer Name,Email,Booking Date,Tour Name,Booking Status,Total,Booking ID",
              "Hana Kobayashi,hana.k@example.com,2026-06-12,Two-tank Molasses Reef,Completed,$165.00,FH-1",
              "Hana Kobayashi,hana.k@example.com,2026-08-14,Night dive Benwood,Booked,$95.00,FH-2",
              "Sam Reed,sam.r@example.com,2026-08-29,Discover Scuba,Booked,$120.00,FH-3",
              "Ada Brooks,ada.b@example.com,2026-09-05,Two-tank Molasses Reef,Booked,$165.00,FH-4",
            ].join("\n"),
            "utf-8",
          ),
        });
        await page.getByRole("list", { name: /bookings are after today/ }).waitFor();
        await capture(page, "settings-import-bookings-after-today", scheme);
      });

      // Import's "Gear history" tab: the gear CSV importer.
      test(`the gear-history import tab renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/settings/import?what=gear");
        await page.getByRole("link", { name: "Download gear CSV template" }).waitFor();
        await capture(page, "settings-gear-import", scheme);
      });

      // The other half of `dive_sites.csv`: the bundle carried the shop's whole
      // library for a year while nothing could read one back (issue #1771).
      test(`the dive-site import tab renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/import?what=dive-sites");
        await page.getByRole("button", { name: "Import dive sites" }).waitFor();
        await capture(page, "settings-dive-site-import", scheme);
      });

      /**
       * Settings' "Data" group when the shop owes work it has
       * not finished: photos removed from the app but still in storage, and an
       * erased diver's records still sitting at Stripe. Danger-toned, and the
       * only place either obligation is ever stated — an unfinished erasure is
       * a legal duty, not a notification. Empty on nearly every real day, and
       * therefore never photographed until this capture.
       */
      test(`settings shows the deletions that didn't finish (${scheme})`, async ({
        page,
        request,
      }) => {
        await request.post("/api/test/seed-trouble-states");
        await page.goto("/shop/blue-mantis/settings");
        await page.getByRole("region", { name: "Photos that didn’t finish deleting" }).waitFor();
        await page.getByRole("region", { name: "Erasures not finished at Stripe" }).waitFor();
        await capture(page, "settings-data-unfinished", scheme);
      });

      // The embed settings page (docs ADR 20260726-schedule-embed). The fleet
      // now runs against a configured non-loopback APP_HOST (E2E_APP_HOST in
      // e2e/servers.ts), so this baseline is the generated-snippet state a
      // real deploy shows — the two SnippetField boxes and the copy buttons —
      // rather than the "hosting isn't configured" warning it was stuck on
      // while publicAppUrl() returned null here.
      test(`the embed settings render true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/embed");
        await page.getByRole("heading", { name: "Website embed" }).waitFor();
        // The snippets are a Client Component; wait for a control it only
        // renders once mounted before shooting.
        await page.getByRole("button", { name: "Copy" }).first().waitFor();
        await capture(page, "settings-embed", scheme);
      });

      // The team surface at rest: inviting staff, and a roster whose rows read
      // their roles as words behind a disclosure — the page-level "Save
      // changes" is gone (ADR 20260827-the-shops-shelves, slice 9h).
      test(`the team settings render true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/team");
        await page.getByRole("heading", { level: 1, name: "Team" }).waitFor();
        await capture(page, "settings-team", scheme, { darkPhone: true });
        const credentials = page.locator('details[id^="credentials-"]').first();
        await expect(credentials).toBeVisible();
        await credentials.locator("summary").click();
        await capture(page, "team-member-credential-summary", scheme, {
          darkPhone: true,
          beforeShot: async () => {
            const summary = credentials.locator("summary");
            const label = summary.getByText(staffCopy("staffing.credentials.heading"), {
              exact: true,
            });
            const value = summary.locator(":scope > span").last();
            await expect(label).toContainText("Credentials");
            await expect(value).toHaveText(
              staffCopy("staffing.credentials.onFileCount", { count: 3 }),
            );
            await expect(credentials.locator("ul")).toContainText("Emergency First Response");
            const labelBox = await label.boundingBox();
            const valueBox = await value.boundingBox();
            if (!labelBox || !valueBox) throw new Error("Credential summary did not render");
            expect(
              labelBox.x + labelBox.width <= valueBox.x + 1 ||
                labelBox.y + labelBox.height <= valueBox.y + 1,
            ).toBe(true);
            expect(
              await value.evaluate((element) => element.scrollWidth <= element.clientWidth),
            ).toBe(true);
          },
        });
      });

      test(`the dock rider editor keeps mixed controls on their own rows (${scheme})`, async ({
        page,
      }) => {
        await openReefTrip(page);
        await openTripTab(page, "Manifest");
        await page.locator("#dock-rider summary").click();
        const form = page.getByTestId("dock-rider-form");
        await capture(page, "manifest-dock-rider-controls", scheme, {
          beforeShot: async () => {
            const date = form.locator('input[name="dateOfBirth"]');
            const aboard = form.getByRole("group", { name: "Aboard as" });
            await expect(date).toBeVisible();
            await expect(aboard).toBeVisible();
            const dateBox = await date.boundingBox();
            const aboardBox = await aboard.boundingBox();
            if (!dateBox || !aboardBox) throw new Error("Dock rider controls did not render");
            expect(aboardBox.y).toBeGreaterThanOrEqual(dateBox.y + dateBox.height);
          },
        });
      });

      // One row's roles open, which is the state that has no still image
      // anywhere else: the checkbox grid inset in the row it belongs to, with
      // no Save button beneath it because closing the row is the save.
      test(`the team roles disclosure renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/team");
        await page.getByRole("heading", { level: 1, name: "Team" }).waitFor();
        const roles = page.getByRole("button", { name: /^Edit roles for / }).first();
        await roles.click();
        await expect(roles).toHaveAttribute("aria-expanded", "true");
        await capture(page, "team-role-disclosure", scheme);
      });

      // The shop's own pre-departure checklist: seeded lines
      // (src/db/seed-pre-departure-checklist.ts), the reorder/delete controls
      // beside each, and the add form (ADR 20260824-pre-departure-safety-check).
      test(`the pre-departure checklist settings render true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/safety-checklist");
        await page.getByRole("heading", { level: 1, name: "Pre-departure checklist" }).waitFor();
        await page.getByText("VHF radio checked").waitFor();
        await capture(page, "settings-safety-checklist", scheme);
        await page.locator("#checklist-new summary").click();
        await page.getByLabel(staffCopy("settings.safetyChecklist.addLabel")).waitFor();
        await capture(page, "settings-safety-checklist-add", scheme);
      });

      /**
       * **The first DiveDay screen a new hire ever sees**, and nothing had ever
       * looked at it. It has an `error.tsx` of its own — somebody thought about
       * its failure path — while its happy path went uncaptured because
       * `check:route-coverage` counted `staff-invite.spec.ts` as coverage and
       * passed (issue #727).
       *
       * Driven through the real invite, because the token is hashed at rest and
       * `/api/test/seed-account-token` will only re-mint for an account that
       * already exists — `inviteStaffMember` is what creates it (ADR
       * 20260726-staff-invite-accounts). Deterministic email, not `Date.now()`:
       * a wall-clock value here is a permanent diff between CI runs, not a
       * regression (same reasoning as the onboarding capture).
       */
      test(`the staff invite page renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const email = `invite-capture-${scheme}@example.com`;
        await page.goto("/shop/blue-mantis/settings/team");
        // The invite form opens from its button under the team (ideas item 58).
        const inviteSection = page.locator("#invite");
        await inviteSection.locator("summary").click();
        await inviteSection.getByLabel("Full name").fill("Priya Nair");
        await inviteSection.getByLabel("Email").fill(email);
        await inviteSection.getByLabel("Instructor", { exact: true }).check();
        await inviteSection.getByRole("button", { name: "Send invite" }).click();
        await expect(page.getByText("Invite sent")).toBeVisible();

        const seeded = await request.post("/api/test/seed-account-token", {
          data: { email, purpose: "invite" },
        });
        expect(seeded.ok()).toBe(true);
        const { token } = (await seeded.json()) as { token: string };

        await page.goto(`/invite/${token}`);
        // Streams behind a loading.tsx — wait for the page's own h1, the same
        // signal every other account-lifecycle capture here gates on.
        await page.locator("h1").first().waitFor();
        await page.getByLabel("Password", { exact: true }).waitFor();
        await capture(page, "staff-invite", scheme);
      });

      // Calendar subscriptions, in the un-subscribed state: both scopes
      // offered to an owner, neither yet minted. Deliberately not the
      // just-minted state — that panel shows a live feed token, which is
      // different on every run and would never match a baseline.
      test(`the calendar settings render true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/calendar");
        // Wait on the panel's own button, not the page's <h1>: the panels are
        // Client Components, and per this file's rule a server-rendered
        // heading resolves before the interesting part has mounted.
        await page.getByRole("button", { name: "Create subscription link" }).first().waitFor();
        await capture(page, "settings-calendar", scheme);
      });

      // The staffer's own Email settings: the Monday email's row, on for the
      // owner by default, with its preview door, and the after-hours ping's.
      test(`the email settings render true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/email");
        await page
          .getByRole("region", { name: "After-hours messages" })
          .getByRole("switch")
          .waitFor();
        await capture(page, "settings-email", scheme);
      });

      // The Monday email itself, as the preview renders it from the frozen
      // clock's week of the seeded demo shop: the one capture of an email body.
      test(`the Monday email renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/email/preview");
        await page.getByText(/Weeks run Monday to Sunday|no email goes out this Monday/).waitFor();
        await capture(page, "weekly-digest-email", scheme);
      });
    });
  });
}
