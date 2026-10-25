import type { Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  createTrip,
  daysFromNow,
  e2eNow,
  findTripOnBoard,
  openIfClosed,
  openThreadStep,
  openTripAbout,
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
    // The About panel's "Who can book" row: its own control opens the gate's
    // editor beneath it, and there is no headed card restating the row.
    const requirements = page.locator("details#requirements");
    await openIfClosed(requirements);
    await requirements.getByLabel("Require payment to board").check();
    await requirements.getByRole("button", { name: "Save requirements" }).click();
    // Wait for the save's own redirect: dropping the session while it is in
    // flight lets that redirect land after the session is gone, on /sign-in.
    await expect(page.getByRole("status")).toContainText("requirements updated");
    // The visitor below is anyone without the staff cookie (see
    // `bookStaffPreparedTrip`).
    await page.context().clearCookies();

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
    await expect(page.getByRole("heading", { name: "Want a pickup?" })).toBeVisible();
    await expect(page.getByLabel("Where you’re staying")).toBeVisible();
  });

  /**
   * **A staff-prepared departure, booked by a visitor**, landing on the
   * booking's own `/ready` page. Shared by the two tests below, which used to
   * be one: the readiness page's questions and the seat release each fit the
   * 15s budget on their own, and together they did not on a loaded machine.
   */
  async function bookStaffPreparedTrip(page: Page): Promise<string> {
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
    // A visitor is anyone without the staff cookie. Dropping it, rather than
    // signing out through the identity menu, saves the menu's three taps and
    // leaves the server session alive, so the worker's cached staff sign-in
    // (`signedInAsOwner`) still serves the next test instead of being redone;
    // sign-out itself is `auth.spec.ts`'s subject, not this one's.
    await page.context().clearCookies();

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
    await expect(page.getByRole("heading", { name: /You’ve got a seat/ })).toBeVisible();

    await expect(page).toHaveURL(/\/ready\//);
    return title;
  }

  test("a booked diver's readiness page lets them act and answers its questions", async ({
    page,
  }) => {
    await bookStaffPreparedTrip(page);
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

    // The diver's own words to the crew: inside Day-of details, written to
    // the note column alone, so it cannot blank the sizes beside it (issue
    // 627). One Save for the whole step (third UX review, item 24): the pickup
    // answered beside it is kept too, not only the last thing typed.
    await openThreadStep(page, "dayof");
    await page.getByLabel("Anything else the crew should know?").fill("Titanium hip, I run heavy.");
    await page.getByLabel("Where you’re staying").fill("Ocean Pointe, room 12");
    await page.getByRole("button", { name: "Save day-of details" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Saved. The crew will see your answers" }),
    ).toBeVisible();
    // Read back off the control itself, which is what the diver comes back to.
    // Re-opened first, because the save is a redirect: the fresh render puts
    // the open step back on whatever is first on the diver, not on this one.
    await openThreadStep(page, "dayof");
    await expect(page.getByLabel("Anything else the crew should know?")).toHaveValue(
      "Titanium hip, I run heavy.",
    );
    await expect(page.getByLabel("Where you’re staying")).toHaveValue("Ocean Pointe, room 12");

    // Where the diver is actually going, and how to reach the people who will
    // be there. This page used to close on a one-line "Questions? Reach out to
    // {shop}" that named the shop and left the address to be hunted for; it
    // then closed on a trailing "Your dive shop" card that said the address,
    // the phone, the email and the map link a *second* time, under "Where to
    // go". One card says it now, and it is this one.
    const arrivalCard = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Where to go" }) });
    await expect(arrivalCard.getByText("Blue Mantis Divers")).toBeVisible();
    await expect(arrivalCard.getByText("100 Ocean Drive")).toBeVisible();
    await expect(arrivalCard.getByText("Key Largo, FL 33037")).toBeVisible();
    await expect(
      arrivalCard.getByRole("link", { name: "front.desk@mail.example" }),
    ).toHaveAttribute("href", "mailto:front.desk@mail.example");
    // The map is drawn only once the map host answers (fourth UX review
    // item 4, `useMapReachable`). The e2e context refuses that probe
    // (fixtures.ts), which is a marina with one bar: the card carries no
    // empty frame, and the address above it stands alone. The frame's own
    // `src`, the shop's own address, is pinned in TripArrivalCard.test.tsx.
    await expect(page.getByRole("heading", { name: "Your dive shop" })).toHaveCount(0);
    await expect(page.locator("iframe[title^='Map of']")).toHaveCount(0);

    // The question no form asked until 2026-08-21 (ADR
    // 20260821-currency-is-what-catches-people). It gates nothing, so what is
    // worth proving is that the answer round-trips and the row settles.
    await openThreadStep(page, "dayof");
    await page
      .getByLabel("When did you last dive?")
      .selectOption({ label: "More than five years ago" });
    await page.getByRole("button", { name: "Save day-of details" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Saved. The crew will see your answers" }),
    ).toBeVisible();
    // The answer is the Day-of step's settled line now, so it reads without
    // opening anything — and the step has moved the figure, which is the
    // whole point of counting only steps a diver can finish.
    await expect(page.getByText("More than five years ago")).toBeVisible();
  });

  test("a booked diver releases their own seat, and the dead link still names the shop", async ({
    page,
  }) => {
    const title = await bookStaffPreparedTrip(page);
    // The diver releases their own seat (ADR
    // 20260821-the-diver-may-release-their-own-seat). Cancelling revokes this
    // very token, so the confirmation the diver lands on is served through the
    // relaxed-revocation branch — which is the half of this that a unit test
    // cannot reach. Its own test because it ends the booking, which every
    // check in the test above needs live.
    await page.getByRole("button", { name: "Cancel my seat" }).click();
    await page.getByRole("button", { name: "Yes, cancel my seat" }).click();
    await expect(page.getByRole("heading", { name: "This booking was canceled" })).toBeVisible();
    // Never a dead end: the schedule is one tap away (third UX review, item 16).
    await expect(page.getByRole("link", { name: "See what’s coming up" })).toHaveAttribute(
      "href",
      /^\/s\/[^/]+$/,
    );

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
    await expect(page.getByRole("heading", { name: /This link no longer works/ })).toBeVisible();
    await expect(page.getByText(/Blue Mantis Divers/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Contact Blue Mantis Divers" })).toHaveAttribute(
      "href",
      "mailto:front.desk@mail.example",
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
    ).toContainText("6 seats");
  });
});

test("a tampered readiness token reveals nothing, and still leaves a door", async ({ page }) => {
  await page.goto("/ready/not-a-real-token");
  await expect(page.getByRole("heading", { name: /This link no longer works/ })).toBeVisible();
  // No shop to name, so DiveDay's own door rather than a dead end (UX review
  // 2026-10-10, item 11).
  await expect(page.getByRole("link", { name: "Go to DiveDay" })).toHaveAttribute("href", "/");
});

// The course-forms page signs a student's paperwork on the prep link's own
// capability (course-forms.spec.ts signs a real one). A forged link opens no
// form: it falls back to the prep link, which says the link is not available.
test("a tampered course-forms link opens no form and falls back to the prep link", async ({
  page,
}) => {
  await page.goto("/ready/not-a-real-token/forms");
  await expect(page).toHaveURL(/\/ready\/not-a-real-token$/);
  await expect(page.getByRole("heading", { name: /This link no longer works/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Sign/ })).toHaveCount(0);
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

/**
 * **A returning diver is asked once, and a yes goes straight to the fact** —
 * ADR 20260904-reef-all-the-way-down, D15 with D19 folded in, and D14 for the
 * recall line.
 *
 * The state has no UI that can reach it: `fit_stated_at` must predate the
 * booking, which no form can produce for a seat booked five seconds ago, and
 * the fit confirmation is written by the evening leftover row that has not
 * landed. `/api/test/seed-returning-diver` is the only door to it — the same
 * argument the changed-dive-site seed makes one table over.
 */
test("a returning diver is asked once, and answering one fact leaves the others alone", async ({
  page,
  request,
}) => {
  // A public booking, a seed, a reload, then three passes over the thread.
  test.setTimeout(90_000);
  const email = `returning-${e2eNow().getTime()}@example.com`;

  await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("list", { name: "Upcoming trips" })
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link")
    .first()
    .click();
  await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name", { exact: true }).fill("Rosa Delgado");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: /^Book/ }).click();
  await expect(page).toHaveURL(/\/ready\//);
  const thread = new URL(page.url()).pathname;

  // A first-time booking's thread: the gear row, and no question about change.
  await page.goto(thread);
  await expect(page.locator('[data-thread-step="gear"]')).toHaveCount(1);
  await expect(page.locator('[data-thread-step="changes"]')).toHaveCount(0);

  const seeded = await request.post("/api/test/seed-returning-diver", {
    data: { shopSlug: "blue-mantis", email },
  });
  expect(seeded.ok()).toBe(true);

  await page.goto(thread);
  // Replaced rather than joined: one slot, one question, never two rows for the
  // one fact.
  await expect(page.locator('[data-thread-step="changes"]')).toHaveCount(1);
  await expect(page.locator('[data-thread-step="gear"]')).toHaveCount(0);
  // The figure still counts five steps, and the one it points at is still the
  // first thing on this diver — the waiver. The question is a step of the
  // thread, not a thing that jumps the queue.
  await expect(threadStatus(page)).toContainText("of 4 done");
  await expect(threadStatus(page)).toContainText("Next: sign your waiver");

  const changes = await openThreadStep(page, "changes");
  await expect(changes.getByText("Sizes")).toBeVisible();
  await expect(changes.getByText("Tanks")).toBeVisible();
  await expect(changes.getByText("Emergency contact")).toBeVisible();
  // The sizes the shop is actually holding, and who kept them (D14).
  await expect(changes.getByText(/BCD M/)).toBeVisible();
  await expect(
    changes.getByText("Keiko Tanaka kept your BCD at M after your last trip."),
  ).toBeVisible();
  await expect(changes.getByText(/Marisol Vega/)).toBeVisible();

  // The figure before the answer, so the move can be read off it rather than
  // guessed at.
  const before = await threadStatus(page).innerText();

  await changes.getByRole("button", { name: "Nothing changed" }).click();
  await expect(page.getByText("Thanks for checking.")).toBeVisible();
  // Settled, and stating the same fact the gear step would have — no new
  // sentence for one fact, and nothing saying "you confirmed".
  await expect(page.locator('[data-thread-step="changes"]')).toContainText(
    "Your sizes are with the crew.",
  );
  // The figure moved by one, which is what makes the step countable rather than
  // a row that answers nothing.
  expect(await threadStatus(page).innerText()).not.toBe(before);

  // Now change one fact through its own door, and nothing else moves. That is
  // the boundary #1175 and #1179 both state: a post to one fact may never reach
  // another's columns.
  //
  // Each fact is a `<details>` of its own *inside* the step, so the step being
  // open is not enough — the tanks question is behind its own door, exactly as
  // a diver finds it. Waited on the door's own `open` attribute, the way
  // `openThreadStep` does, rather than on the control inside it.
  const reopened = await openThreadStep(page, "changes");
  const tanks = reopened.locator("details").filter({ hasText: "Air or nitrox?" }).first();
  await tanks.locator(":scope > summary").click();
  await expect(tanks).toHaveAttribute("open", "");
  await tanks.getByLabel("Air or nitrox?").selectOption("on");
  await tanks.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Tank choice saved")).toBeVisible();

  // The one fact that moved, and the two that did not.
  const after = await openThreadStep(page, "changes");
  await expect(after.getByText("Nitrox").first()).toBeVisible();
  await expect(after.getByText(/BCD M/)).toBeVisible();
  await expect(after.getByText(/Marisol Vega/)).toBeVisible();
});
