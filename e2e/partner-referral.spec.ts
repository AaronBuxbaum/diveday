import { expect, signedInAsOwner, test } from "./fixtures";
import {
  choosePartySize,
  createTrip,
  daysFromNow,
  e2eNow,
  signInAsOwner,
  signOut,
} from "./helpers";

/**
 * **A hotel's link, all the way to the shop's month** (issue #1285).
 *
 * The partner link the embed generator writes has always existed; until now
 * nothing read it back, so a shop could hand a resort an attributed link and
 * never learn what it sent. The path has three legs and no unit test spans
 * them: the edge remembers the partner from the storefront visit, the booking
 * action reads that cookie a page later, and Reports counts the seats.
 *
 * The middle leg is the one only a browser can prove. The diver lands on the
 * *schedule* carrying the partner's parameters — which is where `partnerLinkUrl`
 * points, not at any particular departure — and then navigates to a departure
 * before booking. The attribution has to survive that page load, which is the
 * whole reason there is a cookie rather than a hidden field.
 *
 * Both tests name a partner the demo seed never writes, so neither can pass on
 * `seed-partner-referrals.ts`'s rows instead of on the path under test.
 */
const PARTNER = "test-partner-lodge";

test.describe("a partner's referral", () => {
  signedInAsOwner();

  test("survives the hop from the storefront to the booking, and lands on the month's report", async ({
    page,
  }) => {
    // Several sequential navigations plus a sign-in; same aggregate-cost
    // reasoning as booking.spec.ts's own loop.
    test.setTimeout(30_000);
    const title = `Partner Reef ${e2eNow().getTime()}`;

    await createTrip(page, {
      title,
      // Three days out, so the departure falls in the same month as the frozen
      // clock and the report below needs no month picking.
      date: daysFromNow(3),
      departsAt: "08:00",
      returnsAt: "11:30",
      capacity: 6,
      price: 120,
    });
    await signOut(page);

    await page.goto(
      `/s/blue-mantis?utm_source=partner&utm_medium=referral&utm_campaign=${PARTNER}`,
      { waitUntil: "domcontentloaded" },
    );
    await page
      .getByRole("list", { name: "Upcoming trips" })
      .locator("li")
      .filter({ hasText: title })
      .getByRole("link")
      .click();
    // Wait for the navigation itself rather than for text the page we came from
    // also carries — the schedule and the trip page share the departure's
    // title, so a visibility assertion could pass against the previous page.
    await page.waitForURL(/\/s\/blue-mantis\/trips\//);

    await choosePartySize(page, 1);
    await page.getByLabel("Name", { exact: true }).fill("Referred Rosa");
    await page.getByLabel("Email", { exact: true }).fill(`rosa-${e2eNow().getTime()}@example.com`);
    await page.getByRole("button", { name: "Book these spots" }).click();
    await expect(page).toHaveURL(/\/ready\//);

    await signInAsOwner(page);
    await page.goto("/shop/blue-mantis/reports");
    await expect(
      page.getByRole("list", { name: "Who sent divers" }).getByText(PARTNER),
    ).toBeVisible();
  });

  test("credits nobody for a visit that is not a partner link", async ({ page }) => {
    test.setTimeout(30_000);
    const title = `Unreferred Reef ${e2eNow().getTime()}`;

    await createTrip(page, {
      title,
      date: daysFromNow(3),
      departsAt: "13:00",
      returnsAt: "16:30",
      capacity: 6,
      price: 120,
    });
    await signOut(page);

    // An ordinary campaign, not the pair the generator writes. `utm_campaign`
    // alone is a parameter a shop may use for anything, so it must credit
    // nobody rather than mint a partner named after a newsletter.
    await page.goto(`/s/blue-mantis?utm_source=newsletter&utm_campaign=${PARTNER}`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByRole("list", { name: "Upcoming trips" })
      .locator("li")
      .filter({ hasText: title })
      .getByRole("link")
      .click();
    await page.waitForURL(/\/s\/blue-mantis\/trips\//);

    await choosePartySize(page, 1);
    await page.getByLabel("Name", { exact: true }).fill("Walk-in Wanda");
    await page.getByLabel("Email", { exact: true }).fill(`wanda-${e2eNow().getTime()}@example.com`);
    await page.getByRole("button", { name: "Book these spots" }).click();
    await expect(page).toHaveURL(/\/ready\//);

    await signInAsOwner(page);
    await page.goto("/shop/blue-mantis/reports");
    // The month's report is on screen — the seeded partners are there — and
    // this one is not on it.
    await expect(page.getByRole("list", { name: "Who sent divers" })).toBeVisible();
    await expect(page.getByText(PARTNER)).toHaveCount(0);
  });
});
