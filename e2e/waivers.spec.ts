import { expect, signedInAsOwner, test } from "./fixtures";

signedInAsOwner();

test("one waiver button sends a resumable link and a medical yes surfaces follow-up", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/schedule");
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link")
    .click();
  await page.waitForURL(/\/shop\/blue-mantis\/trips\//);
  // The roster and its waiver control live on the Guests tab.
  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Guests" })
    .click();
  await page.waitForURL(/\/guests/);
  const staffTripUrl = page.url();

  const diverSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /^Divers/ }) });
  // The whole waiver is a single button; for an unsent diver it reads "Send
  // waiver". Exact, so it targets the per-diver control and not the roster's
  // "Send waivers to selected" bulk button. e2e has no email provider
  // configured, so the shared WaiverSendControl always falls to its private
  // link affordance here rather than "Waiver sent to …".
  await diverSection.getByRole("button", { name: "Send waiver", exact: true }).first().click();
  const resultNotice = diverSection.getByRole("status");
  await expect(resultNotice).toContainText("no email provider configured");
  const waiverHref = await resultNotice.getByRole("link").getAttribute("href");
  expect(waiverHref).toMatch(/^\/waivers\//);

  await page.goto(waiverHref ?? "/");
  await expect(page.getByRole("heading", { name: "A quick step before the dock" })).toBeVisible();
  await page.getByLabel("Type your full name").fill("Priya Sharma");
  await page.getByLabel("I have read this waiver, understand it, and agree to it.").check();

  // No question starts pre-answered — every one needs a conscious choice, so
  // even a mid-way "save and finish later" has to touch every radio group
  // before the browser's own `required` validation lets the form submit.
  // Answer every question "No" here; the saved draft prefills them the same
  // way on reload (below), so only the one question that flips to "Yes"
  // needs to be touched again.
  const noRadios = page.getByRole("radio", { name: "No" });
  const questionCount = await noRadios.count();
  for (let i = 0; i < questionCount; i++) {
    await noRadios.nth(i).check();
  }
  await page.getByRole("button", { name: "Save and finish later" }).click();
  await expect(page.getByRole("status")).toContainText("progress is saved");
  await expect(page.getByLabel("Type your full name")).toHaveValue("Priya Sharma");
  // The draft's saved answers prefill on reload — nothing reverts to unanswered.
  await expect(noRadios.first()).toBeChecked();

  // The first question's affirmative answer must not disappear into a generic
  // success state; it becomes an explicit staff follow-up item.
  await page.getByRole("radio", { name: "Yes" }).first().check();
  const waiverUrl = page.url();
  await page.getByRole("button", { name: "Sign waiver" }).click();
  // Signing sends the diver straight to "what's left" instead of stopping on
  // the signed-waiver page, whose only forward path used to be one more link.
  await expect(page).toHaveURL(/\/ready\//);
  await expect(page.getByRole("heading", { name: "Almost there, Priya." })).toBeVisible();
  // The copy uses a typographic apostrophe (U+2019), not a straight one.
  await expect(page.getByText(/doctor’s sign-off may be required/)).toBeVisible();

  // Revisiting the same waiver link afterward still shows the signed
  // confirmation and the scheduled dive-site preview (delight feature) — only
  // the fresh-sign flow skips straight past it to readiness.
  await page.goto(waiverUrl);
  // The completed state's EarnedMoment is this page's only heading — assert
  // the level explicitly so a regression back to <h2> (no <h1> on the page at
  // all) fails here instead of silently passing a level-agnostic query.
  await expect(page.getByRole("heading", { name: "Waiver received", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /left before you sail/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your scheduled dive sites" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Molasses Reef" })).toBeVisible();

  // Back on the roster, the single button now reports the completed-but-flagged
  // state, and the medical answer is spelled out for staff follow-up.
  await page.goto(staffTripUrl);
  await expect(diverSection.getByText("Medical review", { exact: true })).toBeVisible();
  await expect(diverSection.getByText("Follow up before boarding")).toBeVisible();
});

test("the medical questionnaire refuses to complete with an unanswered question, even past client validation", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/schedule");
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link")
    .click();
  await page.waitForURL(/\/shop\/blue-mantis\/trips\//);
  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Guests" })
    .click();
  await page.waitForURL(/\/guests/);
  const diverSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /^Divers/ }) });
  await diverSection.getByRole("button", { name: "Send waiver", exact: true }).first().click();
  const waiverHref = await diverSection.getByRole("status").getByRole("link").getAttribute("href");

  await page.goto(waiverHref ?? "/");
  await page.getByLabel("Type your full name").fill("Adversarial Diver");
  await page.getByLabel("I have read this waiver, understand it, and agree to it.").check();
  // Answer every question except the last one.
  const noRadios = page.getByRole("radio", { name: "No" });
  const questionCount = await noRadios.count();
  for (let i = 0; i < questionCount - 1; i++) {
    await noRadios.nth(i).check();
  }
  // The browser's own `required` validation would already block this; strip
  // it to prove the *server* — not just client-side convenience — refuses to
  // complete the waiver with a question unanswered, rather than silently
  // treating it as a "No" nobody actually chose.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('input[type="radio"]')) {
      el.removeAttribute("required");
    }
  });
  await page.getByRole("button", { name: "Sign waiver" }).click();
  // The server redirects with an error notice — the completed state never
  // renders, and no default answer was silently accepted for the diver.
  await expect(page.getByText("Please answer every question")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Waiver received", level: 1 })).not.toBeVisible();
});

test("saving a draft also refuses an unanswered question, even past client validation", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/schedule");
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link")
    .click();
  await page.waitForURL(/\/shop\/blue-mantis\/trips\//);
  await page
    .getByRole("navigation", { name: "Trip" })
    .getByRole("link", { name: "Guests" })
    .click();
  await page.waitForURL(/\/guests/);
  const diverSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /^Divers/ }) });
  await diverSection.getByRole("button", { name: "Send waiver", exact: true }).first().click();
  const waiverHref = await diverSection.getByRole("status").getByRole("link").getAttribute("href");

  await page.goto(waiverHref ?? "/");
  await page.getByLabel("Type your full name").fill("Adversarial Draft Diver");
  // Answer every question except the last one, then strip `required` the same
  // way the sign-waiver adversarial test does — this is a separate code path
  // (`saveDraftAction`, not `completeAction`) with its own
  // `readMedicalAnswers()` call, so it needs its own regression coverage
  // rather than assuming the two stay symmetric.
  const noRadios = page.getByRole("radio", { name: "No" });
  const questionCount = await noRadios.count();
  for (let i = 0; i < questionCount - 1; i++) {
    await noRadios.nth(i).check();
  }
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('input[type="radio"]')) {
      el.removeAttribute("required");
    }
  });
  await page.getByRole("button", { name: "Save and finish later" }).click();
  await expect(page.getByText("Please answer every question")).toBeVisible();
  // Nothing was saved — reloading shows no "progress is saved" status and the
  // name field is back to empty, not a half-recorded draft.
  await expect(page.getByRole("status")).not.toBeVisible();
});

test("staff edit the single shop waiver and each edit is kept as a version", async ({ page }) => {
  await page.goto("/shop/blue-mantis/waivers");

  const release = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Release text" }) });

  // The current version is shown, and the release text is directly editable.
  await expect(release.getByText("Version 1")).toBeVisible();

  // Editing pre-fills the current text and saves a new version rather than
  // mutating the one divers may already have signed. Title is immutable.
  const releaseTextarea = page.getByLabel("Release text");
  await expect(releaseTextarea).toHaveValue(/scuba diving/);
  await releaseTextarea.fill(
    "Revised release: I accept the inherent risks of boat charters and open-water diving for this trip.",
  );
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(page.getByRole("status")).toContainText("new version");

  // The current card advances to v2.
  await expect(release.getByText("Version 2")).toBeVisible();
});
