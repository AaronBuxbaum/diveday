import type { Locator, Page } from "@playwright/test";
import { diverTranslator } from "../src/i18n/messages";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";
import {
  bookASeatAndOpenThread,
  choosePartySize,
  offlineCopySaved,
  openIfClosed,
  openOnThisPhone,
  openThreadStep,
  openTripTab,
  threadStatus,
  tripPathByTitle,
} from "./helpers";
import { PAYMENT_HISTORY_CSV } from "./payment-history-fixture";
import type { AuditCapture } from "./visual-audit-capture";

const diver = diverTranslator("en-US");
const staff = staffTranslator("en-US");
const REEF = "Two-Tank Reef — Molasses & French";

async function openPublicTrip(page: Page, title: string) {
  await page.goto("/s/blue-mantis");
  // Schedule links name the date, time and capacity as well as the title.
  // Pick the row by its exact heading, then follow its own departure link.
  await page
    .getByRole("list", { name: diver("schedule.tripListLabel") })
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { level: 3, name: title, exact: true }) })
    .getByRole("link", { name: title })
    .click();
  await page.waitForURL(/\/s\/blue-mantis\/trips\//);
}

async function bookThread(page: Page, name = "Lena Ortiz", email = "lena.review@example.com") {
  await openPublicTrip(page, REEF);
  await bookASeatAndOpenThread(page, name, email);
  await threadStatus(page).waitFor();
}

function nestedEditor(container: Locator, selector: string) {
  return container.locator(`details:has(${selector})`).last();
}

async function openEditorSection(page: Page, id: string) {
  // A closed section is a row of the page's disclosure list (visual review
  // 2026-10-24, A11); the open ones are still `EditorSection`s.
  const row = page.locator(`details#${id}`);
  if ((await row.count()) > 0) {
    await openIfClosed(row);
    await expect(
      row.locator("input, select, textarea, button").filter({ visible: true }).first(),
    ).toBeVisible();
    return;
  }
  const section = page.locator(`[data-editor-section="${id}"]`);
  await expect(section.locator("[data-section-preview][data-preview-ready]")).toHaveCount(1);
  const trigger = section.locator(`button[aria-controls="${id}-body"]`);
  if ((await trigger.isVisible()) && (await trigger.getAttribute("aria-expanded")) !== "true") {
    await trigger.click();
  }
  const body = page.locator(`#${id}-body`);
  await expect(body).toBeVisible();
  await expect(
    body.locator("input, select, textarea, button").filter({ visible: true }).first(),
  ).toBeVisible();
}

async function offlineReef(page: Page) {
  await page.goto(await tripPathByTitle(page, "blue-mantis", REEF));
  await openTripTab(page, "Manifest");
  await offlineCopySaved(page);
  // Activation is the event the next shell navigation depends on, rather
  // than whether the already-loaded manifest has been claimed by the worker.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker?.getRegistration("/");
        return registration?.active?.state ?? registration?.installing?.state ?? "no registration";
      }),
    )
    .toBe("activated");
  await openOnThisPhone(page);
  await page.getByRole("link", { name: "Open offline roll call" }).click();
  await page.waitForURL(/offline-manifest/);
  await page.getByRole("heading", { name: "Priya Sharma", exact: true }).waitFor();
}

/** Bodies hidden behind a second tap on otherwise covered light-mode pages. */
export function registerRemainingExpandedAuditCaptures(
  capture: AuditCapture,
  flowTimeout: number,
  captureAudit: AuditCapture = capture,
) {
  test.describe("light mode — team and course-form expanded controls", () => {
    signedInAsOwner();
    test.use({ colorScheme: "light", viewport: { width: 1280, height: 800 } });

    test("a team member opens the languages they can speak", async ({ page }) => {
      await page.goto("/shop/blue-mantis/settings/team");
      const languages = page.locator('details[id^="languages-"]').first();
      await openIfClosed(languages);
      await languages.getByRole("checkbox").first().waitFor();
      await capture(page, "team-member-languages-editor", "light");
    });

    test("a team member opens their own emergency-contact fields", async ({ page }) => {
      await page.goto("/shop/blue-mantis/settings/team");
      const contact = page.locator('details[id^="emergency-contact-"]').first();
      await openIfClosed(contact);
      await contact.locator('input[name="emergencyContactName"]').waitFor();
      await capture(page, "team-member-emergency-contact-editor", "light");
    });

    test("a team member opens the credentials held on their record", async ({ page }) => {
      await page.goto("/shop/blue-mantis/settings/team");
      const credentials = page.locator('details[id^="credentials-"]').first();
      await openIfClosed(credentials);
      await credentials.getByRole("link", { name: staff("staffing.credentials.add") }).waitFor();
      await capture(page, "team-member-credentials-open", "light");
    });

    test("inviting a teammate opens the full name, address and role choices", async ({ page }) => {
      await page.goto("/shop/blue-mantis/settings/team");
      const invite = page.locator("#invite");
      await openIfClosed(invite);
      await invite.getByLabel(staff("settings.team.invite.fullNameLabel")).fill("Rosa Delgado");
      await invite
        .getByLabel(staff("settings.team.invite.emailLabel"))
        .fill("rosa.review@example.com");
      await capture(page, "team-invite-editor", "light");
    });

    test("adding a credential opens its issuer, number and renewal fields", async ({ page }) => {
      await page.goto("/shop/blue-mantis/settings/team");
      const credential = page.locator("#add-credential");
      await openIfClosed(credential);
      await credential.locator('select[name="personId"]').selectOption({ label: "Keiko Tanaka" });
      await credential.locator('input[name="name"]').fill("EFR Instructor");
      await capture(page, "team-add-credential-editor", "light");
    });

    test("the course-form ledger opens an existing version's editable wording", async ({
      page,
    }) => {
      await page.goto("/shop/blue-mantis/waivers");
      await openIfClosed(page.locator("#course-forms"));
      const editor = page
        .locator('#course-forms details[id^="course-form-"]:not(#course-form-new)')
        .first();
      await openIfClosed(editor);
      await editor.locator('textarea[name="body"]').waitFor();
      await capture(page, "waivers-course-form-edit", "light");
    });

    test("adding a course form opens its blank wording and medical choice", async ({ page }) => {
      await page.goto("/shop/blue-mantis/waivers");
      await openIfClosed(page.locator("#course-forms"));
      const editor = page.locator("#course-form-new");
      await openIfClosed(editor);
      await editor.locator('input[name="title"]').fill("Boat orientation acknowledgement");
      await editor.locator('textarea[name="body"]').waitFor();
      await capture(page, "waivers-course-form-add", "light");
    });
  });

  test.describe("light mode — remaining gear and money editors", () => {
    signedInAsOwner();
    test.use({ colorScheme: "light", viewport: { width: 1280, height: 800 } });

    test("a work order opens the diver's add-piece form", async ({ page }) => {
      await page.goto("/shop/blue-mantis/gear/work-orders/new?diverq=Diego+Alvarez");
      await page.getByRole("link", { name: "Diego Alvarez", exact: true }).first().click();
      const piece = page.locator("#add-piece");
      await openIfClosed(piece);
      await piece.getByLabel(staff("workOrders.form.brandModel")).fill("Apeks XTX50");
      await capture(page, "work-order-add-piece-editor", "light");
    });

    test("a gear unit opens its identity and purchase fields", async ({ page }) => {
      await page.goto("/shop/blue-mantis/gear");
      await page.getByRole("link", { name: "Reg #1", exact: true }).click();
      // The identity fields open from the header's "Edit details" (visual
      // review 2026-10-24, A19), into the unit's one summary panel.
      await page.getByRole("link", { name: staff("gear.unit.details.edit") }).click();
      await page.waitForURL(/[?&]edit=details/);
      await page
        .locator("#unit-details")
        .filter({ visible: true })
        .locator('input[name="serialNumber"]')
        .waitFor();
      await capture(page, "gear-unit-details-editor", "light");
    });

    test("renting to a diver without a card opens the counter's card-seen form", async ({
      page,
    }) => {
      await page.goto("/shop/blue-mantis/gear/rentals/new?q=Rowan");
      await page.getByRole("link", { name: "Rent to Rowan Feld", exact: true }).click();
      const card = page
        .locator("details")
        .filter({
          has: page.locator("summary", { hasText: staff("counterRentals.new.cards.seen") }),
        })
        .last();
      await openIfClosed(card);
      await card.locator('input[name="identifier"]').fill("PADI-OW-44109");
      await capture(page, "counter-rental-card-seen-editor", "light");
    });

    test("Orders opens the imported-history rows beneath their provenance", async ({ page }) => {
      test.setTimeout(flowTimeout);
      await page.goto("/shop/blue-mantis/settings/import");
      await expect(page.locator('input[type="file"]:visible')).toHaveAttribute(
        "data-hydrated",
        "true",
      );
      await page.setInputFiles('input[type="file"]', {
        name: "payment-history.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(PAYMENT_HISTORY_CSV, "utf-8"),
      });
      await page.getByRole("button", { name: "Import 1 contact" }).click();
      await page
        .getByText(staff("settings.import.wizard.result.paymentHistoryLineOther", { count: 2 }))
        .waitFor();
      await page.goto("/shop/blue-mantis/orders");
      const history = page.getByRole("region", {
        name: staff("orders.index.importedHistory.sectionLabel"),
      });
      await openIfClosed(history.locator("details").first());
      await history.getByRole("table").waitFor();
      await capture(page, "orders-imported-history-open", "light");
    });
  });

  test.describe("light mode — Today horizon bodies", () => {
    signedInAs("captain");
    test.use({ colorScheme: "light", viewport: { width: 1280, height: 800 } });

    test("the captain opens the desk's folded work", async ({ page }) => {
      await page.goto("/shop/blue-mantis");
      const desk = page
        .locator("details")
        .filter({
          has: page.locator("summary h3", { hasText: /desk/i }),
        })
        .first();
      await openIfClosed(desk);
      await expect(desk).toHaveAttribute("open", "");
      await capture(page, "today-captain-desk-work-open", "light");
    });

    test("Tomorrow opens the next day's departure stations", async ({ page }) => {
      await page.goto("/shop/blue-mantis");
      const tomorrow = page
        .locator("details")
        .filter({
          has: page.locator("summary h2", { hasText: /^Tomorrow/ }),
        })
        .first();
      await openIfClosed(tomorrow);
      await expect(tomorrow.locator(":scope > div").first()).toBeVisible();
      await capture(page, "today-tomorrow-horizon-open", "light");
    });

    test("This week opens its work", async ({ page }) => {
      await page.goto("/shop/blue-mantis");
      const week = page
        .locator("details")
        .filter({
          has: page.locator("summary h2", { hasText: staff("shopHome.spine.week") }),
        })
        .first();
      await openIfClosed(week);
      await expect(week.locator(":scope > div").first()).toBeVisible();
      await capture(page, "today-week-horizon-open", "light");
    });
  });

  test.describe("light mode — returning-diver nested changes", () => {
    test.use({ colorScheme: "light", viewport: { width: 1280, height: 800 } });

    test("each returning-diver fact opens the form that owns it", async ({ page, request }) => {
      test.setTimeout(flowTimeout);
      await bookThread(page);
      const seeded = await request.post("/api/test/seed-returning-diver", {
        data: { shopSlug: "blue-mantis", email: "lena.review@example.com" },
      });
      expect(seeded.ok()).toBe(true);
      await page.goto(new URL(page.url()).pathname);
      const changes = await openThreadStep(page, "changes");
      const sizes = changes.locator("details").first();
      await openIfClosed(sizes);
      await sizes.getByRole("button", { name: diver("rental.saveFit") }).waitFor();
      await capture(page, "thread-change-rental-sizes-editor", "light");
      await sizes.locator(":scope > summary").click();
      const tanks = nestedEditor(changes, "#changed-tanks");
      await openIfClosed(tanks);
      await tanks.locator("#changed-tanks").waitFor();
      await capture(page, "thread-change-tanks-editor", "light");
      await tanks.locator(":scope > summary").click();
      const contact = nestedEditor(changes, "#changed-contact-name");
      await openIfClosed(contact);
      await contact.locator("#changed-contact-phone").waitFor();
      await capture(page, "thread-change-emergency-contact-editor", "light");
    });
  });

  test.describe("light mode — diver card-entry bodies and seat composer", () => {
    test.use({ colorScheme: "light", viewport: { width: 1280, height: 800 } });

    test("the certification step opens the level-card fields and pending outcome", async ({
      page,
    }) => {
      test.setTimeout(flowTimeout);
      await bookThread(page);
      const certification = await openThreadStep(page, "certification");
      const card = nestedEditor(certification, 'select[name="level"]');
      await openIfClosed(card);
      await card.locator('select[name="agency"]').selectOption("padi");
      await card.locator('select[name="level"]').selectOption("open_water");
      await card.locator('input[name="identifier"]').fill("PADI-OW-44218");
      await capture(page, "thread-level-card-entry-open", "light");
      await card.getByRole("button", { name: diver("ready.certSubmit") }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "Certification added" }),
      ).toBeVisible();
      await openThreadStep(page, "certification");
      await capture(page, "thread-level-card-pending-review", "light");
    });

    test("the optional nitrox card opens its agency, number and gas explanation", async ({
      page,
    }) => {
      await bookThread(page);
      const certification = await openThreadStep(page, "certification");
      const card = certification
        .locator("details")
        .filter({
          has: page.locator("summary", { hasText: diver("ready.nitroxCertHeading") }),
        })
        .last();
      await openIfClosed(card);
      await card.locator('input[name="identifier"]').fill("EANX-55128");
      await capture(page, "thread-nitrox-card-entry-open", "light");
    });

    test("a Night departure opens the specialty-card form", async ({ page }) => {
      await openPublicTrip(page, "Night Dive — City of Washington");
      await bookASeatAndOpenThread(page, "Nora Quinn", "nora.night.review@example.com");
      const certification = await openThreadStep(page, "certification");
      const specialty = nestedEditor(certification, 'input[name="specialty"][value="night"]');
      await openIfClosed(specialty);
      await specialty.locator('input[name="identifier"]').fill("NIGHT-77108");
      await capture(page, "thread-specialty-card-entry-open", "light");
    });

    test("the not-certified answer opens its consequence and confirmation", async ({ page }) => {
      await bookThread(page);
      const certification = await openThreadStep(page, "certification");
      await certification
        .getByRole("button", { name: diver("ready.certNotYetButton"), exact: true })
        .click();
      await certification
        .getByRole("button", { name: diver("ready.certNotYetConfirmButton"), exact: true })
        .waitFor();
      await capture(page, "thread-not-certified-confirmation", "light");
    });

    test("the party section opens the friend's name beside its Add-seat action", async ({
      page,
    }) => {
      await bookThread(page);
      const add = page.locator("#add-seat");
      await openIfClosed(add);
      await add.locator('input[name="seatName"]').fill("Maya Chen");
      await capture(page, "thread-add-seat-editor", "light");
    });

    test("the party link disclosure shows the complete claim URL", async ({ page }) => {
      test.skip(
        process.env.VISUAL_EXHAUSTIVE_AUDIT !== "1",
        "A raw claim URL is a random bearer credential, so this state is audited without a reusable baseline.",
      );
      await openPublicTrip(page, REEF);
      await choosePartySize(page, 2);
      await page.getByLabel("Diver 2 name", { exact: true }).fill("Maya Chen");
      await page.getByLabel("Use main contact’s email").check();
      await bookASeatAndOpenThread(page, "Lena Ortiz", "lena.party.review@example.com");
      const seat = page.locator("#party-seats li").filter({ hasText: "Maya Chen" });
      await openIfClosed(seat.locator("details").first());
      await seat.locator("p.font-mono").waitFor();
      await captureAudit(page, "party-seat-claim-link-open", "light");
    });
  });

  test.describe("light mode — offline manifest expanded controls", () => {
    signedInAsOwner();
    test.use({ colorScheme: "light", viewport: { width: 1280, height: 800 } });

    test("the saved roster opens the person's contact and rental facts", async ({ page }) => {
      test.setTimeout(flowTimeout);
      await offlineReef(page);
      const row = page
        .locator("#offline-roll-call li")
        .filter({
          has: page.getByRole("heading", { name: "Priya Sharma", exact: true }),
        })
        .first();
      const facts = row.locator("details:not([data-roll-call-exception])").first();
      await openIfClosed(facts);
      await expect(facts.locator(":scope > div")).toBeVisible();
      await capture(page, "offline-diver-contact-and-gear-open", "light");
    });

    test("the saved roster opens its deliberate dock exception", async ({ page }) => {
      test.setTimeout(flowTimeout);
      await offlineReef(page);
      const exception = page.locator("#offline-roll-call [data-roll-call-exception]").first();
      await openIfClosed(exception);
      await exception.getByRole("button").first().waitFor();
      await capture(page, "offline-dock-exception-open", "light");
    });

    test("the saved roster opens the after-dive exception and sighting-note field", async ({
      page,
    }) => {
      test.setTimeout(flowTimeout);
      await offlineReef(page);
      await page.getByRole("button", { name: "After dive 1", exact: true }).click();
      const exception = page.locator("#offline-roll-call [data-roll-call-exception]").first();
      await openIfClosed(exception);
      await exception.getByRole("textbox").waitFor();
      await capture(page, "offline-after-dive-exception-open", "light");
    });

    test("a vibration-capable device opens the saved copy's phone preferences", async ({
      page,
    }) => {
      test.setTimeout(flowTimeout);
      // Device capability only; the app still reads and renders its real switch.
      await page.addInitScript(() =>
        Object.defineProperty(navigator, "vibrate", { configurable: true, value: () => true }),
      );
      await offlineReef(page);
      await openIfClosed(page.locator("#offline-phone-settings"));
      await page.locator("#offline-phone-settings").getByRole("switch").waitFor();
      await capture(page, "offline-phone-preferences-open", "light");
    });
  });

  test.describe("light mode — public filters, answers and capability lists", () => {
    test.use({ colorScheme: "light", viewport: { width: 1280, height: 800 } });

    test("the public schedule opens its filters without shrinking the schedule", async ({
      page,
    }) => {
      await page.goto("/s/blue-mantis");
      // "More filters" is a button that opens the form's own panel since the
      // row became one row (visual review 2026-10-24, B18), not a <details>.
      const tripType = page.locator('select[name="tripType"]');
      await expect(tripType).toHaveAttribute("data-hydrated", "true");
      const more = page.locator('form:has(select[name="tripType"]) button[aria-expanded]');
      if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
      await page.locator('select[name="canDive"]').waitFor();
      await capture(page, "public-schedule-filters-open", "light");
    });

    test("the public course opens a real answer beneath its question", async ({ page }) => {
      await page.goto("/s/blue-mantis/courses/open-water-diver");
      const answer = page.locator("#faqs details").first();
      await openIfClosed(answer);
      await answer.locator("p").waitFor();
      await capture(page, "public-course-faq-answer-open", "light");
    });

    test("the product directory opens the full capability list for a feature", async ({ page }) => {
      await page.goto("/product");
      const capabilities = page.locator("main details").first();
      await openIfClosed(capabilities);
      await capabilities.getByRole("listitem").first().waitFor();
      await capture(page, "marketing-feature-capabilities-open", "light");
    });
  });

  test.describe("light mode — course editor phone section bodies", () => {
    signedInAsOwner();
    test.use({ colorScheme: "light", viewport: { width: 1280, height: 800 } });
    test.beforeEach(async ({ page }) => {
      await page.goto("/shop/blue-mantis/courses/open-water-diver/edit");
    });

    test("the course pitch opens its actual fields on a phone", async ({ page }) => {
      await capture(page, "course-editor-pitch-open", "light", {
        beforeShot: () => openEditorSection(page, "pitch"),
      });
    });
    test("the course pricing opens its actual fields on a phone", async ({ page }) => {
      await capture(page, "course-editor-pricing-open", "light", {
        beforeShot: () => openEditorSection(page, "pricing"),
      });
    });
    test("the course photos open their actual controls on a phone", async ({ page }) => {
      await capture(page, "course-editor-photos-open", "light", {
        beforeShot: () => openEditorSection(page, "photos"),
      });
    });
    test("the course at-a-glance group opens its actual fields on a phone", async ({ page }) => {
      await capture(page, "course-editor-glance-open", "light", {
        beforeShot: () => openEditorSection(page, "glance"),
      });
    });
    test("the course enrollment group opens its actual fields on a phone", async ({ page }) => {
      await capture(page, "course-editor-enrollment-open", "light", {
        beforeShot: () => openEditorSection(page, "enroll"),
      });
    });
    test("the course fee inclusions open their actual fields on a phone", async ({ page }) => {
      await capture(page, "course-editor-fee-covers-open", "light", {
        beforeShot: () => openEditorSection(page, "fee-covers"),
      });
    });
    test("the course learning materials open their actual fields on a phone", async ({ page }) => {
      await capture(page, "course-editor-materials-open", "light", {
        beforeShot: () => openEditorSection(page, "learningMaterialsJson"),
      });
    });
    test("the course day-by-day group opens its actual fields on a phone", async ({ page }) => {
      await capture(page, "course-editor-day-by-day-open", "light", {
        beforeShot: () => openEditorSection(page, "scheduleDaysJson"),
      });
    });
    test("the course FAQ group opens its actual fields on a phone", async ({ page }) => {
      await capture(page, "course-editor-faq-open", "light", {
        beforeShot: () => openEditorSection(page, "faq"),
      });
    });
    test("the course forms group opens its actual choices on a phone", async ({ page }) => {
      await capture(page, "course-editor-required-forms-open", "light", {
        beforeShot: () => openEditorSection(page, "forms"),
      });
    });
  });

  test.describe("light mode — dive-site editor phone section bodies", () => {
    signedInAsOwner();
    test.use({ colorScheme: "light", viewport: { width: 1280, height: 800 } });
    test.beforeEach(async ({ page }) => {
      await page.goto("/shop/blue-mantis/dive-sites");
      await page.getByRole("link", { name: "Molasses Reef", exact: true }).first().click();
      await page.getByRole("heading", { level: 1, name: "Molasses Reef", exact: true }).waitFor();
    });

    test("the site identity opens its actual fields on a phone", async ({ page }) => {
      await capture(page, "site-editor-about-open", "light", {
        beforeShot: () => openEditorSection(page, "briefing-about"),
      });
    });
    test("the site forecast opens its actual fields on a phone", async ({ page }) => {
      await capture(page, "site-editor-forecast-open", "light", {
        beforeShot: () => openEditorSection(page, "briefing-forecast"),
      });
    });
    test("the site route opens its actual editor on a phone", async ({ page }) => {
      await capture(page, "site-editor-route-open", "light", {
        beforeShot: () => openEditorSection(page, "briefing-route"),
      });
    });
    test("the site photos open their actual controls on a phone", async ({ page }) => {
      await capture(page, "site-editor-photos-open", "light", {
        beforeShot: () => openEditorSection(page, "briefing-photos"),
      });
    });
    test("the site underwater group opens its actual fields on a phone", async ({ page }) => {
      await capture(page, "site-editor-underwater-open", "light", {
        beforeShot: () => openEditorSection(page, "briefing-underwater"),
      });
    });
    test("the site dive group opens its actual fields on a phone", async ({ page }) => {
      await capture(page, "site-editor-dive-open", "light", {
        beforeShot: () => openEditorSection(page, "briefing-dive"),
      });
    });
    test("the site planning group opens its actual fields on a phone", async ({ page }) => {
      await capture(page, "site-editor-planning-open", "light", {
        beforeShot: () => openEditorSection(page, "briefing-planning"),
      });
    });
    test("the site fit group opens its actual fields on a phone", async ({ page }) => {
      await capture(page, "site-editor-fit-open", "light", {
        beforeShot: () => openEditorSection(page, "briefing-fit"),
      });
    });
    test("the site landmarks open their actual fields on a phone", async ({ page }) => {
      await capture(page, "site-editor-landmarks-open", "light", {
        beforeShot: () => openEditorSection(page, "briefing-landmarks"),
      });
    });
    test("the site field guide opens its actual choices on a phone", async ({ page }) => {
      await capture(page, "site-editor-field-guide-open", "light", {
        beforeShot: () => openEditorSection(page, "briefing-field-guide"),
      });
    });
    test("the site certification group opens its actual choices on a phone", async ({ page }) => {
      await capture(page, "site-editor-certification-open", "light", {
        beforeShot: () => openEditorSection(page, "briefing-certification"),
      });
    });
  });
}
