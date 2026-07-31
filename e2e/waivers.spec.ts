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
  // The trip this waiver is for is named on the page itself (task 42) — a
  // diver can verify what they're signing for instead of trusting a link
  // that only ever named the shop.
  await expect(page.getByText(/Two-Tank Reef — Molasses & French —/)).toBeVisible();
  // The link's own expiry is stated on the page, not just in the email that
  // sent it (task 51).
  await expect(page.getByText(/This link works until/)).toBeVisible();
  // The footer's "need help" link goes to the shop's own contact channel, not
  // DiveDay's marketing homepage (a regression this page used to have).
  await expect(page.getByRole("link", { name: "Contact Blue Mantis Divers" })).toHaveAttribute(
    "href",
    "mailto:hello@demo.invalid",
  );
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
  const firstFieldset = page.locator("fieldset").first();
  await firstFieldset.getByRole("radio", { name: "Yes" }).check();
  // Task 41: the reassurance line reveals right under that question the
  // moment "Yes" is picked — repeated at the point of anxiety, not just once
  // in the small print above the whole questionnaire. Every question renders
  // the same reassurance text (only the one under a checked "Yes" is
  // actually visible via CSS), so this is scoped to the one fieldset that
  // was just checked rather than matching all eight and hitting Playwright's
  // strict-mode ambiguity.
  await expect(
    firstFieldset.getByText("A yes means a doctor should confirm you’re fit to dive"),
  ).toBeVisible();
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
  // Task 44's corrected copy, verbatim from the dive-domain-expert review: a
  // physician's own sign-off is required — the shop only receives and checks
  // for it, and there is no promised timeline the diver's own doctor
  // controls. Also the shop's contact as a tappable link, not a dead end.
  await expect(
    page.getByText(
      "A “yes” answer means you’ll need a doctor to confirm in writing that you’re fit to dive before you can go out",
    ),
  ).toBeVisible();
  await expect(page.getByText("The shop will reach out about next steps.")).toBeVisible();
  await expect(page.getByText("usually before your trip day")).not.toBeVisible();
  await expect(page.getByRole("link", { name: "hello@demo.invalid" })).toHaveAttribute(
    "href",
    "mailto:hello@demo.invalid",
  );
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

test("a non-English visitor sees a notice that the waiver text itself stays in English", async ({
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

  // The waiver link is a bearer-token page a diver opens on their own device,
  // unauthenticated and with their own device's locale — a fresh context with
  // an explicit `locale` sends the real Accept-Language header a browser would
  // (unlike page.setExtraHTTPHeaders, which Chromium doesn't let override its
  // own negotiated Accept-Language for navigation requests). The demo shop's
  // own default is English, so this proves the notice follows the visitor,
  // not the shop.
  const visitorContext = await page.context().browser()?.newContext({ locale: "es-ES" });
  if (!visitorContext) throw new Error("expected a browser to create a second context from");
  const visitorPage = await visitorContext.newPage();
  await visitorPage.goto(`${new URL(page.url()).origin}${waiverHref}`);
  await expect(
    visitorPage.getByText(
      "esta exención y el cuestionario médico solo están disponibles en inglés",
      { exact: false },
    ),
  ).toBeVisible();
  await visitorContext.close();
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
