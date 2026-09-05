import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";
import {
  chooseDiveIntent,
  choosePartySize,
  createTrip,
  daysFromNow,
  e2eNow,
  openRosterDetails,
  openTripAbout,
  openTripActivity,
  signInAsOwner,
  signOut,
  threadStatus,
} from "./helpers";

test.describe("staff", () => {
  signedInAsOwner();

  test("full loop: staff schedules, visitor books, staff sees the roster", async ({ page }) => {
    // Chains several sequential navigations and status-toast waits — same
    // aggregate-cost reasoning as visual.spec.ts's test.setTimeout and the
    // sibling fix on this file's identity-confirmation test: legitimate
    // per-step cost under 2-worker CI load can sum past the default 15s
    // test budget even when no individual step is stuck.
    test.setTimeout(30_000);
    const title = `Eagle Ray Run ${e2eNow().getTime()}`;

    // Staff puts a trip on the board.
    await createTrip(page, {
      title,
      date: daysFromNow(5),
      departsAt: "08:00",
      returnsAt: "11:30",
      capacity: 6,
      price: 120,
    });
    await signOut(page);

    // A visitor books it from the public schedule — no account.
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
    // Wait for the navigation itself, not just for the title to be on screen —
    // the schedule page carries the same heading text this click came from, so
    // an assertion below could otherwise pass its *visibility* check against
    // the page we just left. The badge assertion is the one that
    // notices, as a strict-mode violation on two identical spans, and only when
    // the machine is slow enough for the assertion to win the race. Same hazard
    // the list locator above is scoped against, one step later in the flow.
    await page.waitForURL(/\/s\/blue-mantis\/trips\//);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByText("6 spots left")).toBeVisible();
    // Two spellings on purpose, one per job: the hero's "$120" is a price
    // being *scanned*, which drops minor units it does not have
    // (`formatMoneyScanned`, issue #769); the money block's "$120.00" is the
    // arithmetic being *shown*, where the total carries its cents like the
    // addends above it or the sum reads as rounding (principle 6; 2026-08-28
    // diver-views review, finding 3).
    await expect(page.getByText("$120", { exact: true })).toHaveCount(1);
    // Twice inside the card: the fare line's value and the total it sums to.
    await expect(page.getByLabel("Grab a spot").getByText("$120.00", { exact: true })).toHaveCount(
      2,
    );
    await choosePartySize(page, 2);
    await page.getByLabel("Name", { exact: true }).fill("Nora Quinn");
    await page.getByLabel("Email", { exact: true }).fill(`nora-${e2eNow().getTime()}@example.com`);
    await page.getByLabel("Diver 2 name").fill("Sam Quinn");
    await page.getByLabel("Diver 2 email").fill(`sam-${e2eNow().getTime()}@example.com`);
    // **What this dive is for** (ADR 20260904-reef-all-the-way-down, D12): five
    // plain choices in place of the free-text box this replaced, and the first
    // of them is what opens D18's three offers underneath.
    await chooseDiveIntent(page, "Getting comfortable again");
    await expect(page.getByText("None of these changes whether you can book.")).toBeVisible();
    // The three offers are ordinary 16px radios, not the sr-only pills above.
    await page.getByRole("radio", { name: "A word with the divemaster before we get in." }).check();
    await page.getByRole("button", { name: "Book these spots" }).click();
    // Booking lands on the diver's own readiness page, not a branch of the
    // trip page — one page after booking, and the one the confirmation email
    // links to (ADR 20260820-one-page-after-booking).
    await expect(page).toHaveURL(/\/ready\//);
    await expect(page.getByRole("heading", { name: /You’re on the boat, Nora/ })).toBeVisible();

    // No email provider is configured in the e2e fleet, so nothing left the
    // building — and the page must not claim two emails are coming when they
    // aren't.
    await expect(page.getByText(/Two emails are on their way/)).toHaveCount(0);

    // WP-3: the celebration takes the top — it sits above the pre-trip content
    // (pack list, briefings), not buried at the bottom of a long page. Asserted
    // before the waiver hop below, because `?booked=1` is a one-shot flash
    // param: coming back to this URL afterwards is the ordinary checklist, with
    // no earned moment to measure.
    const confirmationBox = await page
      .getByRole("heading", { name: /You’re on the boat, Nora/ })
      .boundingBox();
    const packBox = await page.getByRole("heading", { name: "Pack with confidence" }).boundingBox();
    expect(confirmationBox?.y ?? 0).toBeLessThan(packBox?.y ?? Number.POSITIVE_INFINITY);

    // The waiver is the real next step, and the checklist offers it directly.
    await page.getByRole("button", { name: "Sign your waiver" }).click();
    await expect(page).toHaveURL(/\/waivers\//);
    await page.goBack();
    await expect(threadStatus(page)).toBeVisible();

    // Both named spots are held atomically.
    await page.goto("/s/blue-mantis");
    const card = page.locator("li").filter({ hasText: title });
    await expect(card.getByText("4 spots left").filter({ visible: true })).toBeVisible();

    // Staff sees the diver on the roster. Today is a work queue, so open the trip
    // from the schedule (staff cards link straight to the management view). This
    // leg re-walks the real sign-in form on purpose: the loop is the point.
    await signInAsOwner(page);
    await page.goto("/shop/blue-mantis/schedule/board");
    await page.locator("li").filter({ hasText: title }).getByRole("link").click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    // The roster lives on the Guests tab now.
    await expect(page.getByText("Nora Quinn").first()).toBeVisible();
    await expect(page.getByText("Sam Quinn").first()).toBeVisible();
    // The ask reaches the crew as a fact beside the name, on the seat that made
    // it — never as a warning, and never on the party member who said nothing.
    await expect(page.getByText("Asked for a word with the divemaster.")).toHaveCount(1);

    // Removing a booking confirms first — it can fire an automatic refund that
    // undo can't claw back, so a misclick shouldn't be one tap from done.
    // Two-tap InlineConfirm, not a native dialog: the first tap only arms it.
    const noraRow = page.locator("li").filter({ hasText: "Nora Quinn" }).filter({ visible: true });
    await openRosterDetails(noraRow);
    await noraRow.getByRole("button", { name: "Remove booking" }).click();
    await expect(noraRow).toContainText("Remove Nora Quinn from this trip?");
    await noraRow.getByRole("button", { name: "Never mind" }).click();
    await expect(page.getByText("Nora Quinn").first()).toBeVisible();

    await openRosterDetails(noraRow);
    await noraRow.getByRole("button", { name: "Remove booking" }).click();
    await noraRow.getByRole("button", { name: "Yes, remove booking" }).click();
    await expect(page.getByRole("status")).toContainText("Booking cancelled");
    // Scoped to the roster: removals now also write the trip activity trail
    // ("… removed Nora Quinn from the trip"), so the name legitimately stays
    // on the page — what must be gone is her seat.
    await expect(page.locator("#roster").getByText("Nora Quinn")).toHaveCount(0);
    await openTripActivity(page);
    await expect(page.getByText(/removed Nora Quinn from the trip/)).toBeVisible();
    await expect(page.locator("#roster").getByText("Sam Quinn").first()).toBeVisible();
  });

  test("a crew conditions hold pauses public booking and explains the final-call state", async ({
    page,
  }) => {
    // The same aggregate-cost budget the three sibling tests in this file
    // already carry, and for the same reason: create a trip, cross to the
    // board, open the trip, open a disclosure, publish, sign out, land on the
    // public page. Seven sequential navigations, no stuck step — this was the
    // one test of that shape here that never got the raise, so it sat just
    // inside the default 15s alone and just outside it under worker load.
    test.setTimeout(30_000);
    const title = `Weather Watch ${e2eNow().getTime()}`;
    await createTrip(page, {
      title,
      date: daysFromNow(4),
      departsAt: "08:00",
      returnsAt: "11:00",
      capacity: 6,
    });
    await page.goto("/shop/blue-mantis/schedule/board");
    const manageLink = page
      .locator('a[href^="/shop/blue-mantis/trips/"]')
      .filter({ hasText: title })
      .filter({ visible: true })
      .first();
    const manageHref = await manageLink.getAttribute("href");
    expect(manageHref).toMatch(/^\/shop\/blue-mantis\/trips\/[0-9a-f-]+$/i);
    const tripId = manageHref?.split("/").at(-1);
    await manageLink.click();

    // The conditions form waits behind the section's disclosure (summary-first
    // Overview); no prediction is published yet, so the toggle reads "Publish".
    await openTripAbout(page);
    await page.getByText("Write a crew prediction", { exact: true }).click();
    await page.getByRole("checkbox", { name: "Conditions hold" }).check();
    await page.getByLabel("Conditions overview").fill("The captain is watching a passing squall.");
    await page.getByRole("button", { name: "Publish crew prediction" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Crew prediction published. Divers will see it now.",
    );
    await signOut(page);

    await page.goto(`/s/blue-mantis/trips/${tripId}`);
    await expect(
      page.getByRole("heading", { name: "This trip is on a conditions hold" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: /Nothing to book here yet/ })).toBeVisible();
    await expect(page.getByLabel("Number of divers")).toHaveCount(0);
  });

  test("staff edits a trip and cancelling removes it from the public schedule", async ({
    page,
  }) => {
    // Same aggregate sequential-navigation cost as this file's other heavy
    // tests — see the comment on "full loop" above.
    test.setTimeout(30_000);
    const title = `Drift Dive ${e2eNow().getTime()}`;
    const renamed = `${title} (PM)`;

    await createTrip(page, {
      title,
      date: daysFromNow(6),
      departsAt: "13:00",
      returnsAt: "16:00",
    });

    // Edit the title from the manage page (opened from the schedule). Staff are
    // routed to the editable trip view, never the public booking form.
    await page.goto("/shop/blue-mantis/schedule/board");
    await page
      .locator("li")
      .filter({ hasText: title })
      // Exact match: an unpriced trip's card also carries a "Set a price
      // for {title}, ..." link whose accessible name contains the trip
      // title as a substring.
      .getByRole("link", { name: title, exact: true })
      .click();
    await expect(page.getByRole("button", { name: "Book my spot" })).toHaveCount(0);
    // The details form waits behind its Edit disclosure (summary-first Overview).
    await openTripAbout(page);
    await page.getByText("Edit details", { exact: true }).click();
    await page.getByLabel("Title").fill(renamed);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toContainText("Changes saved");
    await expect(page.getByRole("heading", { name: renamed })).toBeVisible();
    const manageUrl = page.url();

    // Cancel: gone from public schedule; reinstate: back.
    await openTripAbout(page);
    await page.getByRole("button", { name: /Cancel (trip|this departure)/ }).click();
    // The cancellation badge is in the shared masthead and keeps the state
    // visible after the redirect; match the word rather than the lifecycle
    // notice, which is also present on this page.
    await expect(page.getByText("Cancelled").filter({ visible: true }).first()).toBeVisible();
    await page.goto("/shop/blue-mantis/schedule/board");
    await expect(
      page.locator("li").filter({ hasText: renamed }).filter({ visible: true }),
    ).toHaveCount(0);

    await page.goto(manageUrl);
    await page.getByRole("button", { name: "Reinstate trip" }).click();
    await expect(page.getByRole("status")).toContainText("Back on");
    await page.goto("/shop/blue-mantis/schedule/board");
    await expect(
      page.locator("li").filter({ hasText: renamed }).filter({ visible: true }),
    ).toBeVisible();
  });
});

/**
 * **What the divers came for, and what one of them asked for** (ADR
 * 20260904-reef-all-the-way-down; issues #1172/D12, #1183/D23, #1178/D18).
 *
 * Two halves that cannot be proved from either side alone: a diver answers an
 * optional question on a public form, and a divemaster reads a *count* on the
 * team builder that names nobody. Plus D18's window — the three offers go once
 * the shop can no longer act on one, and the question underneath them stays,
 * because a crew can read a count at any notice.
 */
test.describe("staff", () => {
  signedInAsOwner();

  test("a diver's intent reaches the crew as a count, and names nobody", async ({ page }) => {
    // Two sign-ins and a booking between them.
    test.setTimeout(30_000);
    const title = `Macro Morning ${e2eNow().getTime()}`;
    await createTrip(page, {
      title,
      date: daysFromNow(4),
      departsAt: "08:00",
      returnsAt: "11:30",
      capacity: 6,
    });
    await signOut(page);

    await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
    await page.locator("li").filter({ hasText: title }).getByRole("link", { name: title }).click();
    await page.getByLabel("Name", { exact: true }).fill("Ines Marchetti");
    await page.getByLabel("Email", { exact: true }).fill(`ines-${e2eNow().getTime()}@example.com`);
    await chooseDiveIntent(page, "Small life and photos");
    // The consent grammar the ADR's budget rule 6 asks for: who sees it, and
    // the way back.
    await expect(page.getByText("Your crew sees how many picked each, not who.")).toBeVisible();
    await page.getByRole("button", { name: /^Book (this spot|these spots)$/ }).click();
    await expect(page).toHaveURL(/\/ready\//);

    await signInAsOwner(page);
    await page.goto("/shop/blue-mantis/schedule/board");
    await page.locator("li").filter({ hasText: title }).getByRole("link").click();
    await page
      .getByRole("navigation", { name: "Trip" })
      .getByRole("link", { name: "Manifest" })
      .click();
    await page.getByRole("heading", { name: "Buddy teams" }).click();
    // The whole of what D23 gets: an aggregate on the team builder, with no
    // name in it and no suggested pairing.
    const aboard = page.getByText(/^Aboard today:/);
    await expect(aboard).toBeVisible();
    await expect(aboard).toContainText("1 looking for small life");
    await expect(aboard).not.toContainText("Ines");
  });

  test("a departure inside the day asks the question and offers nothing", async ({ page }) => {
    test.setTimeout(30_000);
    // Ninety minutes out on the frozen clock (09:30 in the shop's zone), so
    // D18's 24-hour window is shut: a deck-side word, an easy first dive and a
    // refresher course are all things nobody can arrange in time, and offering
    // them would be the shame the boundary exists to avoid.
    const title = `Last Light ${e2eNow().getTime()}`;
    await createTrip(page, {
      title,
      date: daysFromNow(0),
      departsAt: "11:00",
      returnsAt: "13:30",
      capacity: 6,
    });
    await signOut(page);

    await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
    await page.locator("li").filter({ hasText: title }).getByRole("link", { name: title }).click();
    await chooseDiveIntent(page, "Getting comfortable again");
    // The question stands; the offers do not.
    await expect(page.getByText("Your crew sees how many picked each, not who.")).toBeVisible();
    await expect(page.getByText("Anything that would help?")).toHaveCount(0);
  });
});

test("a full boat lets a diver join the wait list without taking a seat", async ({ page }) => {
  // Same aggregate sequential-navigation cost as this file's other heavy
  // tests — see the comment on "full loop" above.
  test.setTimeout(30_000);
  await page.goto("/s/blue-mantis");
  // Seeded wreck trip ships full (10 of 10).
  await page
    .locator("li")
    .filter({ hasText: "Wreck Trip — Spiegel Grove" })
    .getByRole("link", { name: "Wreck Trip — Spiegel Grove" })
    .click();
  await expect(page.getByRole("heading", { name: "This boat’s full" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Join the wait list" })).toBeVisible();
  // The two diver forms cross-reference each other (backlog item 147) — a
  // diver holding a place on this one trip's wait list can also see the
  // shop-wide last-minute list exists, and following it lands on that form.
  const anyTripLink = page.getByRole("link", { name: "Join the last-minute list" });
  await expect(anyTripLink).toHaveAttribute("href", "/s/blue-mantis#last-minute-list");
  await anyTripLink.click();
  await expect(
    page.getByRole("heading", { name: "Want a deal on a last-minute spot?" }),
  ).toBeVisible();
  await expect(page.getByText(/Already have one specific trip in mind/)).toBeVisible();
  await page.goBack();

  // The waitlist form is controlled, so wait for hydration before typing.
  await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name").fill("Nora Quinn");
  await page.getByLabel("Email").fill(`waitlist-${e2eNow().getTime()}@example.com`);
  await page.getByRole("button", { name: "Join the wait list" }).click();
  await expect(page.getByRole("heading", { name: /You’re on the wait list, Nora/ })).toBeVisible();
  // A wait list is a set of leads the shop works, not a queue a diver holds a
  // place in (ADR 20260813-wait-list-is-a-lead-list). The confirmation may not
  // promise a standing the product does not implement.
  await expect(page.getByText(/The shop has your details and will get in touch/)).toBeVisible();
  await expect(page.getByText(/place in line/)).toHaveCount(0);

  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/schedule/board");
  await page
    .locator("li")
    .filter({ hasText: "Wreck Trip — Spiegel Grove" })
    .getByRole("link", { name: "Wreck Trip — Spiegel Grove", exact: true })
    .click();
  // The wait list is the guests ledger's own "Waiting for a seat" group now
  // (ADR 20260827-the-departure-is-two-working-surfaces, slice 5d).
  await expect(page.getByRole("heading", { name: /Waiting for a seat/ })).toBeVisible();
  await expect(page.getByText("Nora Quinn").last()).toBeVisible();
  // Staff read when each diver asked, not a rank: the list is unnumbered.
  await expect(page.getByText(/Asked /).last()).toBeVisible();
});

// H-13: a self-service booking that reuses an existing diver's email under a
// genuinely different name (a shared inbox — a spouse, a minor under a parent's
// email) must not silently inherit that diver's certs/waiver. It is held with an
// identity blocker until staff confirm it is the same person.
test.describe("as owner", () => {
  signedInAs("owner");

  test("a shared-inbox booking under a different name is held for staff identity confirmation", async ({
    page,
  }) => {
    // Signs in as staff (cached — see `signedInAs` above), creates a trip,
    // signs out, books as a diver, signs back in as staff, and confirms
    // identity — several full navigation cycles plus one genuine live
    // re-authentication (the sign-out/sign-back-in) chained in one test.
    // Same aggregate-cost reasoning as visual.spec.ts's `test.setTimeout`: a
    // traced CI failure measured the total sequential cost at 19s against
    // the default 15s test timeout, every individual step resolving
    // successfully.
    test.setTimeout(30_000);
    const email = `shared-${e2eNow().getTime()}@example.com`;
    const tripB = `H13 Shared Inbox ${e2eNow().getTime()}`;

    // Staff put a second bookable trip on the board, then sign out.
    await createTrip(page, {
      title: tripB,
      date: daysFromNow(7),
      departsAt: "19:00",
      returnsAt: "21:00",
    });
    // Waits for the sign-out redirect to land before booking as the public — a
    // signed-in staffer opening a trip gets the manage view, not the booking form.
    await signOut(page);

    // Nora books the seeded reef trip under her email.
    await page.goto("/s/blue-mantis");
    await page
      .locator("li")
      .filter({ hasText: "Two-Tank Reef — Christ of the Abyss" })
      .getByRole("link", { name: "Two-Tank Reef — Christ of the Abyss" })
      .click();
    // The booking form is controlled, so wait for hydration before typing.
    await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Name", { exact: true }).fill("Nora Quinn");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
    await expect(page.getByRole("heading", { name: /You’re on the boat, Nora/ })).toBeVisible();

    // A different name on the same inbox books trip B — reuses Nora's record.
    await page.goto("/s/blue-mantis");
    // Scoped to the trip list itself, the page's one stable anchor for
    // departures — day rules and other lists on the page never carry a
    // trip's title.
    await page
      .getByRole("list", { name: "Upcoming trips" })
      .locator("li")
      .filter({ hasText: tripB })
      .getByRole("link")
      .click();
    await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Name", { exact: true }).fill("Ben Quinn");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
    await expect(page.getByRole("heading", { name: /You’re on the boat/ })).toBeVisible();

    // Staff open trip B's roster: the diver is held on identity, not ready.
    await signInAsOwner(page);
    await page.goto("/shop/blue-mantis/schedule/board");
    await page
      .locator("li")
      .filter({ hasText: tripB })
      // Exact match: an unpriced trip's card also carries a "Set a price for
      // {title}, ..." link whose accessible name contains the trip title as a
      // substring.
      .getByRole("link", { name: tripB, exact: true })
      .click();
    const row = page.locator("li").filter({ hasText: "Nora Quinn" }).filter({ visible: true });
    await expect(row).toContainText("Identity unconfirmed");

    // Confirming identity clears the blocker — two-tap InlineConfirm, not a
    // native dialog: the first tap only arms it.
    await row.getByRole("button", { name: /^Confirm this is/ }).click();
    await row.getByRole("button", { name: "Yes, this is them" }).click();
    await expect(page.getByRole("status")).toContainText("Identity confirmed");
    await expect(
      page.locator("li").filter({ hasText: "Nora Quinn" }).filter({ visible: true }),
    ).not.toContainText("Identity unconfirmed");
  });
});

// CR-003, restated against the destination booking actually has (ADR
// 20260820-one-page-after-booking): the page a booked diver lands on is
// authorized by a signed `readiness` capability in the path, never by a raw
// booking id — a tampered token must reveal nothing, and the `?booking=` branch
// it replaced must be gone rather than merely unused.
test("a tampered readiness token reveals nothing, and ?booking= no longer opens a door", async ({
  page,
}) => {
  await page.goto("/s/blue-mantis");
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Christ of the Abyss" })
    .getByRole("link", { name: "Two-Tank Reef — Christ of the Abyss" })
    .click();
  // The booking form is controlled, so wait for hydration before typing.
  await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name").fill("Casey Ford");
  await page.getByLabel("Email").fill(`casey-${e2eNow().getTime()}@example.com`);
  const tripUrl = page.url();
  await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
  await expect(page).toHaveURL(/\/ready\//);
  await expect(page.getByRole("heading", { name: /You’re on the boat, Casey/ })).toBeVisible();

  const realToken = new URL(page.url()).pathname.split("/").pop();
  expect(realToken).toBeTruthy();

  // A garbage token in the same position must not open the booking.
  await page.goto("/ready/not-a-real-token?booked=1");
  await expect(page.getByRole("heading", { name: /You’re on the boat/ })).not.toBeVisible();
  await expect(page.getByRole("heading", { name: /readiness link isn.t available/ })).toBeVisible();

  // And the branch this replaced is gone: a real, live capability presented in
  // the old `?booking=` slot on the trip page opens nothing at all. It is the
  // wrong purpose for that param, the param is only read inside the embed now,
  // and no unframed booking mints a `confirm` token in the first place.
  await page.goto(`${tripUrl}?booking=${realToken}`);
  await expect(page.getByRole("heading", { name: /You’re on the boat/ })).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Grab a spot" })).toBeVisible();
});

/**
 * **J6 — a diver finds the shop** (ADR
 * 20260827-clearwater-surface-language, decision 8; the canvas SPEC's journey
 * table). On a phone the shopfront stacks: the shop's own name and line, then
 * the next boat as a bookable object with the page's one primary, then the
 * week at one line per departure. One tap gets a diver into the booking form
 * they would otherwise have had to find by reading fifteen stacked cards.
 */
test.describe("the shopfront on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("leads with the shop, then the next boat, then the booking form", async ({ page }) => {
    await page.goto("/s/blue-mantis");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Blue Mantis Divers");
    await expect(
      page.getByText("Small-boat reef and wreck diving out of Key Largo."),
    ).toBeVisible();

    const card = page.getByRole("region", { name: "Next boat out" });
    await expect(card).toBeVisible();
    // The page's one primary — every week row below it is a link.
    const primaries = page.getByRole("link", { name: "Book this boat" });
    await expect(primaries).toHaveCount(1);
    await primaries.click();

    await expect(page).toHaveURL(/\/s\/blue-mantis\/trips\/[0-9a-f-]{36}#book$/);
    await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
  });
});

/**
 * **A stale link is the most likely first impression a diver ever has of a
 * shop**, because links outlive the departures they point at — a flyer, a
 * saved message, an Instagram post from last season.
 *
 * Before issue #765 this fell through to the app-wide 404: no shop chrome, the
 * word DIVEDAY above the heading, and one button to DiveDay's *sales*
 * homepage. The assertions below are the three halves of the fix — the shop is
 * still on the screen, the way onward is that shop's own board, and DiveDay's
 * marketing door is not offered to a diver at all.
 */
test("a dead departure link keeps the diver at the shop they were trying to reach", async ({
  page,
}) => {
  // A valid slug with a trip id that resolves to nothing — the shape of a
  // deleted departure and of a URL retyped off a flyer alike.
  await page.goto("/s/blue-mantis/trips/00000000-0000-4000-8000-000000000000");

  await expect(page.getByRole("heading", { name: "That page isn’t here any more" })).toBeVisible();
  // The shop's own chrome, from the namespace layout: whose page this is, and
  // the nav a diver can carry on browsing from.
  await expect(page.getByRole("banner").getByText("Blue Mantis Divers")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to the homepage" })).toHaveCount(0);

  await page.getByRole("link", { name: "See what’s coming up" }).click();
  await expect(page).toHaveURL(/\/s\/blue-mantis$/);
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
});
