/** Spanish operations states and keyboard interactions, captured at both harness widths. */
import { staffTranslator } from "../src/i18n/staff-messages";
import { escapeRegExp } from "../src/lib/escape-regexp";
import { formatMoneyCents } from "../src/lib/format";
import { expect, test } from "./fixtures";
import { openTripTab, tripPathByTitle } from "./helpers";
import { capture, FLOW_TIMEOUT_MS, installVisualBuildGuard, SPANISH } from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: FLOW_TIMEOUT_MS });
test.use({ locale: SPANISH, colorScheme: "light" });
const t = staffTranslator(SPANISH);
const money = (cents: number) => formatMoneyCents(cents, "usd", SPANISH);
const photograph = (page: Parameters<typeof capture>[0], name: string) =>
  capture(page, name, "light", { locale: SPANISH });

test.describe("recorded money", () => {
  test.use({ privateShopSlug: "spanish-money-review", privateShopFacts: ["operationsVisual"] });
  test("Spanish due and received drafts, populated day and reachable receipt tax", async ({
    page,
    privateShop,
  }) => {
    await page.goto(`/shop/${privateShop.slug}/orders?purchase=1`);
    const form = page.getByRole("form", { name: t("orders.purchase.title"), exact: true });
    await form
      .locator('[name="description-0"]')
      .fill("Alquiler de regulador para la salida de mañana");
    await form.locator('[name="unitAmount-0"]').fill("25");
    await form.getByLabel(t("orders.purchase.reference"), { exact: true }).fill("TERMINAL-ES-42");
    await form.getByRole("radio", { name: t("orders.localDue.open"), exact: true }).check();
    await expect(form.getByText(`${t("orders.localDue.gross")}:`, { exact: false })).toBeVisible();
    await expect(
      form.getByRole("button", { name: t("orders.localDue.submit"), exact: true }),
    ).toBeDisabled();
    await photograph(page, "operations-due-draft");
    await form.getByRole("radio", { name: t("orders.purchase.received"), exact: true }).check();
    await expect(form.getByLabel(t("orders.purchase.reference"), { exact: true })).toHaveValue(
      "TERMINAL-ES-42",
    );
    await expect(form.locator('[name="description-0"]')).toHaveValue(
      "Alquiler de regulador para la salida de mañana",
    );
    await expect(form.locator("output")).toHaveText(money(2500));
    await expect(form.getByText(`${t("orders.purchase.gross")}:`, { exact: false })).toBeVisible();
    await photograph(page, "operations-received-draft");
    await page.goto(`/shop/${privateShop.slug}/orders`);
    const day = page.locator("summary").filter({ hasText: t("orders.purchaseDay.title") });
    await day.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText(t("orders.purchaseDay.scope"), { exact: true })).toBeVisible();
    const identity = page.getByText("Shore Recovery Diver", { exact: true });
    await expect(identity).toBeVisible();
    await photograph(page, "operations-receipt-day");
    const fact = privateShop.values.operationsVisual as { orderId: string };
    await page.goto(`/shop/${privateShop.slug}/orders/${fact.orderId}`);
    const tax = page.getByText(t("orders.purchase.includedTax"), { exact: true });
    await tax.scrollIntoViewIfNeeded();
    await expect(tax).toBeInViewport();
    await expect(page.getByText("COUNTER-1042", { exact: false })).toBeVisible();
    await photograph(page, "operations-receipt-tax");
  });
});

test.describe("recovery and goodwill", () => {
  test.use({ privateShopSlug: "spanish-recovery-review", privateShopFacts: ["operationsVisual"] });
  test("Spanish prepared classroom copy and expanded promotional ledger", async ({
    page,
    privateShop,
  }) => {
    const fact = privateShop.values.operationsVisual as {
      sourceTripId: string;
      personId: string;
      activityId: string;
    };
    await page.goto(`/shop/${privateShop.slug}/trips/${fact.sourceTripId}?blowout=1`);
    const roster = page.locator("summary").filter({ hasText: t("blowout.classroom.divers") });
    await roster.focus();
    await page.keyboard.press("Enter");
    const copy = page.getByRole("region", { name: t("blowout.classroom.offerCopy"), exact: true });
    await expect(copy).toBeVisible();
    const inquiry = copy.getByRole("link");
    const href = await inquiry.getAttribute("href");
    expect(href).toMatch(/^https:\/\//);
    if (!href) throw new Error("prepared inquiry URL missing");
    const url = new URL(href);
    expect(url.searchParams.get("recoveryActivity")).toBe(fact.activityId);
    expect(url.hash).toBe("#classroom-request");
    await expect(inquiry).toHaveText(href);
    await expect(page.getByText(t("blowout.classroom.confirmed"), { exact: true })).toBeVisible();
    await photograph(page, "operations-classroom-prepared");
    await roster.focus();
    await page.keyboard.press("Space");
    await expect(copy).toBeHidden();
    await page.goto(`/shop/${privateShop.slug}/divers/${fact.personId}`);
    const credit = page.locator("summary").filter({ hasText: t("divers.tripCredit.title") });
    await credit.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText(t("divers.tripCredit.policy"), { exact: true })).toBeVisible();
    await expect(page.getByText(t("divers.tripCredit.history"), { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: t("divers.tripCredit.apply", { amount: money(6000) }),
        exact: true,
      }),
    ).toBeEnabled();
    await photograph(page, "operations-goodwill-history");
  });
});

test.describe("contact import", () => {
  test.use({ privateShopSlug: "spanish-import-review" });
  test("Spanish import diagnostics and a fresh file after successful import", async ({
    page,
    privateShop,
  }) => {
    await page.goto(`/shop/${privateShop.slug}/settings/import?what=dive-sites`);
    await page.locator('input[type="file"]').setInputFiles({
      name: "dive_sites.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "name,description,latitude,longitude\nArrecife de revisión,Un sitio con descripción larga para revisar las columnas,25,-80",
      ),
    });
    const preview = page.getByRole("region", {
      name: `${t("gear.import.existing.preview")}: dive_sites.csv`,
      exact: true,
    });
    await expect(preview).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    // Anchor keyboard navigation without opening the native select popup,
    // which can consume its closing Tab while retaining focus on the select.
    const lastMapping = page.getByLabel("4. longitude", { exact: true });
    await lastMapping.focus();
    await expect(lastMapping).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(preview).toBeFocused();
    // Chromium exposes the actual overflowing inner table shell in its tab order.
    await page.keyboard.press("Tab");
    await expect(preview.locator(".table-scroll-shell")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => preview.locator(".table-scroll-shell").evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);
    await photograph(page, "operations-import-keyboard-preview");
    await page.goto(`/shop/${privateShop.slug}/settings/import`);
    const input = page.locator('input[type="file"]').filter({ visible: true });
    await expect(input).toHaveAttribute("data-hydrated", "true");
    await input.setInputFiles({
      name: "contacts-es.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "Guest,Mailbox,Medical Notes\nMarina Importada,marina-es@example.com,Do not import medical data",
      ),
    });
    await page.getByLabel("Guest", { exact: true }).selectOption("full_name");
    await page.getByLabel("Mailbox", { exact: true }).selectOption("email");
    await expect(
      page.getByText(t("settings.import.wizard.manualEvidenceNotice"), { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: t("settings.import.wizard.checkMatches"), exact: true })
      .click();
    await expect(
      page.getByText(t("settings.import.wizard.outcomes.create"), { exact: true }),
    ).toBeVisible();
    await photograph(page, "operations-import-diagnostics");
    await page
      .getByRole("button", { name: t("settings.import.wizard.submitOne"), exact: true })
      .click();
    const result = t("settings.import.wizard.result.summary", {
      addedPart: t("settings.import.wizard.result.summaryAddedOne", { added: 1 }),
      updatedPart: t("settings.import.wizard.result.summaryUpdatedOther", { updated: 0 }),
    });
    await expect(page.getByText(result, { exact: true })).toBeVisible();
    await input.setInputFiles({
      name: "next-es.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("full_name,email\nMarina Importada,marina-es@example.com"),
    });
    await page
      .getByRole("button", { name: t("settings.import.wizard.checkMatches"), exact: true })
      .click();
    await expect(
      page.getByText(t("settings.import.wizard.outcomes.update"), { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(result, { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: t("settings.import.wizard.submitOne"), exact: true }),
    ).toBeEnabled();
    await page.goto(`/shop/${privateShop.slug}/settings/import?what=gear`);
    await page.locator('input[type="file"]').setInputFiles({
      name: "gear.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Tag,serviced_on\nPREVIEW-TANK,2026-01-01\nBROKEN,no-date"),
    });
    await page.getByLabel("1. Tag", { exact: true }).selectOption("gear_label");
    await page.getByRole("button", { name: t("gear.import.existing.review"), exact: true }).click();
    await expect(
      page.getByRole("link", { name: t("gear.import.existing.correction"), exact: true }),
    ).toBeVisible();
    const gearPreview = page.getByRole("region", {
      name: `${t("gear.import.existing.preview")}: gear.csv`,
      exact: true,
    });
    await expect(
      gearPreview.getByText(t("gear.import.existing.issues.invalid_service_date"), { exact: true }),
    ).toBeVisible();
    await expect(gearPreview.getByText("invalid_service_date", { exact: false })).toHaveCount(0);
    await photograph(page, "operations-import-correction");
  });
});

test.describe("course preparation", () => {
  test.use({ privateShopSlug: "spanish-course-review" });
  test("Spanish missing course requirements and follow-up ownership", async ({
    page,
    privateShop,
  }) => {
    await page.goto(
      await tripPathByTitle(page, privateShop.slug, /Advanced Open Water Diver/, { daysOut: 29 }),
    );
    await openTripTab(page, "Trip");
    const section = page.locator('section[aria-labelledby="course-preparation"]');
    await expect(
      section.getByRole("heading", { name: t("trips.coursePulse.heading"), exact: true }),
    ).toBeVisible();
    const missing = new RegExp(
      (["forms", "card", "payment", "materials", "staff"] as const)
        .map((item) => escapeRegExp(t(`trips.coursePulse.items.${item}`)))
        .join("|"),
    );
    await expect(section.getByRole("listitem").filter({ hasText: missing }).first()).toBeVisible();
    await section
      .getByRole("button", { name: /^Tomar el seguimiento de / })
      .first()
      .click();
    await expect(
      section.getByText(t("trips.coursePulse.followup.inProgress"), { exact: false }).first(),
    ).toBeVisible();
    await photograph(page, "operations-course-requirements");
  });
});
