import { diverTranslator } from "../src/i18n/messages";
import { expect, test } from "./fixtures";
import { e2eNow } from "./helpers";
import { seedFacts } from "./shop-facts";

const diver = diverTranslator("en-US");

/**
 * ADR 20261125-diver-sign-in: a diver asks for a link on the shop's pages,
 * taps it once, and lands on their own profile; the link does not work twice,
 * and signing out ends it. The `diverSignIn` fact mints the link the email
 * would carry, since the mail never leaves the harness.
 *
 * The public last-minute list is the cheapest door to a person with a known
 * email, as `courtesy-email-unsubscribe.spec.ts` uses it.
 */
test("a diver signs in with an emailed link and keeps a profile", async ({ page, request }) => {
  const email = `signin-${e2eNow().getTime()}@example.com`;
  await page.goto("/s/blue-mantis");
  const waitList = page.locator("#last-minute-list");
  await waitList.locator("summary").click();
  await waitList.getByLabel("Name").fill("Marisol Vega");
  await waitList.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Notify me" }).click();
  await expect(page.getByRole("heading", { name: "You’re on the list" })).toBeVisible();

  await page.getByRole("link", { name: diver("shopChrome.signIn") }).click();
  await expect(page.getByRole("heading", { name: diver("diverSignIn.title") })).toBeVisible();
  await page.getByLabel(diver("diverSignIn.email")).fill(email);
  await page.getByRole("button", { name: diver("diverSignIn.submit") }).click();
  await expect(page.getByRole("heading", { name: diver("diverSignIn.sentTitle") })).toBeVisible();

  const { diverSignIn } = await seedFacts(request, [{ name: "diverSignIn", email }]);
  await page.goto(`/diver-sign-in/${diverSignIn.token}`);
  await expect(page).toHaveURL(/\/s\/blue-mantis\/me$/);
  await expect(page.getByRole("heading", { name: "Marisol Vega" })).toBeVisible();
  await expect(page.getByRole("link", { name: diver("shopChrome.myProfile") })).toBeVisible();

  const phone = page.locator('input[name="phone"]');
  await phone.fill("+1 305 555 0142");
  await page.getByRole("button", { name: diver("profile.save") }).click();
  await expect(page).toHaveURL(/saved=1/);
  await expect(phone).not.toHaveValue("");

  await page.getByRole("button", { name: diver("profile.signOut") }).click();
  await expect(page).toHaveURL(/\/s\/blue-mantis$/);
  await expect(page.getByRole("link", { name: diver("shopChrome.signIn") })).toBeVisible();

  // Spent: the same link asks for a fresh one.
  await page.goto(`/diver-sign-in/${diverSignIn.token}`);
  await expect(page).toHaveURL(/\/s\/blue-mantis\/sign-in\?error=link/);
});
