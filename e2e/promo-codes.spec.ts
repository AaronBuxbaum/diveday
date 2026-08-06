import type { Page } from "@playwright/test";
import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";
import { daysFromNow, e2eNow, findTripOnBoard } from "./helpers";

/**
 * Shop-wide promo codes (docs ADR 20260729-shop-promo-codes). The fleet has no
 * real `STRIPE_SECRET_KEY`, so a *create* here always fails at the Stripe step
 * — which is itself the behaviour worth pinning: the row survives as visible
 * evidence, reads as `failed`, and can never discount anything. The seeded
 * codes cover the live-code surface.
 */

test("the promo page is owner/manager work, not open to every staff member", async ({ page }) => {
  await page.goto("/shop/blue-mantis/promos");
  // Signed out, the staff gate sends an anonymous visitor to sign in.
  await expect(page).toHaveURL(/\/sign-in/);
});

test.describe("as captain", () => {
  signedInAs("captain");

  test("a non-owner is bounced with the promo-specific refusal, not a generic one", async ({
    page,
  }) => {
    // A captain has no use for promo codes (they discount real money). The
    // landing must show *why Promos refused*, not a message about a surface
    // they never asked for (task 82, UX persona 11 "Kai"). That landing is
    // Today now: it used to be Settings, which takes the same owner/manager
    // gate this captain just failed, so it bounced them again and the
    // promo-specific reason was lost on the way.
    await page.goto("/shop/blue-mantis/promos");
    // Not a URL assertion alone: FlashParams strips `?notice=promos_not_authorized`
    // via history.replaceState shortly after mount — the rendered banner is
    // the stable signal.
    await expect(page).toHaveURL(/\/shop\/blue-mantis(\?.*)?$/);
    // Scoped to the notice region and filtered by text. `role="status"`, not
    // `role="alert"`: Today renders an authorization landing in ShopNotice's
    // *warning* tone, where Settings used danger — this test asserted the
    // Settings shape and had to move with the landing. The filter also keeps
    // Next's own always-present `#__next-route-announcer__` out, which carries
    // a live-region role too and matches the moment FlashParams'
    // `history.replaceState` above makes the router treat this as a navigation.
    const flash = page.getByRole("status").filter({ hasText: "Promo codes discount real money" });
    await expect(flash).toContainText(
      "Promo codes discount real money, so they're limited to owners and managers.",
    );
    // Still the promo-specific reason, never a message about a surface this
    // captain never asked for — the whole point of the separate notice code.
    await expect(flash).not.toContainText(
      "The rental catalog, rental prices, and Stripe connection",
    );
    await expect(flash).not.toContainText("Shop settings are managed by the owner");
  });
});

test.describe("as owner", () => {
  signedInAsOwner();

  test("an owner sees the shop's codes with their scope, window, and redemption count", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/promos");
    await expect(page.getByRole("heading", { name: "Discounts a diver can type" })).toBeVisible();

    const standing = page.locator("li").filter({ hasText: "REEF10" }).filter({ visible: true });
    await expect(standing.getByText("10% off")).toBeVisible();
    await expect(standing.getByText("Trips and courses")).toBeVisible();
    await expect(standing.getByText("Redeemed 1 time")).toBeVisible();
    // The success-tone Badge prepends a decorative aria-hidden glyph
    // (Badge.tsx toneGlyph), so the element's own text is "✓ Live", not
    // "Live" alone — and a bare substring match also picks up the "live
    // now" window text elsewhere in this same card.
    await expect(standing.getByText("✓ Live")).toBeVisible();

    // An expired code is honestly not live, rather than quietly still offered.
    const expired = page.locator("li").filter({ hasText: "OPENWATER25" }).filter({ visible: true });
    await expect(expired.getByText("Not live right now")).toBeVisible();
  });

  test("a code Stripe never minted is kept as failed evidence, and cannot be switched on", async ({
    page,
    request,
  }) => {
    // Unlocks the "not_connected" gate without ever calling real Stripe.
    await request.post("/api/test/seed-stripe-account");
    await page.goto("/shop/blue-mantis/promos");

    await page.getByLabel("Code").fill("E2ETEST");
    await page.getByLabel("Discount").fill("15");
    await page.getByRole("button", { name: "Create code" }).click();
    await expect(page.getByText(/Stripe didn't create that code/)).toBeVisible();

    const failed = page.locator("li").filter({ hasText: "E2ETEST" }).filter({ visible: true });
    await expect(failed.getByText("Failed at Stripe")).toBeVisible();
    // No switch-on/off affordance: enabling it would validate locally then
    // fail at checkout, which is worse than staying visibly broken. "Copy
    // code", "Try again", and "Delete" are all legitimate for a failed row.
    await expect(failed.getByRole("button", { name: /^Switch/ })).toHaveCount(0);
  });

  test("a code that already exists is refused on the Code box, not in a banner", async ({
    page,
    request,
  }) => {
    // The refusal names one box, so it belongs on that box. It used to render
    // as a page-level banner under the `<h1>` — above six fields, telling a
    // staffer "that code is taken" without saying which of the things they
    // just typed was the code.
    await request.post("/api/test/seed-stripe-account");
    await page.goto("/shop/blue-mantis/promos");

    // REEF10 is seeded, so this is a genuine duplicate.
    await page.getByLabel("Code").fill("REEF10");
    await page.getByLabel("Discount").fill("15");
    await page.getByRole("button", { name: "Create code" }).click();

    const codeBox = page.getByLabel("Code");
    await expect(codeBox).toHaveAttribute("aria-invalid", "true");
    // The message is the box's own description, which is what a screen reader
    // reads when the cursor lands there — and the cursor does land there.
    const describedBy = await codeBox.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    // Matched by attribute, not `#id`: `Field` mints the id with React's
    // `useId()`, whose output carries characters a bare CSS id selector
    // cannot express.
    await expect(page.locator(`[id="${describedBy}"]`)).toContainText(/already/i);
    await expect(codeBox).toBeFocused();
  });

  test("deleting a failed code can be undone from the toast, which re-runs Stripe creation", async ({
    page,
    request,
  }) => {
    await request.post("/api/test/seed-stripe-account");
    await page.goto("/shop/blue-mantis/promos");

    await page.getByLabel("Code").fill("E2EUNDO");
    await page.getByLabel("Discount").fill("15");
    await page.getByRole("button", { name: "Create code" }).click();
    await expect(page.getByText(/Stripe didn't create that code/)).toBeVisible();
    const failed = page.locator("li").filter({ hasText: "E2EUNDO" }).filter({ visible: true });
    await expect(failed.getByText("Failed at Stripe")).toBeVisible();

    // A code that never went live needs no confirm dialog to delete (docs/design/principles.md
    // #7): it's gone immediately, with a toast offering Undo instead of a
    // blocking "are you sure?".
    await failed.getByRole("button", { name: "Delete" }).click();
    await expect(
      page.locator("li").filter({ hasText: "E2EUNDO" }).filter({ visible: true }),
    ).toHaveCount(0);
    const toast = page.getByRole("status");
    await expect(toast.getByText("Code deleted.")).toBeVisible();

    // Undo re-runs Stripe creation with the same code, discount, and scope —
    // the same path an ordinary "create a promo" takes, so it fails here for
    // the same reason the original create did (no real Stripe key in the fleet).
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText(/Couldn't restore that code/)).toBeVisible();
    await expect(
      page
        .locator("li")
        .filter({ hasText: "E2EUNDO" })
        .filter({ visible: true })
        .getByText("Failed at Stripe"),
    ).toBeVisible();
  });

  test("a code the shop switched off stops being live", async ({ page }) => {
    await page.goto("/shop/blue-mantis/promos");
    const standing = page.locator("li").filter({ hasText: "REEF10" });
    await standing.getByRole("button", { name: "Switch off" }).click();
    await expect(page.getByText(/Code switched off/)).toBeVisible();
    await expect(
      page
        .locator("li")
        .filter({ hasText: "REEF10" })
        .filter({ visible: true })
        .getByText("Switched off"),
    ).toBeVisible();
  });

  /**
   * `resetDemoSchedule` treats a shop's promo codes as shop configuration and
   * deliberately leaves them alone (src/db/seed.ts, the comment above the
   * `shopPromoRedemptions` delete), so REEF10's on/off state is whatever an
   * earlier test in this file left it as. Drive it to the state the test needs
   * instead of inheriting one — the assertion after the click is unconditional,
   * only the setup click is.
   */
  async function setSeededCodeLive(page: Page, live: boolean) {
    await page.goto("/shop/blue-mantis/promos");
    const row = page.locator("li").filter({ hasText: "REEF10" }).filter({ visible: true });
    // Wait for the row before counting anything on it. `count()` is the one
    // locator method that does *not* auto-wait — it answers about the DOM as it
    // stands right now — so asking it straight after `goto`, while the list is
    // still behind its own `loading.tsx`, reliably answers 0. That skips the
    // setup click, leaves REEF10 in whatever state the previous test left it,
    // and the unconditional assertion below then waits 8s for a badge that was
    // never going to change. Green on a quiet box, and the CI failure it
    // produces reads as "element(s) not found" rather than "the click never
    // happened".
    await expect(row).toBeVisible();
    const target = row.getByRole("button", { name: live ? "Switch on" : "Switch off" });
    if ((await target.count()) > 0) {
      await target.click();
      await expect(page.getByText(live ? /Code switched on/ : /Code switched off/)).toBeVisible();
    }
    await expect(
      page
        .locator("li")
        .filter({ hasText: "REEF10" })
        .filter({ visible: true })
        .getByText(live ? "✓ Live" : "Switched off"),
    ).toBeVisible();
  }

  /**
   * The promo box rides on pay-at-booking, which needs three things at once
   * (src/app/s/[shopSlug]/trips/[id]/page.tsx): a priced trip, a Stripe
   * account that can take a charge, and `publicAppUrl()` — a configured public
   * origin for Stripe's return links.
   *
   * The fleet now configures a real non-loopback `APP_HOST`
   * (playwright.config.ts `serverEnv`), so the origin holds everywhere. The
   * trip is *created* with a price because **no seeded upcoming departure
   * carries one** — every `priceCents` in src/db/seed.ts sits on a past trip
   * or a course, so the seeded board alone can never reach pay-at-booking
   * however the origin is configured. Same shape as e2e/refunds.spec.ts's
   * `createPaymentRequiredTrip`.
   *
   * The Stripe half is the caller's: POST /api/test/seed-stripe-account first
   * for the payable case, skip it for the fallback case, so each test differs
   * in exactly the one condition it is about.
   *
   * Returns on the *diver's* page under /s/<shopSlug> with the staff cookies
   * cleared — this is the anonymous visitor's booking form, not a staff
   * surface (ADR 20260803-public-shop-namespace).
   */
  async function pricedTripAsVisitor(page: Page, title: string) {
    await page.goto("/shop/blue-mantis/schedule/board?add=full");
    await page.getByLabel("What is it").fill(title);
    await page.getByLabel("Date").fill(daysFromNow(6));
    await page.getByLabel("Departs").fill("08:00");
    await page.getByLabel("Returns").fill("11:30");
    await page.getByLabel("Seats").fill("6");
    await page.getByLabel(/Price per diver/).fill("120");
    await page.getByRole("button", { name: "Put it on the board" }).click();
    await expect(page.getByRole("status")).toBeVisible();

    const tripLink = await findTripOnBoard(page, "blue-mantis", title);
    const tripId = (await tripLink.getAttribute("href"))?.split("/").at(-1);
    expect(tripId).toBeTruthy();

    // The board links staff at trip *management*; the booking form a diver sees
    // is the public page for the same departure, and a signed-in staff member
    // is redirected off it — so drop the session before opening it.
    await page.context().clearCookies();
    await page.goto(`/s/blue-mantis/trips/${tripId}`);
    // The booking form is controlled, so wait for hydration before typing.
    await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
  }

  test("a diver on a payable trip gets the promo box, and the shop's live code is accepted", async ({
    page,
    request,
  }) => {
    // Trip creation → board crawl → public page → a full booking submit that
    // runs the promo lookup, the party transaction, waiver-on-join, and the
    // checkout attempt. Several full flows chained, well past the 15s default.
    test.setTimeout(60_000);
    await request.post("/api/test/seed-stripe-account");
    await setSeededCodeLive(page, true);
    await pricedTripAsVisitor(page, `Promo Live Check ${e2eNow().getTime()}`);

    // The form is genuinely in its payable shape — the promo box only exists
    // here, so assert the state it belongs to rather than the box alone.
    await expect(page.getByText(/per diver — paid securely when you book\./)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Book and pay/ })).toBeVisible();
    await expect(page.getByText("You'll finish paying on a secure Stripe page.")).toBeVisible();

    // The hard assertion this spec exists for.
    const promoField = page.getByLabel("Promo code");
    await expect(promoField).toBeVisible();
    await expect(page.getByText("(if you have one)")).toBeVisible();

    // REEF10 is seeded at scope "all" with no window bounds (src/db/seed.ts)
    // and was driven live above — the one code a diver on this trip can
    // actually redeem. `bookSpot` resolves it *before* the party is booked
    // (task 20),
    // so an accepted code shows up as the absence of a refusal and a completed
    // booking, not as a re-rendered form.
    await page.getByLabel("Name", { exact: true }).fill("Promo Diver");
    await page
      .getByLabel("Email", { exact: true })
      .fill(`promo-live-${e2eNow().getTime()}@example.com`);
    await promoField.fill("reef10");
    await page.getByRole("button", { name: /^Book and pay/ }).click();

    // No `stripePromotionCodeId` can be honoured without a real
    // STRIPE_SECRET_KEY, so `startBookingCheckout` fails closed and the flow
    // degrades to the ordinary book-now-pay-later confirmation — deliberately,
    // so a Stripe outage can never cost a diver their seat
    // (docs ADR 20260721-checkout-at-booking). The seat is what's asserted;
    // the discount arithmetic is Stripe's and is unit-tested in
    // src/lib/promo-codes.ts (`discountedAmountCents`).
    await expect(page.getByRole("heading", { name: /You’re on the boat, Promo/ })).toBeVisible();
    await expect(page.getByText("That code isn't active.")).toHaveCount(0);
  });

  /**
   * The one behaviour a promo box must not have: telling a stranger which
   * codes a shop owns. `isPromoRedeemable` is deliberately boolean and
   * `bookSpot` maps every failure onto one message
   * (`booking.fieldErrors.promoInvalid`), so a switched-off real code and a
   * code that never existed are byte-identical to the diver. Asserting the two
   * separately would let them drift apart; this asserts they are the same
   * string, which is the actual contract.
   */
  test("a switched-off code and a code that never existed are refused identically", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    await request.post("/api/test/seed-stripe-account");
    // Switch the shop's one live code off first, as the owner — after this it
    // is a real code of this shop that simply can't be spent.
    await setSeededCodeLive(page, false);
    await pricedTripAsVisitor(page, `Promo Refusal Check ${e2eNow().getTime()}`);
    const promoField = page.getByLabel("Promo code");
    await expect(promoField).toBeVisible();
    await page.getByLabel("Name", { exact: true }).fill("Refused Diver");
    await page
      .getByLabel("Email", { exact: true })
      .fill(`promo-refused-${e2eNow().getTime()}@example.com`);

    const bookButton = page.getByRole("button", { name: /^Book and pay/ });
    const refusal = page.getByText("That code isn't active.");

    await promoField.fill("REEF10");
    await bookButton.click();
    await expect(refusal).toBeVisible();
    // Refused *before* the party is booked, so the diver is still on the form
    // with everything they typed — never a seat taken on a code that failed.
    await expect(page.getByRole("heading", { name: /You’re on the boat/ })).toHaveCount(0);
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Refused Diver");
    const switchedOffMessage = await refusal.textContent();

    // A code this shop has never had. Same message, word for word — the form
    // is not an oracle for enumerating a shop's codes.
    await promoField.fill("NOSUCHCODE99");
    await bookButton.click();
    await expect(refusal).toBeVisible();
    expect(await refusal.textContent()).toBe(switchedOffMessage);
    await expect(page.getByRole("heading", { name: /You’re on the boat/ })).toHaveCount(0);
  });

  /**
   * The fallback the promo box rides on top of, kept as its own test because
   * it is a real, user-reachable state a shop can sit in for months: priced
   * departures, a configured origin, and no Stripe connection yet. (Before the
   * fleet had an `APP_HOST` this was the *only* state reachable here, and this
   * file's booking-form test could assert nothing else.) Same priced trip as
   * the payable tests, so the Stripe connection is the one variable.
   */
  test("a shop that can't take a card books without a payment step or a promo box", async ({
    page,
  }) => {
    test.setTimeout(45_000);
    // No /api/test/seed-stripe-account: the demo seed leaves the shop
    // unconnected, so `canAcceptPayments` is false and pay-at-booking stays off
    // however the origin and the price are configured.
    await pricedTripAsVisitor(page, `Promo Unconnected Check ${e2eNow().getTime()}`);
    // The form has rendered (pricedTripAsVisitor waits on hydration), so "no
    // promo box" is a real absence rather than a not-yet-rendered one.
    await expect(
      page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }),
    ).toBeVisible();
    await expect(page.getByLabel("Promo code")).toHaveCount(0);
    await expect(page.getByText("(if you have one)")).toHaveCount(0);
    await expect(page.getByText("You'll finish paying on a secure Stripe page.")).toHaveCount(0);
  });
});
