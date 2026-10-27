import { diverTranslator } from "../src/i18n/messages";
import { expect, makeActivitySafe, signedInAsOwner, test } from "./fixtures";
import {
  choosePartySize,
  createTrip,
  daysFromNow,
  e2eNow,
  openTripActivity,
  openTripFromBoard,
  signInAsOwner,
  signOut,
} from "./helpers";

const diver = diverTranslator("en-US");

/**
 * The group-organizer loop (docs ADR 20260804-seat-claim-links): one
 * organizer books several seats, shares a claim link, and the invited diver
 * takes the seat over as themselves — own contact, own waiver, own prep by email —
 * while the organizer watches the claimed state land. The whole point is
 * killing "the organizer does everyone's paperwork".
 */
test.describe("seat claim links", () => {
  signedInAsOwner();

  test("organizer books a party, a diver claims their own seat on another device", async ({
    page,
    browser,
    workerBaseURL,
  }) => {
    // Sequential navigations across three actors (staff setup, organizer,
    // claimant) — same aggregate-cost reasoning as booking.spec.ts.
    test.setTimeout(60_000);
    const title = `Group Charter ${e2eNow().getTime()}`;

    await createTrip(page, {
      title,
      date: daysFromNow(6),
      departsAt: "09:00",
      returnsAt: "13:00",
      capacity: 8,
      price: 90,
    });
    await signOut(page);

    // The organizer books two seats from the public schedule — their own with
    // an email, the second just a typed name (no address, the relay reality).
    await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
    await page
      .getByRole("list", { name: "Upcoming trips" })
      .locator("li")
      .filter({ hasText: title })
      .getByRole("link")
      .click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await choosePartySize(page, 2);
    await page.getByLabel("Name", { exact: true }).fill("Orla Byrne");
    await page.getByLabel("Email", { exact: true }).fill(`orla-${e2eNow().getTime()}@example.com`);
    await page.getByLabel("Diver 2 name").fill("Sam Reyes");
    await page.getByLabel("Use the main contact’s email for this diver").check();
    // How the desk takes money, under "Due at the shop" (fifth-loop ideas,
    // item 21): the demo shop takes cards and cash.
    await expect(page.getByText("Pay by card or cash when you arrive.")).toBeVisible();
    await page.getByRole("button", { name: "Book 2 seats" }).click();
    await expect(page.getByRole("heading", { name: /You’ve got a seat, Orla/ })).toBeVisible();

    // What the party owes at the shop, said once on the page the lead keeps,
    // in the confirmation's own words (fourth UX review, item 5).
    await expect(
      page.getByText(/^2 seats: \$180\.00, due at the shop\. Pay by card or cash/),
    ).toBeVisible();

    // The organizer's panel: the second seat, unclaimed, with a shareable link.
    const panel = page.locator("section", {
      has: page.getByRole("heading", { name: "Your group’s seats" }),
    });
    const seatRow = panel.locator("li").filter({ hasText: "Sam Reyes" });
    await expect(seatRow.getByText("Not claimed yet")).toBeVisible();
    await page
      .getByRole("link", { name: diver("ready.groupSummary", { total: 2, unclaimed: 1 }) })
      .click();
    await expect(seatRow).toBeFocused();
    await expect(
      seatRow.getByRole("button", { name: diver("seatClaim.copyReminder") }),
    ).toBeVisible();
    // The URL sits behind a collapsed "Show link" disclosure (the token must
    // not render as visible pixels) — textContent reads it either way, but
    // exercise the disclosure the way an organizer without a clipboard would.
    await seatRow.getByText("Show link").click();
    const claimUrlText = (await seatRow.locator("p.font-mono").textContent()) ?? "";
    const claimPath = claimUrlText.match(/\/claim\/[^\s/?#]+/)?.[0];
    expect(claimPath).toBeTruthy();
    // The invited diver opens the link on their own browser profile.
    const claimantContext = await browser.newContext({ baseURL: workerBaseURL });
    const claimantPage = makeActivitySafe(await claimantContext.newPage());
    await claimantPage.goto(claimPath ?? "/");
    await expect(
      claimantPage.getByRole("heading", { name: `A seat on ${title} is waiting for you` }),
    ).toBeVisible();
    // The seat being claimed is named — never any sibling seat.
    await expect(claimantPage.getByText(/held it as “Sam Reyes”/)).toBeVisible();
    await claimantPage.getByLabel("Your name").fill("Sam Reyes");
    await claimantPage.getByLabel("Your email").fill(`sam-${e2eNow().getTime()}@example.com`);
    await claimantPage.getByLabel(/Your phone/).fill("+1-305-555-0134");
    await claimantPage.getByRole("button", { name: "Claim this seat" }).click();

    // They land on the static "check your email" page, the same page a claim
    // for an address already on the trip gets (issue #2381): their own prep
    // link is in the confirmation email, not on screen.
    await expect(claimantPage).toHaveURL(/\/claim\/[^/?#]+\?sent=1$/);
    await expect(claimantPage.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await expect(claimantPage.getByText(/We’ve sent a note to the address you gave/)).toBeVisible();

    // The spent link is dead for everyone — and because the token still
    // resolves to a capability this app issued, it dies in the *booking* tier
    // (ADR 20260827-first-light, decision 3): the shop's name and its way in.
    await claimantPage.goto(claimPath ?? "/");
    await expect(
      claimantPage.getByRole("heading", { name: "This link no longer works" }),
    ).toBeVisible();
    await expect(claimantPage.getByText(/Whoever sent you this link/)).toBeVisible();
    await expect(
      claimantPage.getByRole("link", { name: /Contact Blue Mantis Divers/ }),
    ).toBeVisible();
    // Five other causes share this one sentence — a cancelled seat, a departure
    // called off for weather, a boat already back — so it may not tell this
    // diver the seat is safe, nor send them for a link nothing can mint.
    await expect(claimantPage.getByText(/seat is safe|fresh link/i)).toHaveCount(0);

    // A token that was never ours resolves to no record, so it names nobody.
    await claimantPage.goto("/claim/not-a-real-token");
    await expect(
      claimantPage.getByRole("heading", { name: "This link no longer works" }),
    ).toBeVisible();
    await expect(claimantPage.getByText(/Blue Mantis/)).toHaveCount(0);
    await claimantContext.close();

    // The organizer reloads their page: claimed, no link to share.
    // The summary jump added a fragment; navigating to that same URL would
    // stay in this document instead of reading the other device's claim.
    await page.reload();
    const refreshedRow = page
      .locator("section", { has: page.getByRole("heading", { name: "Your group’s seats" }) })
      .locator("li")
      .filter({ hasText: "Sam Reyes" });
    await expect(refreshedRow.getByText("Claimed", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("link", { name: diver("ready.groupSummary", { total: 2, unclaimed: 0 }) }),
    ).toHaveAttribute("href", "#party-seats");
    await expect(refreshedRow.locator("p.font-mono")).toHaveCount(0);

    // Staff see the claimant on the roster and the claim on the trail.
    await signInAsOwner(page);
    await page.goto("/shop/blue-mantis/schedule/board");
    await openTripFromBoard(page, title);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.locator("#roster").getByText("Sam Reyes").first()).toBeVisible();
    await openTripActivity(page);
    await expect(page.getByText(/Sam Reyes claimed their seat/)).toBeVisible();
  });
});
