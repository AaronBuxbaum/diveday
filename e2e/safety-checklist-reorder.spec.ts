import type { Page } from "@playwright/test";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, makeActivitySafe, test } from "./fixtures";

const staff = staffTranslator("en-US");
const LABELS = ["Reorder A flares", "Reorder B radio", "Reorder C anchor"] as const;

const rows = (page: Page) => page.locator("#checklist-heading + ol > li");
const move = (row: ReturnType<typeof rows>, direction: "up" | "down") =>
  row.getByRole("button", {
    name: staff(
      direction === "up" ? "settings.safetyChecklist.moveUp" : "settings.safetyChecklist.moveDown",
    ),
    exact: true,
  });

async function shownLabels(page: Page): Promise<string[]> {
  const all = await rows(page).allInnerTexts();
  return all
    .map((text) => text.trim())
    .filter((text) => LABELS.some((label) => text.includes(label)))
    .map((text) => LABELS.find((label) => text.includes(label)) as string);
}

// A shop of its own: this writes the shop's checklist, which the per-test reset does not restore.
test("one row form moves a line up and down, with and without JavaScript", async ({
  page,
  browser,
  privateShop,
}) => {
  // Three lines added through the form, then two contexts: a long journey, not a slow step.
  test.setTimeout(45_000);
  const path = `/shop/${privateShop.slug}/safety-checklist`;
  await page.goto(path);
  for (const label of LABELS) {
    await page.getByText(staff("settings.safetyChecklist.addTitle"), { exact: true }).click();
    await page.getByLabel(staff("settings.safetyChecklist.addLabel"), { exact: true }).fill(label);
    await page
      .getByRole("button", { name: staff("settings.safetyChecklist.addSubmit"), exact: true })
      .click();
    await expect(page.getByText(staff("settings.safetyChecklist.notice.added"))).toBeVisible();
    await expect(rows(page).filter({ hasText: label })).toHaveCount(1);
  }
  await expect.poll(() => shownLabels(page)).toEqual([...LABELS]);

  // Edges: the first row cannot go up, the last cannot go down.
  await expect(move(rows(page).first(), "up")).toBeDisabled();
  await expect(move(rows(page).last(), "down")).toBeDisabled();
  await expect(move(rows(page).last(), "up")).toBeEnabled();

  const middle = rows(page).filter({ hasText: LABELS[1] });
  await move(middle, "up").click();
  await expect.poll(() => shownLabels(page)).toEqual([LABELS[1], LABELS[0], LABELS[2]]);
  await move(rows(page).filter({ hasText: LABELS[1] }), "down").click();
  await expect.poll(() => shownLabels(page)).toEqual([...LABELS]);

  // The same move through a native form post, with scripts off.
  const native = await browser.newContext({
    javaScriptEnabled: false,
    baseURL: new URL(page.url()).origin,
    storageState: await page.context().storageState(),
  });
  try {
    const nativePage = makeActivitySafe(await native.newPage());
    await nativePage.goto(path);
    await expect(rows(nativePage).filter({ hasText: LABELS[1] })).toHaveCount(1);
    await move(rows(nativePage).filter({ hasText: LABELS[1] }), "up").click();
    await expect.poll(() => shownLabels(nativePage)).toEqual([LABELS[1], LABELS[0], LABELS[2]]);
    await move(rows(nativePage).filter({ hasText: LABELS[2] }), "up").click();
    await expect.poll(() => shownLabels(nativePage)).toEqual([LABELS[1], LABELS[2], LABELS[0]]);
  } finally {
    await native.close();
  }
});
