import { expect, signedInAsOwner, test } from "./fixtures";
import {
  createTrip,
  daysFromNow,
  e2eNow,
  findTripOnBoard,
  openThreadStep,
  openTripAbout,
  signOut,
  threadStatus,
} from "./helpers";

test.describe("staff-prepared trip", () => {
  signedInAsOwner();

  /**
   * **The two rows on this checklist whose subject the words never named.**
   *
   * "There's a balance to settle" is the one row whose whole subject is a
   * number, and it carried none — the amount lived on the receipt panel above,
   * which exists only once something has *already* settled, so the diver being
   * asked to pay was the one reader who could not see the figure. And "Where
   * are you staying?", on a checklist of things a diver owes their shop, reads
   * as a records question: nobody volunteers their hotel room to a form that
   * has not said why it wants it.
   */
  test("the spine names the fare it is asking for, and says what the hotel is for", async ({
    page,
  }) => {
    // A priced trip that gates on payment, then a public booking against it —
    // two multi-navigation journeys plus a sign-out.
    test.setTimeout(60_000);
    const title = `Fare Named Run ${e2eNow().getTime()}`;

    await createTrip(page, {
      title,
      date: daysFromNow(4),
      departsAt: "08:00",
      returnsAt: "11:00",
      capacity: 6,
      price: 145,
    });
    // The seeded shop's default gate does not ask for payment, so this trip
    // has to say so itself — the row under test only exists on a departure
    // that gates on it.
    await (await findTripOnBoard(page, "blue-mantis", title)).click();
    await openTripAbout(page);
    await page.getByRole("heading", { name: "Readiness requirements" }).waitFor();
    const requirements = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Readiness requirements" }) });
    await requirements.getByText("Edit requirements").click();
    await requirements.getByLabel("Require payment to board").check();
    await requirements.getByRole("button", { name: "Save requirements" }).click();
    await signOut(page);

    await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
    await page
      .getByRole("list", { name: "Upcoming trips" })
      .locator("li")
      .filter({ hasText: title })
      .getByRole("link")
      .click();
    await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Name", { exact: true }).fill("Wren Halloway");
    await page.getByLabel("Email", { exact: true }).fill(`fare-${e2eNow().getTime()}@example.com`);
    await page.getByRole("button", { name: /^Book/ }).click();
    await expect(page).toHaveURL(/\/ready\//);

    // The fare, in the shop's own currency, on the step that is asking for it
    // — and on its summary line, so a diver reads it without opening anything.
    await expect(page.getByText("$145.00 to settle.")).toBeVisible();

    // And the lodging question asks about the *service*; the field under it
    // keeps the address label. Both ride inside Day-of details, which gates on
    // neither (ADR 20260827-the-divers-thread, decision 3).
    await openThreadStep(page, "dayof");
    await expect(page.getByRole("heading", { name: "Want a morning pickup?" })).toBeVisible();
    await expect(page.getByLabel("Where you’re staying")).toBeVisible();
  });

  test("a booked diver's readiness page lets them act, answers its questions, and releases the seat", async ({
    page,
  }) => {
    // Unique title for this spec's own trip; the e2eNow() suffix keeps every
    // test-side timestamp anchored to the frozen clock (helpers.ts).
    // Isolation from other specs — including the visual suite — comes from
    // the per-test demo reset in fixtures.ts.
    const title = `Readiness Run ${e2eNow().getTime()}`;

    // Staff puts a trip on the board.
    await createTrip(page, {
      title,
      date: daysFromNow(4),
      departsAt: "08:00",
      returnsAt: "11:00",
      capacity: 6,
    });
    await signOut(page);

    // A visitor books it.
    await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
    // Scoped to the trip list itself, the page's one stable anchor for
    // departures — day rules and other lists on the page never carry a
    // trip's title.
    await page
      .getByRole("list", { name: "Upcoming trips" })
      .locator("li")
      .filter({ hasText: title })
      .getByRole("link")
      .click();
    // The booking form is controlled, so wait for hydration before typing.
    await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Name", { exact: true }).fill("Nemo Quinn");
    // Same frozen-clock suffix convention as the trip title above.
    await page.getByLabel("Email", { exact: true }).fill(`nemo-${e2eNow().getTime()}@example.com`);
    await page.getByRole("button", { name: /^Book/ }).click();
    await expect(page.getByRole("heading", { name: /You’re on the boat/ })).toBeVisible();

    await expect(page).toHaveURL(/\/ready\//);
    // **The status is said once** (ADR 20260827-the-divers-thread, decision 3):
    // a figure and the next step, and nothing else on the page states it.
    await expect(threadStatus(page)).toHaveCount(1);
    await expect(threadStatus(page)).toContainText("Next:");
    // Gear is a step of the spine, in the divemaster's words rather than a
    // checkpoint's.
    await expect(page.getByText("Gear and sizes")).toBeVisible();
    // **At most one step is open at rest.** The waiver is the first thing on
    // this diver, so its step is the open one and every other body is shut.
    await expect(page.locator("[data-thread-step] details[open]")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Sign your waiver" })).toBeVisible();
    // The emergency contact is the waiver's question, and only the waiver's
    // (issue 627). Asking twice for one fact is how a diver ends up correcting
    // the copy the crew is not reading.
    await expect(page.getByRole("heading", { name: "Emergency contact" })).toHaveCount(0);

    // The diver's own words to the crew: inside Day-of details, saved on its
    // own action, so it cannot blank the sizes beside it (issue 627).
    await openThreadStep(page, "dayof");
    await page.getByLabel("Anything else the crew should know?").fill("Titanium hip, I run heavy.");
    await page.getByRole("button", { name: "Save note" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Saved. The crew will see that" }),
    ).toBeVisible();
    // Read back off the control itself, which is what the diver comes back to.
    // Re-opened first, because the save is a redirect: the fresh render puts
    // the open step back on whatever is first on the diver, not on this one.
    await openThreadStep(page, "dayof");
    await expect(page.getByLabel("Anything else the crew should know?")).toHaveValue(
      "Titanium hip, I run heavy.",
    );

    // Where the diver is actually going, and how to reach the people who will
    // be there. This page used to close on a one-line "Questions? Reach out to
    // {shop}" that named the shop and left the address to be hunted for.
    const shopCard = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Your dive shop" }) });
    await expect(shopCard.getByText("Blue Mantis Divers")).toBeVisible();
    await expect(shopCard.getByText("100 Ocean Drive")).toBeVisible();
    await expect(shopCard.getByText("Key Largo, FL 33037")).toBeVisible();
    await expect(shopCard.getByRole("link", { name: "hello@demo.invalid" })).toHaveAttribute(
      "href",
      "mailto:hello@demo.invalid",
    );
    // The map is a plain roadmap embed built from the shop's own address —
    // never a guessed location. The e2e context aborts maps.google.com
    // requests (fixtures.ts), so this asserts the frame, not its contents.
    await expect(shopCard.locator('iframe[title="Map of Blue Mantis Divers"]')).toHaveAttribute(
      "src",
      /100%20Ocean%20Drive/,
    );

    // The question no form asked until 2026-08-21 (ADR
    // 20260821-currency-is-what-catches-people). It gates nothing, so what is
    // worth proving is that the answer round-trips and the row settles.
    await openThreadStep(page, "dayof");
    await page
      .getByLabel("When did you last dive?")
      .selectOption({ label: "More than five years ago" });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Thanks. The crew will see that" }),
    ).toBeVisible();
    // The answer is the Day-of step's settled line now, so it reads without
    // opening anything — and the step has moved the figure, which is the
    // whole point of counting only steps a diver can finish.
    await expect(page.getByText("More than five years ago")).toBeVisible();

    // The diver releases their own seat (ADR
    // 20260821-the-diver-may-release-their-own-seat). Cancelling revokes this
    // very token, so the confirmation the diver lands on is served through the
    // relaxed-revocation branch — which is the half of this that a unit test
    // cannot reach. Asserted last because it ends the booking; every check
    // above needs a live seat.
    await page.getByRole("button", { name: "Cancel my spot" }).click();
    await page.getByRole("button", { name: "Yes, cancel my spot" }).click();
    await expect(page.getByRole("heading", { name: "This booking was cancelled" })).toBeVisible();

    // **And the same dead token, opened again later, names the shop.**
    //
    // `?cancelled=1` is what the redirect above carries; a diver coming back to
    // the bookmarked URL, or opening the link out of an old email, arrives
    // without it — and used to get four words telling them to ask a shop the
    // page would not name. `/ready` is the link in the 24-hour reminder, so
    // that is the ordinary way to reach it (issue #801).
    const readyUrl = new URL(page.url());
    readyUrl.search = "";
    await page.goto(readyUrl.toString());
    await expect(
      page.getByRole("heading", { name: /readiness link isn.t available/ }),
    ).toBeVisible();
    await expect(page.getByText(/Blue Mantis Divers/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Contact Blue Mantis Divers" })).toHaveAttribute(
      "href",
      "mailto:hello@demo.invalid",
    );

    // **And the card can now do something about it** — issue #850's half of the
    // same complaint. The button is offered to whoever holds the dead URL,
    // because the fresh link goes to the address already on the booking and
    // only an outcome code comes back here.
    //
    // This particular seat was cancelled a moment ago, so the honest answer is
    // a refusal: `issueBookingCapability` owns that rule, and a diver who
    // released their seat must not be mailed a working link back into it — nor
    // may anyone holding their old URL trigger one. That refusal is the half
    // worth driving through a real browser; the successful send is covered in
    // `src/db/readiness-link-rescue.test.ts`, where the mail can be inspected.
    await page.getByRole("button", { name: "Email me a fresh link" }).click();
    await expect(page.getByText(/can.t send a new link for this booking/)).toBeVisible();
    // **Nothing about the diver came back with it.** The refusal names no
    // address, so the one place the page could have leaked one — the diver's
    // own, which the rescue reads server-side to decide — is not on it.
    await expect(page.locator("body")).not.toContainText("nemo-");
    // And the button is gone: a cancelled seat is the one refusal that tapping
    // again can never change, so the card stops offering it.
    await expect(page.getByRole("button", { name: "Email me a fresh link" })).toHaveCount(0);

    // And the seat is genuinely back on the boat, not merely hidden from the
    // diver: the six-seat departure reads as six again, not five.
    await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("list", { name: "Upcoming trips" }).locator("li").filter({ hasText: title }),
    ).toContainText("6 spots left");
  });
});

test("a tampered readiness token reveals nothing", async ({ page }) => {
  await page.goto("/ready/not-a-real-token");
  await expect(page.getByRole("heading", { name: /readiness link isn.t available/ })).toBeVisible();
});

/**
 * The readiness page carries the day itself, not just what is left to do.
 *
 * The link a shop actually sends the night before is this one, and it used to
 * answer "what's outstanding?" and nothing else — no packing list, so a diver
 * had to go and find the trip page for the one thing they read on the drive
 * down (2026-08-06 review).
 *
 * The dive briefings that used to ride below it are gone as of slice 7c: "what
 * you'll see down there" is the trip page's pitch and, once the boat is home,
 * the keepsake's; what to *bring* is preparation, and preparation is this
 * page's whole job (ADR 20260827-the-divers-thread, decisions 2 and 3).
 */
test("a booked diver's thread carries the packing list, and no briefing deck", async ({ page }) => {
  test.setTimeout(60_000);
  // A seeded two-tank charter, so there are real dives at real sites.
  await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("list", { name: "Upcoming trips" })
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link")
    .first()
    .click();
  await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name", { exact: true }).fill("Ada Marlowe");
  await page.getByLabel("Email", { exact: true }).fill(`ada-${e2eNow().getTime()}@example.com`);
  await page.getByRole("button", { name: /^Book/ }).click();
  await expect(page).toHaveURL(/\/ready\//);

  // What to put in the bag.
  await expect(page.getByRole("heading", { name: "Pack with confidence" })).toBeVisible();
  // Including the suit. This page renders no conditions card — it is sizes and
  // paperwork — so if the packing list stays quiet, the page a diver reads the
  // morning they sail says nothing about the water they are getting into. The
  // booking page states it under the reading instead; here it has nowhere else
  // to go (src/app/s/[shopSlug]/trips/[id]/_components/PackingSection.tsx).
  await expect(page.getByText(/most divers are comfortable in a 3 mm/i)).toBeVisible();
  // And no deck of site briefings under it.
  await expect(page.getByText("Dive briefings")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Your two-tank plan" })).toHaveCount(0);

  // The spine is still the page's own job, above all of it.
  await expect(threadStatus(page)).toHaveCount(1);
});

/**
 * **A deep link opens the step it names.**
 *
 * The spine's steps are one native `<details name>` accordion, so at most one
 * is open at rest — which means a link into a step (a reminder pointing at
 * "your gear sizes") lands on a closed disclosure unless something opens it.
 * `AutoOpenDetails` is that something, and a client-side route change is
 * exactly the case the browser's own reveal algorithm does not cover.
 */
test("a link into one step of the thread opens that step", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("list", { name: "Upcoming trips" })
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link")
    .first()
    .click();
  await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name", { exact: true }).fill("Deep Linker");
  await page.getByLabel("Email", { exact: true }).fill(`deep-${e2eNow().getTime()}@example.com`);
  await page.getByRole("button", { name: /^Book/ }).click();
  await expect(page).toHaveURL(/\/ready\//);

  const bare = new URL(page.url()).pathname;
  await page.goto(bare);
  // At rest: the waiver is what is on this diver, so its step is the open one.
  await expect(page.locator("[data-thread-step] details[open]")).toHaveCount(1);
  await expect(page.locator('[data-thread-step="gear"] details')).not.toHaveAttribute("open", "");

  await page.goto(`${bare}#step-gear`);
  await expect(page.locator('[data-thread-step="gear"] details')).toHaveAttribute("open", "");
  // Still one open step: opening one member of a `<details name>` group closes
  // the rest, which is what keeps the promise true after a tap as well as
  // before one.
  await expect(page.locator("[data-thread-step] details[open]")).toHaveCount(1);
});
