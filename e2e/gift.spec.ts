import { DEMO_RECAP_BOOKING_ID } from "../src/db/seed";
import { signRecapToken } from "../src/lib/recap-links";
import { expect, makeActivitySafe, signedInAsOwner, test } from "./fixtures";
import {
  createTrip,
  daysFromNow,
  e2eNow,
  openTripAbout,
  openTripFromBoard,
  signInAsOwner,
  signOut,
} from "./helpers";

/**
 * **Give a dive** (ADR 20260908-one-hand, decision 6, lever W; owner's call
 * (l)) — the whole loop, on three devices.
 *
 * Hannah buys a seat for Ben and never sees a checklist; Ben opens the link
 * and the seat becomes his, with his own name, his own contact and his own
 * waiver; Hannah watches the row settle from a page that shows her four facts
 * and nothing else. Then the boat cannot go, and her page says where the money
 * went and offers the same seat on the next departure.
 *
 * The two claims that have to hold and cannot be read off a screenshot are
 * asserted here rather than described: a gift takes a real seat, and readiness
 * stays the receiver's.
 */
const REEF_TRIP = "Two-Tank Reef — Molasses & French";

test.describe("give a dive", () => {
  signedInAsOwner();

  test("Hannah gives Ben a seat, Ben claims it, and the blow-out sends the money back", async ({
    page,
    browser,
    request,
    workerBaseURL,
  }) => {
    // Four actors' worth of sequential navigation (staff setup, the giver, the
    // receiver, staff again) — the same aggregate-cost reasoning
    // seat-claim.spec.ts gives for its own budget.
    test.setTimeout(90_000);
    const stamp = e2eNow().getTime();
    const title = `Gift Charter ${stamp}`;
    const giverEmail = `hannah-${stamp}@example.com`;

    await createTrip(page, {
      title,
      date: daysFromNow(4),
      departsAt: "07:00",
      returnsAt: "12:00",
      capacity: 6,
      price: 95,
    });
    await signOut(page);

    // ——— The giver, on the public trip page.
    await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
    await page
      .getByRole("list", { name: "Upcoming trips" })
      .locator("li")
      .filter({ hasText: title })
      .getByRole("link")
      .click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();

    await page.getByRole("radio", { name: "Someone else, as a gift" }).check();
    // The diver's own fields are gone with the choice: a gift asks three
    // questions about somebody else and none about the person answering.
    await expect(page.getByLabel("Their name")).toBeVisible();
    await page.getByLabel("Their name").fill("Ben Carter");
    await page.getByLabel("A line from you").fill("From Hannah, for your birthday");
    await page.getByLabel("Your name", { exact: true }).fill("Hannah Liu");
    await page.getByLabel("Your email", { exact: true }).fill(giverEmail);
    await page.getByRole("button", { name: /Make the pass|Pay and make the pass/ }).click();

    // ——— The giver's own page: four facts, and nothing about Ben's diving.
    await page.waitForURL(/\/gift\//);
    await expect(page.getByRole("heading", { name: "Ben Carter’s seat" })).toBeVisible();
    await expect(page.getByText("Not claimed yet")).toBeVisible();
    await expect(page.getByText("Waiver not signed yet")).toBeVisible();
    await expect(page.getByText("Not aboard yet")).toBeVisible();
    await expect(page.getByText("From Hannah, for your birthday")).toBeVisible();
    // What a giver never sees. `innerText` rather than `textContent`, so this
    // reads what is rendered rather than the streaming payload's own scripts.
    const giverText = await page.locator("body").innerText();
    expect(giverText).not.toMatch(/certification|Open Water|medical/i);
    const giverUrl = page.url();

    // ——— The link the giver forwards. In the product it arrives in Hannah's
    // inbox and she sends it on; the giver's page deliberately does not re-mint
    // it, so a spec with no inbox takes it from the test route the same way
    // `seed-booking-handoff` hands over a handoff.
    const minted = await request.post("/api/test/seed-gift", {
      data: { giftToken: new URL(giverUrl).pathname.split("/")[2] },
    });
    expect(minted.ok(), await minted.text()).toBe(true);
    const { claimPath } = (await minted.json()) as { claimPath: string };

    // ——— Ben, on his own device, opens the pass and claims it.
    const benContext = await browser.newContext({ baseURL: workerBaseURL });
    const benPage = makeActivitySafe(await benContext.newPage());
    await benPage.goto(claimPath);
    await expect(
      benPage.getByRole("heading", { name: `A seat on ${title} is yours to claim` }),
    ).toBeVisible();
    // The giver's line is on the pass; nothing else about the giver is.
    await expect(benPage.getByText("From Hannah, for your birthday")).toBeVisible();
    await expect(benPage.getByText(/Hannah Liu bought this seat/)).toBeVisible();
    expect(await benPage.locator("body").innerText()).not.toContain(giverEmail);

    await benPage.getByLabel("Your name").fill("Ben Carter");
    await benPage.getByLabel("Your email").fill(`ben-${stamp}@example.com`);
    await benPage.getByRole("button", { name: "Claim this seat" }).click();
    // **Readiness is his**: the claim lands on his own trip-prep page, which is
    // where the waiver and the certification are asked for.
    await benPage.waitForURL(/\/ready\//);
    await expect(benPage.getByText(/waiver/i).first()).toBeVisible();
    await benContext.close();

    // ——— The giver's page settles.
    await page.goto(giverUrl, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/^Claimed · /)).toBeVisible();
    // Ben's own spelling of his name never reaches her page — she reads back
    // what she typed.
    await expect(page.getByRole("heading", { name: "Ben Carter’s seat" })).toBeVisible();

    // ——— The boat cannot go. Staff again: the giver's browser signed out
    // before it ever reached the storefront, so the board needs a real
    // sign-in rather than the seeded storage state.
    await signInAsOwner(page);
    await page.goto("/shop/blue-mantis/schedule/board");
    await openTripFromBoard(page, title);
    await openTripAbout(page);
    await page.getByRole("link", { name: "Weather blow-out…" }).click();
    await page.getByRole("button", { name: "Call the blow-out" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Blow-out cascade" })).toBeVisible();

    await page.goto(giverUrl, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("This departure cannot go out")).toBeVisible();
    // One door, and it opens the next departure's form already on the gift.
    const giveAgain = page.getByRole("link", { name: "Give the same seat on the next departure" });
    await expect(giveAgain).toBeVisible();
  });

  /**
   * **The buddy seat** (ADR 20260908-one-hand, decision 6, lever W). Ravi's
   * recap ends on a link; Amira opens it, books her own seat, signs her own
   * waiver, and the shop's month counts one seat that came from a diver.
   *
   * The thing this proves that no screenshot can: the link is honoured from the
   * **storefront**, not only from the departure it happens to land on — the
   * cookie the edge sets is what carries the referral to whichever boat she
   * picks. That a mangled id is *ignored* rather than refused is pinned one
   * layer down, in `src/db/buddy-referrals.test.ts`.
   */
  test("Ravi's recap link brings Amira, and the month counts her seat", async ({
    page,
    workerBaseURL,
  }) => {
    test.setTimeout(60_000);
    await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID)}`);
    await expect(page.getByRole("heading", { name: "Bring a buddy next time" })).toBeVisible();
    // Printed rather than hidden: this id names a booking and authorizes
    // nothing, and a diver about to paste it into a message needs to see it.
    const link = (await page.getByText(/\/s\/blue-mantis\?via=/).textContent()) ?? "";
    const via = new URL(link, workerBaseURL).searchParams.get("via");
    expect(via).toBeTruthy();

    // The friend arrives on the storefront, not on a departure — the cookie
    // the edge sets is what carries the referral to whichever boat she picks.
    await page.goto(`/s/blue-mantis?via=${via}`, { waitUntil: "domcontentloaded" });
    await page
      .getByRole("list", { name: "Upcoming trips" })
      .locator("li")
      .filter({ hasText: REEF_TRIP })
      .first()
      .getByRole("link")
      .first()
      .click();
    // The departure's own masthead — the page also names the trip in the
    // "also on the schedule" rail, so the level-1 heading is the one to wait on.
    await expect(page.getByRole("heading", { level: 1, name: REEF_TRIP })).toBeVisible();
    await page.getByLabel("Name", { exact: true }).fill("Amira Khan");
    await page.getByLabel("Email", { exact: true }).fill(`amira-${e2eNow().getTime()}@example.com`);
    await page.getByRole("button", { name: /Book (this|these) spots?|Book and pay/ }).click();
    await page.waitForURL(/\/ready\//);

    // The shop's month says one seat came from a diver's link. This browser
    // never signed out — `signedInAsOwner` seeded the session and the diver's
    // half of this test only ever read public pages — so the board is one
    // navigation away.
    await page.goto("/shop/blue-mantis/reports");
    await expect(page.getByText(/arrived on a buddy’s link/)).toBeVisible();
  });
});
