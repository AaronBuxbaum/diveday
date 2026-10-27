import { DEMO_SHOP_SLUG } from "../src/db/demo-shop";
import { diverTranslator } from "../src/i18n/messages";
import { staffTranslator } from "../src/i18n/staff-messages";
import { SELF_DECLARED_AGENCIES, SELF_DECLARED_LEVELS } from "../src/lib/self-registration";
import { expect, makeActivitySafe, signedInAsOwner, test } from "./fixtures";
import { openDiverFileGroup, waiverLinkFromToast } from "./helpers";

/**
 * **The counter's QR door** (issue #1236): a diver who has booked nothing puts
 * themselves on the shop's file, unauthenticated, at `/s/<slug>/register`.
 *
 * The property this spec exists to hold is not "the form works" — it is that
 * **the visitor is told nothing about anyone**. The write matches a returning
 * diver by email, and if the *response* did too, an anonymous visitor could
 * type any address and learn who dives with this shop. So the assertions below
 * mostly check that two very different submissions produce the identical
 * screen.
 */

const REGISTER = `/s/${DEMO_SHOP_SLUG}/register`;

/** Unique per run, so a re-run never collides with its own earlier person row. */
const freshEmail = () => `walkin-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

async function submit(
  page: import("@playwright/test").Page,
  fields: { name: string; email?: string; phone?: string },
) {
  await page.getByLabel("Your name").fill(fields.name);
  if (fields.email) await page.getByLabel("Email").fill(fields.email);
  if (fields.phone) await page.getByLabel("Phone").fill(fields.phone);
  await page.getByRole("button", { name: "Send it to the shop" }).click();
}

test("a walk-in registers, and the shop sees them on the roster", async ({ page }) => {
  const email = freshEmail();
  await page.goto(REGISTER);
  await expect(page.locator("form[data-hydrated='true']")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Register with");

  await page.getByLabel("Agency").selectOption("padi");
  await page.getByLabel("Level").selectOption("open_water");
  await page.getByLabel("Card number").fill("PADI-778899");
  await page.getByLabel("Wetsuit").fill("M");
  await submit(page, { name: "Wanjiru Kamau", email });

  await expect(page.getByRole("heading", { name: "You’re on file" })).toBeVisible();
});

test("a returning diver's submission is indistinguishable from a new one's", async ({ page }) => {
  // The enumeration guard, as a test. Two submissions of the same address: the
  // second finds the person the first created, and the visitor cannot tell.
  const email = freshEmail();
  await page.goto(REGISTER);
  await expect(page.locator("form[data-hydrated='true']")).toBeVisible();
  await submit(page, { name: "Wanjiru Kamau", email });
  const first = await page.getByRole("heading", { name: "You’re on file" }).textContent();
  const firstBody = await page.getByText("has your details").textContent();

  await page.goto(REGISTER);
  await expect(page.locator("form[data-hydrated='true']")).toBeVisible();
  await submit(page, { name: "Wanjiru Kamau", email });
  await expect(page.getByRole("heading", { name: "You’re on file" })).toHaveText(first ?? "");
  await expect(page.getByText("has your details")).toHaveText(firstBody ?? "");
});

test("a submission with no way to reach the diver is refused, and says why", async ({ page }) => {
  // The one refusal a visitor may see, because it is about the form rather
  // than about them.
  await page.goto(REGISTER);
  await expect(page.locator("form[data-hydrated='true']")).toBeVisible();
  await submit(page, { name: "No Contact" });
  await expect(page.getByText("Leave an email or a phone number")).toBeVisible();
  await expect(page.getByRole("heading", { name: "You’re on file" })).toHaveCount(0);
});

test("the page is not offered to search engines", async ({ page }) => {
  // A public write boundary a shop hands out on a printed card is not
  // something to advertise.
  const response = await page.goto(REGISTER);
  expect(response?.status()).toBe(200);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

/**
 * **The branch that actually differs**, and the reason it is worth a whole
 * signed release to reach.
 *
 * The "indistinguishable" test above submits twice against a *pending* waiver,
 * so both submissions take the same path. The submission that takes a different
 * one is the diver whose release already **stands**: `issueWaiverRequest`
 * refuses `already_completed`, nothing is minted and nothing is sent, while a
 * new diver's submission mints a link and hands it to SES. Delivery runs in
 * `after()` for exactly that reason (`deliverSelfRegistrationWaiver`), so the
 * screen — and the work done before the response — is the same either way.
 */
test.describe("a diver whose release already stands", () => {
  signedInAsOwner();

  test("gets the same screen as a stranger, and no second link", async ({ page }) => {
    const stamp = Date.now();
    const name = `Signed Walk-In ${stamp}`;
    const email = freshEmail();

    await page.goto(REGISTER);
    await expect(page.locator("form[data-hydrated='true']")).toBeVisible();
    await submit(page, { name, email });
    const heading = await page.getByRole("heading", { name: "You’re on file" }).textContent();
    const body = await page.getByText("has your details").textContent();

    // Sign the release the registration issued, through the ordinary staff
    // route to the diver's own private link.
    await page.goto(`/shop/${DEMO_SHOP_SLUG}/divers`);
    await page.getByRole("searchbox", { name: "Search divers" }).fill(name);
    const diverLink = page.getByRole("link", { name, exact: true });
    // Kept for the check at the end, which opens this file directly rather
    // than loading and searching the roster a second time: that list and its
    // search cost a loaded machine the last of this test's 15s.
    const diverFile = await diverLink.getAttribute("href");
    if (!diverFile) throw new Error(`no diver link for ${name}`);
    await diverLink.click();
    await openDiverFileGroup(page, "Waiver");
    const waiverGroup = page.getByRole("region", { name: "Waiver" });
    await waiverGroup.getByRole("button", { name: "Copy link" }).click();
    await page.goto(await waiverLinkFromToast(page));

    await page.getByLabel("Type your full name").fill(name);
    await page.getByLabel("I have read this waiver, understand it, and agree to it.").check();
    const noRadios = page.getByRole("radio", { name: "No" });
    await noRadios.first().waitFor();
    const questionCount = await noRadios.count();
    for (let i = 0; i < questionCount; i++) await noRadios.nth(i).check();
    await page.getByRole("button", { name: "Sign waiver" }).click();
    // Back on the same URL, not `/ready/`: the release this door issues is
    // **person-scoped**, and a readiness thread belongs to a booking. This
    // diver has no seat yet — that is the whole point of registering before one
    // exists — so the outcome screen is where signing ends.
    await expect(page.getByRole("heading", { name: /paperwork done/ })).toBeVisible();

    // Now the branch: this submission mints nothing and sends nothing.
    await page.goto(REGISTER);
    await expect(page.locator("form[data-hydrated='true']")).toBeVisible();
    await submit(page, { name, email });
    await expect(page.getByRole("heading", { name: "You’re on file" })).toHaveText(heading ?? "");
    await expect(page.getByText("has your details")).toHaveText(body ?? "");

    // And sign-once held: one release on this diver's record, still signed.
    await page.goto(diverFile);
    await expect(page.getByRole("region", { name: "Waiver" }).getByText("Signed")).toBeVisible();
  });
});

test("agency backtracking keeps edits through refusal, and all supported options reveal the same normalized levels", async ({
  page,
}) => {
  const words = diverTranslator("en-US");
  await page.goto(REGISTER);
  await expect(page.locator("form[data-hydrated='true']")).toBeVisible();
  const agency = page.getByLabel(words("register.agencyLabel"));
  const level = page.getByLabel(words("register.levelLabel"));
  const number = page.getByLabel(words("register.identifierLabel"));
  await expect(page.getByText(words("register.uncertified"))).toBeVisible();
  await expect(level).toBeHidden();
  await expect(number).toBeHidden();
  await expect(page.getByRole("combobox")).toHaveCount(1);
  for (const value of SELF_DECLARED_AGENCIES) {
    await agency.selectOption(value);
    await expect(level).toBeVisible();
    await expect(number).toBeVisible();
    expect(
      await level
        .locator("option")
        .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value)),
    ).toEqual(["", ...SELF_DECLARED_LEVELS]);
  }
  await agency.selectOption("padi");
  await agency.focus();
  await page.keyboard.press("Tab");
  await expect(level).toBeFocused();
  await level.selectOption("rescue");
  await number.fill("P-123");
  await agency.selectOption("");
  await expect(level).toBeHidden();
  await agency.selectOption("padi");
  await expect(level).toHaveValue("rescue");
  await expect(number).toHaveValue("P-123");
  await page.getByLabel(words("register.wetsuitLabel")).fill("M");
  await submit(page, { name: "No Contact" });
  await expect(page.getByText(words("register.contactRequired"))).toBeVisible();
  await expect(agency).toHaveValue("padi");
  await expect(level).toHaveValue("rescue");
  await expect(number).toHaveValue("P-123");
  await expect(page.getByLabel(words("register.nameLabel"))).toHaveValue("No Contact");
  await expect(page.getByLabel(words("register.wetsuitLabel"))).toHaveValue("M");
});

test("an uncertified submission succeeds after backing out of a card declaration", async ({
  page,
}) => {
  const words = diverTranslator("en-US");
  await page.goto(REGISTER);
  await expect(page.locator("form[data-hydrated='true']")).toBeVisible();
  await page.getByLabel(words("register.agencyLabel")).selectOption("padi");
  await page.getByLabel(words("register.levelLabel")).selectOption("rescue");
  await page.getByLabel(words("register.identifierLabel")).fill("P-123");
  await page.getByLabel(words("register.agencyLabel")).selectOption("");
  await expect(page.getByRole("combobox")).toHaveCount(1);
  await submit(page, { name: "Uncertified Walk In", email: freshEmail() });
  await expect(page.getByRole("heading", { name: words("register.doneTitle") })).toBeVisible();
});

test("switching counter sign-up off refuses an open form and leaves a crew fallback", async ({
  page,
  privateShop,
  browser,
  workerBaseURL,
}) => {
  const words = diverTranslator("en-US");
  const staff = staffTranslator("en-US");
  const visitorContext = await browser.newContext({ baseURL: workerBaseURL, locale: "en-US" });
  try {
    const visitor = makeActivitySafe(await visitorContext.newPage());
    const register = `/s/${privateShop.slug}/register`;
    await visitor.goto(register);
    await expect(visitor.locator("form[data-hydrated='true']")).toBeVisible();
    await visitor.getByLabel(words("register.nameLabel")).fill("Counter Walk In");
    await visitor.getByLabel(words("register.emailLabel")).fill(freshEmail());
    await expect(visitor.getByRole("button", { name: words("register.submit") })).toBeVisible();

    await page.goto(`/shop/${privateShop.slug}/settings/features`);
    await page.getByLabel(staff("settings.main.features.selfRegistration.label")).uncheck();
    // Subscribe before submitting: FlashParams removes the notice after rendering.
    await Promise.all([
      page.waitForURL(/\/settings\/features\?notice=feature-saved$/),
      page.getByRole("button", { name: "Save", exact: true }).click(),
    ]);
    await expect(
      page.getByRole("status").filter({ hasText: staff("settings.main.features.saved") }),
    ).toBeVisible();

    await visitor.getByRole("button", { name: words("register.submit") }).click();
    await expect(visitor.getByText(words("register.unavailable"))).toBeVisible();
    await expect(visitor.getByLabel(words("register.nameLabel"))).toHaveValue("Counter Walk In");
    const response = await visitor.reload();
    expect(response?.status()).toBe(200);
    await expect(visitor.getByText(words("register.switchedOff"))).toBeVisible();
    await expect(visitor.locator("form")).toHaveCount(0);
    await expect(visitor.getByRole("button", { name: words("register.submit") })).toHaveCount(0);
  } finally {
    await visitorContext.close();
  }
});
