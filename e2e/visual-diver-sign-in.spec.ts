import { diverTranslator } from "../src/i18n/messages";
import { expect, test } from "./fixtures";
import { capture, FLOW_TIMEOUT_MS, installVisualBuildGuard } from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: FLOW_TIMEOUT_MS });
test.use({ privateShopSlug: "diver-sign-in-review", privateShopFacts: ["signedInDiver"] });
const t = diverTranslator("en-US");

/**
 * ADR 20261125-diver-sign-in: the sign-in page, its "check your email" state,
 * the profile the link lands on, and the booking form offering the diver's own
 * trip credit. The `signedInDiver` fact holds the credit and mints the link.
 */
test("light mode diver signs in, reads their profile and books on credit", async ({
  page,
  privateShop,
}) => {
  const fact = privateShop.values.signedInDiver as { token: string; email: string; tripId: string };
  await page.goto(`/s/${privateShop.slug}/sign-in`);
  await expect(page.getByRole("heading", { name: t("diverSignIn.title") })).toBeVisible();
  await capture(page, "diver-sign-in", "light");

  await page.getByLabel(t("diverSignIn.email")).fill(fact.email);
  await page.getByRole("button", { name: t("diverSignIn.submit") }).click();
  await expect(page.getByRole("heading", { name: t("diverSignIn.sentTitle") })).toBeVisible();
  await capture(page, "diver-sign-in-sent", "light");

  await page.goto(`/diver-sign-in/${fact.token}`);
  await expect(page).toHaveURL(new RegExp(`/s/${privateShop.slug}/me$`));
  await expect(page.getByRole("heading", { name: "Marisol Vega" })).toBeVisible();
  await capture(page, "diver-profile", "light");

  await page.goto(`/s/${privateShop.slug}/trips/${fact.tripId}`);
  await expect(page.getByRole("checkbox", { name: t("booking.useTripCredit") })).toBeChecked();
  await capture(page, "diver-booking-trip-credit", "light");
});
