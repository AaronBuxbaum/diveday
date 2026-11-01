import type { Page } from "@playwright/test";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, test } from "./fixtures";

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

/** Three lines added through the form, in order, on the page the shop's checklist opens at. */
async function addLines(page: Page, path: string): Promise<void> {
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
}

// A shop of its own: this writes the shop's checklist, which the per-test reset does not restore.
test("one row form moves a line up and down", async ({ page, privateShop }) => {
  // The mint and sign-in plus three adds under a loaded runner: a long journey, not a slow step.
  test.setTimeout(30_000);
  await addLines(page, `/shop/${privateShop.slug}/safety-checklist`);

  // Edges: the first row cannot go up, the last cannot go down.
  await expect(move(rows(page).first(), "up")).toBeDisabled();
  await expect(move(rows(page).last(), "down")).toBeDisabled();
  await expect(move(rows(page).last(), "up")).toBeEnabled();

  const middle = rows(page).filter({ hasText: LABELS[1] });
  await move(middle, "up").click();
  await expect.poll(() => shownLabels(page)).toEqual([LABELS[1], LABELS[0], LABELS[2]]);
  await move(rows(page).filter({ hasText: LABELS[1] }), "down").click();
  await expect.poll(() => shownLabels(page)).toEqual([...LABELS]);
});

// The post works without JavaScript because the row is one plain form: both move buttons are
// submit buttons of the same form, which carries the item. A context with scripts off cannot be
// driven here: the streamed rows stay hidden behind the loading skeleton, so nothing is clickable.
test("both move buttons of a row submit the same form, so the post needs no script", async ({
  page,
  privateShop,
}) => {
  test.setTimeout(30_000);
  await addLines(page, `/shop/${privateShop.slug}/safety-checklist`);

  const middle = rows(page).filter({ hasText: LABELS[1] });
  // `has` is matched inside each form, so the button is looked up from the page, not from the row.
  const form = middle
    .locator("form")
    .filter({
      has: page.getByRole("button", {
        name: staff("settings.safetyChecklist.moveUp"),
        exact: true,
      }),
    });
  await expect(form).toHaveCount(1);
  await expect(form.locator("button[type=submit][name=direction][value=up]")).toHaveCount(1);
  await expect(form.locator("button[type=submit][name=direction][value=down]")).toHaveCount(1);
  await expect(form.locator("input[type=hidden][name=itemId]")).toHaveCount(1);
});
