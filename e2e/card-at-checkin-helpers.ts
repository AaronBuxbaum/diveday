import type { Page } from "@playwright/test";
import { diverTranslator } from "../src/i18n/messages";
import { expect } from "./fixtures";
import { bookASeatAndOpenThread, openNamedScheduleTrip, openThreadStep } from "./helpers";

const t = diverTranslator("en-US");

export async function openCardAtCheckIn(page: Page) {
  await page.goto("/s/blue-mantis");
  await openNamedScheduleTrip(page, "Two-Tank Reef — Christ of the Abyss");
  await bookASeatAndOpenThread(page, "Casey Card", "casey-card@example.com");
  const step = await openThreadStep(page, "certification");
  const disclosure = step
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: t("ready.certAtCheckIn") }) });
  await disclosure.locator("summary").click();
  await disclosure.getByLabel(t("ready.certAgency")).selectOption("padi");
  await disclosure.getByLabel(t("ready.certLevel")).selectOption("open_water");
  await expect(disclosure.locator('[name="identifier"]')).toHaveCount(0);
  return disclosure;
}

export async function saveCardAtCheckIn(page: Page) {
  const disclosure = await openCardAtCheckIn(page);
  await disclosure.getByRole("button", { name: t("ready.certAtCheckIn"), exact: true }).click();
  // FlashParams consumes ?saved=cert on hydration; the refreshed row is the
  // durable action outcome. Await it before reloading to prove persistence.
  await expect(
    page.locator('[data-thread-step="certification"]').filter({ visible: true }),
  ).toContainText(t("ready.checklistDetail.certificationSelfDeclared"));
  await page.reload();
  const step = await openThreadStep(page, "certification");
  await expect(step.getByText(t("ready.checklistDetail.certificationSelfDeclared"))).toBeVisible();
  await expect(step).toContainText("With the shop");
  return step;
}
