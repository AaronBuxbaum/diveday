import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, makeActivitySafe, signedInAsOwner, test } from "./fixtures";
import { signInAs } from "./helpers";

const staff = staffTranslator("en-US");
const newDiver = "/shop/blue-mantis/divers/new";

signedInAsOwner();

test("latest input survives immediate internal navigation, Back, and a fresh document", async ({
  page,
}) => {
  await page.goto(newDiver);
  const name = "Draft Navigation Diver";
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      Boolean(response.request().headers()["next-action"]) &&
      Boolean(response.request().postData()?.includes(name)),
  );
  await page.getByLabel(staff("divers.page.fullNameLabel")).fill(name);
  // No blur wait: the visible navigation must preserve the last input even
  // while the draft's 600ms debounce is still pending.
  await page
    .getByRole("navigation", { name: "Main", exact: true })
    .getByRole("link", { name: "Divers", exact: true })
    .click();
  await expect(page).toHaveURL(/\/divers$/);
  expect((await saved).ok()).toBe(true);
  await page.goBack();
  await expect(page.getByLabel(staff("divers.page.fullNameLabel"))).toHaveValue(name);
  // A document navigation excludes React's preserved Activity tree as the
  // source of recovery; these values must have reached the server draft.
  await page.goto(newDiver);
  await expect(page.getByLabel(staff("divers.page.fullNameLabel"))).toHaveValue(name);
  await expect(
    page.getByRole("button", { name: staff("shared.formDraft.startOver") }),
  ).toBeVisible();
});

test("blur and a completed save remain a positive draft recovery control", async ({ page }) => {
  await page.goto(newDiver);
  const name = "Draft Blur Diver";
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      Boolean(response.request().headers()["next-action"]) &&
      Boolean(response.request().postData()?.includes(name)),
  );
  await page.getByLabel(staff("divers.page.fullNameLabel")).fill(name);
  await page.getByLabel(staff("divers.page.fullNameLabel")).blur();
  expect((await saved).ok()).toBe(true);
  await page.goto(newDiver);
  await expect(page.getByLabel(staff("divers.page.fullNameLabel"))).toHaveValue(name);
});

test("successful submission waits for a pending draft save and leaves no recoverable draft", async ({
  page,
}) => {
  await page.goto(newDiver);
  const name = "Draft Submitted Diver";
  let releaseSave = () => {};
  let sawSave = () => {};
  const saveStarted = new Promise<void>((resolve) => {
    sawSave = resolve;
  });
  const saveReleased = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route(`**${newDiver}`, async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.postData()?.includes("new_diver")) {
      sawSave();
      await saveReleased;
    }
    await route.continue();
  });
  try {
    await page.getByLabel(staff("divers.page.fullNameLabel")).fill(name);
    await page.getByLabel(staff("divers.page.fullNameLabel")).blur();
    await saveStarted;
    await page.getByRole("button", { name: staff("divers.page.addDiver"), exact: true }).click();
    releaseSave();
    await page.waitForURL(/\/divers\/[a-f0-9-]+\?edit=1$/);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await page.goto(newDiver);
    await expect(page.getByLabel(staff("divers.page.fullNameLabel"))).toHaveValue("");
    await expect(
      page.getByRole("button", { name: staff("shared.formDraft.startOver") }),
    ).toHaveCount(0);
  } finally {
    releaseSave();
    await page.unroute(`**${newDiver}`);
  }
});

test("an old form cannot put its input into a replacement account's draft", async ({ page }) => {
  await page.goto(newDiver);
  const staffContext = page.context();
  const replacementPage = makeActivitySafe(await staffContext.newPage());
  try {
    // Replace the cookie in the shared browser without refreshing the first
    // tab. It still holds the form and bound actions from the original owner.
    await staffContext.clearCookies();
    await signInAs(replacementPage, DEV_STAFF_LOGINS.captain);
    const name = "Old account private draft input";
    const staleSave = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        Boolean(response.request().headers()["next-action"]) &&
        Boolean(response.request().postData()?.includes(name)),
    );
    await page.getByLabel(staff("divers.page.fullNameLabel")).fill(name);
    await page
      .getByRole("navigation", { name: "Main", exact: true })
      .getByRole("link", { name: "Divers", exact: true })
      .click();
    await expect(page).toHaveURL(/\/divers$/);
    expect((await staleSave).ok()).toBe(true);
    await replacementPage.goto(newDiver);
    await expect(replacementPage.getByLabel(staff("divers.page.fullNameLabel"))).toHaveValue("");
    await expect(
      replacementPage.getByRole("button", { name: staff("shared.formDraft.startOver") }),
    ).toHaveCount(0);
  } finally {
    await replacementPage.close();
  }
});
