import { expect, makeActivitySafe, signedInAsOwner, test } from "./fixtures";
import { createTrip, daysFromNow, e2eNow, signInAsOwner, signOut } from "./helpers";

/**
 * The group-organizer loop (docs ADR 20260804-seat-claim-links): one
 * organizer books several seats, shares a claim link, and the invited diver
 * takes the seat over as themselves — own contact, own waiver, own prep —
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
    const partySize = page.getByLabel("Number of divers");
    await expect(partySize).toHaveAttribute("data-hydrated", "true");
    await partySize.selectOption("2");
    await page.getByLabel("Name", { exact: true }).fill("Orla Byrne");
    await page.getByLabel("Email", { exact: true }).fill(`orla-${e2eNow().getTime()}@example.com`);
    await page.getByLabel("Diver 2 name").fill("Sam Reyes");
    await page.getByLabel("Use the main contact's email for this diver").check();
    await page.getByRole("button", { name: "Book these spots" }).click();
    await expect(page.getByRole("heading", { name: /You’re on the boat, Orla/ })).toBeVisible();

    // The organizer's panel: the second seat, unclaimed, with a shareable link.
    const panel = page.locator("section", {
      has: page.getByRole("heading", { name: "Your group’s seats" }),
    });
    const seatRow = panel.locator("li").filter({ hasText: "Sam Reyes" });
    await expect(seatRow.getByText("Not claimed yet")).toBeVisible();
    // The URL sits behind a collapsed "Show link" disclosure (the token must
    // not render as visible pixels) — textContent reads it either way, but
    // exercise the disclosure the way an organizer without a clipboard would.
    await seatRow.getByText("Show link").click();
    const claimUrlText = (await seatRow.locator("p.font-mono").textContent()) ?? "";
    const claimPath = claimUrlText.match(/\/claim\/[^\s/?#]+/)?.[0];
    expect(claimPath).toBeTruthy();
    const organizerUrl = page.url();

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

    // They land on their own prep hub, told plainly whose page this now is.
    await expect(claimantPage).toHaveURL(/\/ready\//);
    await expect(claimantPage.getByText(/This seat is yours now/)).toBeVisible();
    await expect(claimantPage.getByRole("heading", { name: title })).toBeVisible();

    // Their own waiver flow works from here — the one-hop sign button.
    await claimantPage.getByRole("button", { name: "Sign your waiver" }).click();
    await expect(claimantPage).toHaveURL(/\/waivers\//);
    await expect(
      claimantPage.getByRole("heading", { name: "A quick step before the dock" }),
    ).toBeVisible();

    // The spent link is dead for everyone, uniformly.
    await claimantPage.goto(claimPath ?? "/");
    await expect(
      claimantPage.getByRole("heading", { name: "This link isn’t available" }),
    ).toBeVisible();
    await claimantContext.close();

    // The organizer refreshes their confirmation: claimed, no link to share.
    await page.goto(organizerUrl);
    const refreshedRow = page
      .locator("section", { has: page.getByRole("heading", { name: "Your group’s seats" }) })
      .locator("li")
      .filter({ hasText: "Sam Reyes" });
    await expect(refreshedRow.getByText("Claimed ✅")).toBeVisible();
    await expect(refreshedRow.locator("p.font-mono")).toHaveCount(0);

    // Staff see the claimant on the roster and the claim on the trail.
    await signInAsOwner(page);
    await page.goto("/shop/blue-mantis/schedule/board");
    await page.locator("li").filter({ hasText: title }).getByRole("link").click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await page
      .getByRole("navigation", { name: "Trip" })
      .getByRole("link", { name: "Guests" })
      .click();
    await expect(page.locator("#roster").getByText("Sam Reyes").first()).toBeVisible();
    await expect(page.getByText(/Sam Reyes claimed their seat/)).toBeVisible();
  });
});
