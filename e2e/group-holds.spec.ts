import { diverTranslator } from "../src/i18n/messages";
import { expect, test } from "./fixtures";
import { choosePartySize } from "./helpers";
import { seedFacts } from "./shop-facts";

const t = diverTranslator("en-US");

test("organizer holds a party without charging and sees the payment ledger", async ({
  page,
  request,
  privateShop,
}) => {
  const values = await seedFacts(request, ["stripeAccount", "groupHoldLedger"], {
    slug: privateShop.slug,
  });
  const fact = values.groupHoldLedger as { tripId: string };
  await page.goto(`/s/${privateShop.slug}/trips/${fact.tripId}`);
  await choosePartySize(page, 2);
  await page.getByLabel("Name", { exact: true }).fill("New Organizer");
  await page.getByLabel("Email", { exact: true }).fill("new-organizer@example.com");
  await page.getByLabel("Diver 2 name").fill("New Companion");
  await page.getByLabel("Use the main contact’s email for this diver").check();
  await page.getByLabel(t("booking.holdGroup")).check();
  await expect(page.getByText(t("booking.holdGroupNote"))).toBeVisible();
  await page.getByRole("button", { name: t("booking.holdSeats") }).click();
  await expect(page).toHaveURL(/\/ready\/[^/?#]+(?:\?booked=1)?$/);
  await expect(page.getByText(t("seatClaim.paidSummary", { paid: 0, total: 2 }))).toBeVisible();
  await expect(page.getByText("New Companion", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: t("ready.payForTrip"), exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText(t("seatClaim.paidSummary", { paid: 0, total: 2 }))).toBeVisible();
});

test("an expired unpaid organizer keeps a read-only ledger for paid companions", async ({
  page,
  request,
  privateShop,
}) => {
  const values = await seedFacts(request, ["expiredGroupHoldLedger"], { slug: privateShop.slug });
  const fact = values.expiredGroupHoldLedger as { token: string };
  await page.goto(`/ready/${fact.token}`);
  await expect(
    page.getByRole("heading", { name: t("seatClaim.expiredOrganizerHeading") }),
  ).toBeVisible();
  await expect(page.getByText(t("seatClaim.paidSummary", { paid: 1, total: 3 }))).toBeVisible();
  await expect(page.getByText(t("seatClaim.paymentReceived"), { exact: true })).toBeVisible();
  await expect(page.getByText(t("seatClaim.holdExpired"), { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: t("seatClaim.payForSeat") })).toHaveCount(0);
  await expect(page.locator("form")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(t("seatClaim.paidSummary", { paid: 1, total: 3 }))).toBeVisible();
});
