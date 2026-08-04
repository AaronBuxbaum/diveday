import { expect, makeActivitySafe, signedInAs, signedInAsOwner, test } from "./fixtures";
import { openTripFromBoard, openTripTab, sendWaiverForFirstDiver } from "./helpers";

/** The seeded charter every waiver flow in this file starts from. */
const TRIP = "Two-Tank Reef — Molasses & French";

signedInAsOwner();

test.describe("signed out", () => {
  // The file-wide owner session (signedInAsOwner() above) would otherwise
  // bounce /sign-in straight to the shop, so only the genuinely-anonymous
  // case lives here now — the captain cases below get their own real
  // session via `signedInAs("captain")` instead of overriding this one to
  // empty and then signing in live.
  test.use({ storageState: { cookies: [], origins: [] } });

  // Task 155's mandated security-reviewer pass found the Signatures tab —
  // staff read access to signed, medical-adjacent evidence — had no direct
  // adversarial coverage of its own, only the Template tab's. The gate is
  // the same `canPersonManageWaiverTemplates` check either way, but the
  // route is reached independently (deep link, bookmark), so it needs its
  // own tests rather than inheriting confidence from the template page's.
  test("an anonymous visitor is sent to sign in from the signed-waiver audit", async ({ page }) => {
    await page.goto("/shop/blue-mantis/waivers/signatures");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

test.describe("as captain", () => {
  signedInAs("captain");

  test("staff outside owner/manager can't reach the waiver editor", async ({ page }) => {
    // Editing the waiver (and the medical jurisdiction it presents) is
    // owner/manager work; a captain is bounced to Today with an explanation
    // rather than teleported there silently (task 82, UX persona 11 "Kai").
    await page.goto("/shop/blue-mantis/waivers");
    // Not a URL assertion: FlashParams strips `?notice=waivers_not_authorized`
    // via history.replaceState shortly after mount — the rendered banner is
    // the stable signal.
    await expect(page).toHaveURL(/\/shop\/blue-mantis(\?.*)?$/);
    await expect(
      page.getByText("Editing the waiver is limited to owners and managers."),
    ).toBeVisible();
  });

  test("staff outside owner/manager can't reach the signed-waiver audit either", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/waivers/signatures");
    await expect(page).toHaveURL(/\/shop\/blue-mantis(\?.*)?$/);
    await expect(
      page.getByText("Editing the waiver is limited to owners and managers."),
    ).toBeVisible();
    // No signed-record evidence ever reaches the page for a refused role.
    await expect(page.getByText("Medical follow-up flagged")).toHaveCount(0);
  });
});

test("one waiver button sends a resumable link and a medical yes surfaces follow-up", async ({
  page,
}) => {
  // Chains several sequential navigations and status-toast waits — same
  // aggregate-cost reasoning as visual.spec.ts's test.setTimeout: legitimate
  // per-step cost under 2-worker CI load can sum past the default 15s test
  // budget even when no individual step is stuck.
  test.setTimeout(30_000);
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, TRIP);
  // The roster and its waiver control live on the Guests tab.
  await openTripTab(page, "Guests");
  const staffTripUrl = page.url();

  // Not `sendWaiverForFirstDiver()` like the tests below: this one asserts the
  // no-provider notice copy itself and keeps `diverSection` for the follow-up
  // assertions further down, so the send stays spelled out here.
  const diverSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /^Divers/ }) })
    .filter({ visible: true });
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
  // Scoped by text, not just role: the sticky questionnaire-progress bar
  // (QuestionnaireProgress) is also `role="status"` on this page now, so a
  // bare role query is ambiguous — same `.filter({ hasText })` pattern used
  // elsewhere in the e2e suite (e.g. manifest.spec.ts, divers.spec.ts) when
  // more than one status region can be on screen at once.
  await expect(page.getByRole("status").filter({ hasText: "progress is saved" })).toBeVisible();
  await expect(page.getByLabel("Type your full name")).toHaveValue("Priya Sharma");
  // The draft's saved answers prefill on reload — nothing reverts to unanswered.
  await expect(noRadios.first()).toBeChecked();

  // The first question's affirmative answer must not disappear into a generic
  // success state; it becomes an explicit staff follow-up item.
  const firstFieldset = page.locator("fieldset").filter({ visible: true }).first();
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

  // The roster's follow-up notice links straight to the signed-record
  // evidence (task 155) — closing the loop between signature chasing here and
  // the Signatures tab, rather than leaving them as unconnected surfaces. It
  // carries the record's id as `?record=` (resolved through
  // `getSignedWaiverRecordForShop`, pinned above the paginated list) rather
  // than a bare URL anchor into the list, so it still resolves on a shop with
  // enough signed history that the record falls off the list's first page.
  await diverSection.getByRole("link", { name: "View signed record" }).click();
  await page.waitForURL(/\/waivers\/signatures\?record=/);
  await expect(
    page.getByRole("heading", { level: 2, name: "Signed record", exact: true }),
  ).toBeVisible();
  const recordRow = page.locator(`li[id^="waiver-record-"]`).filter({ visible: true }).first();
  await expect(recordRow.getByText("Priya Sharma")).toBeVisible();
  await expect(recordRow.getByText("Medical follow-up flagged")).toBeVisible();
  // The list itself never shows the flagged prompt text — it sits behind the
  // per-record disclosure, mirroring the roster's own gating.
  await expect(
    page.getByText("Do you have, or have you had, a heart, lung, or breathing condition"),
  ).not.toBeVisible();
  await recordRow.getByText("View flagged answers").click();
  await expect(
    recordRow.getByText("Do you have, or have you had, a heart, lung, or breathing condition"),
  ).toBeVisible();
});

test("the medical questionnaire refuses to complete with an unanswered question, even past client validation", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, TRIP);
  await openTripTab(page, "Guests");
  const waiverHref = await sendWaiverForFirstDiver(page);

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
  await expect(
    page.getByText("Please answer every question in the medical questionnaire"),
  ).toBeVisible();
  // The notice also links back to the questionnaire it names as incomplete.
  await expect(page.getByRole("link", { name: "Jump to that field" })).toHaveAttribute(
    "href",
    "#medical-questionnaire",
  );
  await expect(page.getByRole("heading", { name: "Waiver received", level: 1 })).not.toBeVisible();
});

test("an incomplete sign submit is blocked client-side and focuses the missing field", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, TRIP);
  await openTripTab(page, "Guests");
  const waiverHref = await sendWaiverForFirstDiver(page);

  await page.goto(waiverHref ?? "/");
  // Answer every medical question and check the agreement box, but leave the
  // signature name blank — the browser's own `required`/`minLength`
  // validation should block the submit before it ever reaches the server.
  await page.getByLabel("I have read this waiver, understand it, and agree to it.").check();
  for (const radio of await page.getByRole("radio", { name: "No" }).all()) {
    await radio.check();
  }
  await page.getByRole("button", { name: "Sign waiver" }).click();
  await expect(page).toHaveURL(/\/waivers\/[^?]+$/);
  await expect(page.getByLabel("Type your full name")).toBeFocused();
});

test("a non-English visitor sees a notice that the waiver text itself stays in English", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, TRIP);
  await openTripTab(page, "Guests");
  const waiverHref = await sendWaiverForFirstDiver(page);

  // The waiver link is a bearer-token page a diver opens on their own device,
  // unauthenticated and with their own device's locale — a fresh context with
  // an explicit `locale` sends the real Accept-Language header a browser would
  // (unlike page.setExtraHTTPHeaders, which Chromium doesn't let override its
  // own negotiated Accept-Language for navigation requests). The demo shop's
  // own default is English, so this proves the notice follows the visitor,
  // not the shop.
  const visitorContext = await page.context().browser()?.newContext({ locale: "es-ES" });
  if (!visitorContext) throw new Error("expected a browser to create a second context from");
  const visitorPage = makeActivitySafe(await visitorContext.newPage());
  await visitorPage.goto(`${new URL(page.url()).origin}${waiverHref}`);
  await expect(
    visitorPage
      .getByText("esta exención y el cuestionario médico solo están disponibles en inglés", {
        exact: false,
      })
      .filter({ visible: true }),
  ).toBeVisible();
  await visitorContext.close();
});

test("saving a draft also refuses an unanswered question, even past client validation", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, TRIP);
  await openTripTab(page, "Guests");
  const waiverHref = await sendWaiverForFirstDiver(page);

  await page.goto(waiverHref ?? "/");
  await page.getByLabel("Type your full name").fill("Adversarial Draft Diver");
  // Answer every question except the last one. "Save and finish later" carries
  // `formNoValidate` (drafts intentionally accept partial answers), so the
  // browser's own required/minLength validation never blocks this submit —
  // this test is really about the *server's* `readMedicalAnswers()` still
  // refusing an incomplete questionnaire, a separate code path from
  // `completeAction` that needs its own regression coverage rather than
  // assuming the two stay symmetric.
  const noRadios = page.getByRole("radio", { name: "No" });
  const questionCount = await noRadios.count();
  for (let i = 0; i < questionCount - 1; i++) {
    await noRadios.nth(i).check();
  }
  await page.getByRole("button", { name: "Save and finish later" }).click();
  await expect(
    page.getByText("Please answer every question in the medical questionnaire"),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Jump to that field" })).toHaveAttribute(
    "href",
    "#medical-questionnaire",
  );
  // Nothing was saved — reloading shows no "progress is saved" status and the
  // name field is back to empty, not a half-recorded draft. Scoped by text
  // (not just role) because the sticky questionnaire-progress bar is also
  // `role="status"` on this page and stays visible regardless.
  await expect(page.getByRole("status").filter({ hasText: "progress is saved" })).not.toBeVisible();
});

test("staff edit the single shop waiver and each edit is kept as a version", async ({ page }) => {
  await page.goto("/shop/blue-mantis/waivers");

  const release = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Release text" }) })
    .filter({ visible: true });

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

/**
 * The signature audit paged forward-only by cursor: "Show more records" and,
 * once you had moved, "Back to the top of the list" — so a reviewer four pages
 * into a shop's signed evidence could only start over, and was never told how
 * much evidence was left. On an *audit* that is not a nicety: "page 4 of 9" is
 * how a reviewer knows what they have and have not walked. It wears the shared
 * pager now (ADR 20260803-one-pagination-model), and what this proves is the
 * capability that was missing — going back one page lands where you came from.
 */
test("the signature audit pages both ways, and keeps a pinned record while it does", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/waivers/signatures");
  const pager = page.getByRole("navigation", { name: "Pages" });
  // Not "skip when there's nothing to page": the demo shop's signed history is
  // well past one page, so a missing pager is the regression, not a pass.
  await expect(pager).toBeVisible();
  await expect(pager).toContainText(/Page 1 of \d+/);

  const rows = page.locator('li[id^="waiver-record-"]');
  const firstName = await rows.first().getByRole("link").first().textContent();

  await pager.getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByRole("navigation", { name: "Pages" })).toContainText("Page 2 of");
  const secondName = await rows.first().getByRole("link").first().textContent();
  expect(secondName).not.toBe(firstName);

  // Forward once more, then back one — page 2 again, not page 1 and not the top.
  await page.getByRole("navigation", { name: "Pages" }).getByRole("link", { name: "Next" }).click();
  await expect(page.getByRole("navigation", { name: "Pages" })).toContainText("Page 3 of");
  await page
    .getByRole("navigation", { name: "Pages" })
    .getByRole("link", { name: "Previous" })
    .click();
  await expect(page.getByRole("navigation", { name: "Pages" })).toContainText("Page 2 of");
  expect(await rows.first().getByRole("link").first().textContent()).toBe(secondName);

  // A `?record=` pin is a separate section above the list, so turning a page
  // must not drop it — the roster's "View signed record" link is exactly how a
  // reviewer arrives here, and losing the pin mid-audit strands them.
  const pinned = page.locator('li[id^="waiver-record-"]').first();
  const pinnedId = (await pinned.getAttribute("id"))?.replace("waiver-record-", "");
  await page.goto(`/shop/blue-mantis/waivers/signatures?record=${pinnedId}`);
  const pinnedHeading = page.getByRole("heading", { level: 2, name: "Signed record", exact: true });
  await expect(pinnedHeading).toBeVisible();
  await page.getByRole("navigation", { name: "Pages" }).getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/record=/);
  await expect(pinnedHeading).toBeVisible();
});
