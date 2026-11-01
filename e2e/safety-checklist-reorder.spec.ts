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

// Its own test: a context with scripts off has no hydration to wait for, and a step that hangs
// there must not take the scripted journey's budget with it.
test("the same move works as a native form post with scripts off", async ({
  page,
  browser,
  privateShop,
}) => {
  test.setTimeout(30_000);
  const path = `/shop/${privateShop.slug}/safety-checklist`;
  await addLines(page, path);

  const native = await browser.newContext({
    javaScriptEnabled: false,
    baseURL: new URL(page.url()).origin,
    storageState: await page.context().storageState(),
  });
  // Unbounded by default, so a post that never answers would spend the whole test budget and
  // surface only as a failed `close()`. Ten seconds names the step that hung instead.
  native.setDefaultTimeout(10_000);
  native.setDefaultNavigationTimeout(10_000);
  try {
    const nativePage = makeActivitySafe(await native.newPage());
    // `commit`: with scripts off the staff hydration wait could never finish.
    await nativePage.goto(path, { waitUntil: "commit" });
    await expect(rows(nativePage).filter({ hasText: LABELS[1] })).toHaveCount(1);
    // diveday:allow-e2e-hygiene pre-hydration-click: scripts are off in this context, so the press is a native form post and there is no hydration to beat.
    await move(rows(nativePage).filter({ hasText: LABELS[1] }), "up").click();
    await expect.poll(() => shownLabels(nativePage)).toEqual([LABELS[1], LABELS[0], LABELS[2]]);
    // diveday:allow-e2e-hygiene pre-hydration-click: scripts are off in this context, so the press is a native form post and there is no hydration to beat.
    await move(rows(nativePage).filter({ hasText: LABELS[2] }), "up").click();
    await expect.poll(() => shownLabels(nativePage)).toEqual([LABELS[1], LABELS[2], LABELS[0]]);
  } finally {
    await native.close();
  }
});
