import type { Page } from "@playwright/test";
import { DEMO_SHOP_SLUG, DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";
import {
  acceptAgeAttestation,
  createTrip,
  daysFromNow,
  e2eNow,
  signInAs,
  signOut,
  tripPathByTitle,
} from "./helpers";

const SHOP = DEMO_SHOP_SLUG;

/** The seeded diver the shop is out of a size for — flagged for staff fit. */
const DIVER_WITH_FIT = "Sam Whitfield";
/** A seeded diver with a rental fit on file and no flag raised. */
const DIVER_WITH_UNFLAGGED_FIT = "Priya Sharma";

async function goToDiver(page: Page, name: string) {
  await page.goto(`/shop/${SHOP}/divers?q=${encodeURIComponent(name)}`);
  // **By accessible name, not by text.** Since the roster became one ledger
  // (slice 8c) a row's door is `LedgerRow`'s stretched `<Link>` — an empty
  // anchor laid over the whole row, whose name comes from `aria-label` and
  // whose text content is therefore "". `hasText` cannot see it; `getByRole`
  // reads the label. `exact` because a role query matches by substring, and one
  // diver's name can sit inside another's.
  const href = await page.getByRole("link", { name, exact: true }).first().getAttribute("href");
  if (!href) throw new Error(`no diver link for ${name}`);
  await page.goto(href);
}

/**
 * The three user-visible behaviours of ADR 20260724-gear-fit-fallback: H-06's
 * "needs staff fit" fallback and its override gate, and H-08's fail-open
 * minimum-age gate.
 */
test.describe("staff", () => {
  signedInAsOwner();

  test("a flagged diver keeps their count but loses the size, and is named for a check-in fit", async ({
    page,
  }) => {
    // The seed flags one diver on today's reef trip — no XL BCD left. Read the
    // card's href rather than clicking: the schedule list streams in, and
    // reading page.url() after a click races that render.
    const tripPath = await tripPathByTitle(page, SHOP, "Two-Tank Reef — Molasses & French");
    await page.goto(`${tripPath}/prep`);

    const fitSection = page.getByRole("region", { name: "Fit these divers at check-in" });
    await expect(fitSection).toBeVisible();
    await expect(fitSection).toContainText("No XL BCD left");

    // Their stated XL size must not appear as something to pull — laying out a
    // substitute size is exactly what the flag exists to prevent...
    await expect(page.getByRole("table")).not.toContainText("XL");
    // ...but the BCD line itself stays, because the count is what the packer
    // loads from. Dropping it arrives a BCD short with nothing to fit them from.
    await expect(page.getByRole("table")).toContainText("Fit at check-in");
  });

  test("an owner rewrites a diver's fit, flags them, and clears it when resolved", async ({
    page,
  }) => {
    await goToDiver(page, DIVER_WITH_FIT);

    // This diver starts flagged by the seed; clear it so the test drives the
    // full flag → resolve cycle from a known state.
    await page.getByRole("button", { name: /Fit resolved/ }).click();
    await expect(page.getByRole("status")).toContainText("packs from their stated sizes again");

    // Editing the stated fit is allowed for an owner (canOverrideGearRequest).
    // The form is behind the Gear-and-sizes group's one disclosure now, which
    // is what lets the two facts lead (ADR 20260827-people-not-lists).
    await page
      .getByRole("region", { name: "Gear and sizes" })
      .getByText("Edit", { exact: true })
      .click();
    await page.getByLabel("BCD size").fill("M");
    await page.getByRole("button", { name: "Save rental fit" }).click();
    await expect(page.getByRole("status")).toContainText("Rental fit profile saved");

    // Flagging is a separate control, and open to any staff member.
    await page.getByLabel("What’s short").fill("No M BCD today");
    await page.getByRole("button", { name: "Flag for staff fit" }).click();
    await expect(page.getByRole("status")).toContainText("Flagged for hands-on fitting");
    // Scoped to the group: since the status ledger leads the record (ADR
    // 20260827-people-not-lists), a raised fit flag is *also* a ledger row —
    // "Needs staff fit — No M BCD today" — so the shop's note is on the page
    // twice, and both are the design.
    await expect(
      page.getByRole("region", { name: "Gear and sizes" }).getByText("No M BCD today", {
        exact: true,
      }),
    ).toBeVisible();

    await page.getByRole("button", { name: /Fit resolved/ }).click();
    await expect(page.getByRole("status")).toContainText("packs from their stated sizes again");
  });
});

/**
 * Both layers of ADR-0006 for the H-06 gate: what the deck crew's screen
 * offers, and what the server does when the screen is bypassed. The second is
 * the one that matters — hiding a button is not authorization.
 */
test.describe("deck crew", () => {
  signedInAs("captain");

  test("a captain may raise the fit flag but not rewrite sizes or clear it", async ({ page }) => {
    // A diver with a fit on file but no flag: the stated sizes are read-only,
    // and the safe fallback the captain actually needs at the dock is right
    // there — a flag is an escalation, not an override.
    await goToDiver(page, DIVER_WITH_UNFLAGGED_FIT);
    await expect(page.getByRole("button", { name: "Save rental fit" })).toHaveCount(0);
    await expect(page.getByText("limited to owners, managers, instructors, and")).toBeVisible();
    await expect(page.getByRole("button", { name: "Flag for staff fit" })).toBeEnabled();

    // The already-flagged diver: clearing asserts "we can pack their stated
    // size after all", which is the judgement call, so the captain doesn't get
    // it.
    await goToDiver(page, DIVER_WITH_FIT);
    await expect(page.getByRole("button", { name: /Fit resolved/ })).toHaveCount(0);
    await expect(page.getByText("Clearing this is limited to")).toBeVisible();
  });

  test("the server refuses a captain's clear even when the button is bypassed", async ({
    page,
  }) => {
    await goToDiver(page, DIVER_WITH_FIT);
    // A `<p>` now, not a heading: the fallback is one line inside the gear
    // group rather than a boxed panel with a heading of its own (slice 8b).
    const flaggedHeading = page.getByText("Flagged for hands-on fitting", { exact: true });
    await expect(flaggedHeading).toBeVisible();

    // The form is still on the page for a captain — only its submit button is
    // withheld. Submitting it directly sends no `needed` field, which is
    // exactly what a *clear* looks like. If the action trusted the rendered UI
    // this would silently put the diver back on the list at a size the shop
    // already said it was short of, with the attribution wiped in the same
    // statement so nothing recorded that it happened.
    await page.evaluate(() => {
      const form = Array.from(document.querySelectorAll("form")).find((candidate) =>
        candidate.textContent?.includes("Flagged for hands-on fitting"),
      );
      if (!form) throw new Error("the needs-staff-fit form is not on the page");
      form.requestSubmit();
    });

    // The server refused an authorization boundary, so the nearby outcome is
    // assertive (`alert`), not an ambient confirmation (`status`).
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Changing a diver's stated rental fit is limited to" }),
    ).toContainText("Changing a diver's stated rental fit is limited to");
    await expect(flaggedHeading).toBeVisible();
  });
});

test.describe("minimum age (H-08, fail open)", () => {
  signedInAsOwner();

  /**
   * Both scenarios below need the same course session; extracted so each test
   * pays this setup once instead of chaining both flows into one test. The
   * combined version reliably blew the 15s per-test budget end to end — even
   * with zero CI contention, a local `pnpm e2e` run timed out mid-navigation
   * on this exact spec before ever reaching the second flow's assertions —
   * because it packed a trip creation, two full add-to-trip round trips, and
   * a whole second diver's create-then-edit detour into one test. Splitting
   * gives each scenario the full budget a single flow is sized for.
   */
  async function createAgeGateSession(page: Page, title: string) {
    // Open Water Diver states a minimum age of 10 in the seeded catalog.
    await createTrip(page, {
      shopSlug: SHOP,
      course: "Open Water Diver",
      title,
      date: daysFromNow(24),
      departsAt: "08:00",
      returnsAt: "17:00",
    });

    const tripPath = await tripPathByTitle(page, SHOP, title);
    await page.goto(tripPath);
    // The crew picker is controlled: a pick before hydration silently no-ops
    // (the DOM changes, no action fires), so wait for the marker first.
    await expect(page.getByLabel("Assign crew")).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Assign crew").selectOption({ label: "Marcus Webb" });
    await expect(page.getByRole("button", { name: "Unassign Marcus Webb" })).toBeVisible();
    return tripPath;
  }

  test("admits a diver with no date of birth on file (fail open)", async ({ page }) => {
    test.setTimeout(30_000);
    const stamp = e2eNow().getTime();
    const tripPath = await createAgeGateSession(page, `Age gate session ${stamp}`);

    // Fail open: a walk-in has no date on file — the same state every diver in
    // a live shop starts from — and books exactly as before.
    await page.goto(`${tripPath}/guests`);
    await page.getByRole("link", { name: "Add diver" }).click();
    await page.waitForURL(/\/divers\/new/);
    await page.getByLabel("Full name").fill(`Ageless Diver ${stamp}`);
    await page.getByLabel("Email").fill(`ageless-${stamp}@example.com`);
    await page.getByRole("button", { name: "Add to trip" }).click();
    await page.waitForURL(/\/trips\/[^/]+\/guests/);
    await expect(page.getByRole("status")).toContainText("Diver added to the trip");
  });

  test("refuses a diver once a date of birth on file makes them under age", async ({ page }) => {
    // Measured locally with zero CI contention: trip creation + a second
    // diver's create-then-edit-DOB detour + the guests-page round trip
    // already cost ~13s on their own, before this test's own add-attempt
    // assertion (which needs a real server-action round trip under a
    // FOR-UPDATE trip lock, plus a full re-render of the guests page — one of
    // the heaviest pages in the app) gets to run inside what budget is left.
    // The default 15s (playwright.config.ts) is sized for one flow; this test
    // is legitimately two (a diver's full create-and-edit lifecycle, then a
    // booking attempt), so it gets a proportionally larger budget instead of
    // routinely racing its own setup.
    test.setTimeout(30_000);
    const stamp = e2eNow().getTime();
    const tripPath = await createAgeGateSession(page, `Age gate session ${stamp}`);

    // A diver who *does* have a date on file, aged 8 on the course date.
    await page.goto(`/shop/${SHOP}/divers`);
    await page.getByRole("searchbox", { name: "Search divers" }).fill(`Young Diver ${stamp}`);
    await page.getByRole("button", { name: "Add diver", exact: true }).click();
    await expect(page).toHaveURL(/\/divers\/[0-9a-f-]+(\?edit=1)?$/);

    // Adding a diver lands with the details form already expanded — the
    // three-field roster form doesn't ask for a date of birth, and the front
    // desk shouldn't have to know to open a disclosure to supply one.
    await page.getByLabel("Date of birth").fill(daysFromNow(-365 * 8));
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByRole("status")).toContainText("Diver details updated");

    await page.goto(`${tripPath}/guests`);
    // Scope to the add-diver section: the global command palette also has a
    // button named "Search".
    const addDiver = page.locator("#add-diver");
    await addDiver.getByLabel("Find a returning diver").fill(`Young Diver ${stamp}`);
    await addDiver.getByRole("button", { name: "Search" }).click();
    // The picker's button is labelled per diver ("Add <name> to the trip"),
    // unlike the by-hand form's plain "Add to trip" used by the fail-open test.
    const addYoungDiverButton = addDiver.getByRole("button", {
      name: `Add Young Diver ${stamp} to the trip`,
    });
    await addYoungDiverButton.click();
    // The submit's own server-action round trip can take a moment (it holds
    // the trip row while checking the age gate); wait for it to actually land
    // — the button itself disappears once the refusal's redirect replaces
    // this section with a fresh, empty "Add a diver" — before reading
    // anything else, or the assertions below race a still-pending submit.
    await expect(addYoungDiverButton).toHaveCount(0);
    // Not asserting on the `?notice=diver-course-min-age` flash text here: it's
    // a one-shot banner FlashParams strips from the URL almost immediately, and
    // this page also carries several prefetched `<Link>`s back to that same
    // now-clean URL — asserting on the flash races a client-side refresh
    // unrelated to this test (confirmed on an unmodified checkout too). The
    // durable, meaningful fact is that the booking itself was refused: nobody
    // is on this trip's roster (this test never adds the fail-open walk-in),
    // and the refused diver never appears in it.
    await expect(page.getByRole("heading", { name: /^Divers 0 of/ })).toBeVisible();
    await expect(page.getByText(`Young Diver ${stamp}`)).toHaveCount(0);
  });

  test("names the real reason on the diver's own checklist once a date on file makes them under age (H-22)", async ({
    page,
  }) => {
    // This is one continuous journey across two actors on purpose — the
    // public booking has to happen before staff records the date of birth,
    // proving the blocker catches a diver who was "unknown age" at booking
    // time, not just one whose date was on file up front — so it can't be
    // split the way the two tests above were. It reliably exceeds the
    // default 15s (playwright.config.ts, sized for one flow) even with no
    // CI contention: trip creation, a sign-out/sign-in round trip, a full
    // public booking form, and a second diver detour to edit a date of birth
    // all have to land before the final assertion.
    test.setTimeout(30_000);
    const stamp = e2eNow().getTime();
    const sessionTitle = `Age disclosure session ${stamp}`;
    await createTrip(page, {
      shopSlug: SHOP,
      course: "Open Water Diver",
      title: sessionTitle,
      date: daysFromNow(24),
      departsAt: "08:00",
      returnsAt: "17:00",
    });

    const tripPath = await tripPathByTitle(page, SHOP, sessionTitle);
    await page.goto(tripPath);
    // The crew picker is controlled: a pick before hydration silently no-ops
    // (the DOM changes, no action fires), so wait for the marker first.
    await expect(page.getByLabel("Assign crew")).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Assign crew").selectOption({ label: "Marcus Webb" });
    await expect(page.getByRole("button", { name: "Unassign Marcus Webb" })).toBeVisible();

    // Staff must step aside for the public flow: this exercises the booking
    // form a diver fills in, and `bookSpot`'s actor is decided by the session
    // on the request, not by the URL.
    await signOut(page);

    // The PUBLIC form — actor: "public" in bookSpot — never refuses on age.
    // No date is on file yet, so this books exactly like any other walk-in
    // and never even raises the blocker.
    const diverName = `Late Bloomer ${stamp}`;
    await page.goto(`/s/${SHOP}/courses/open-water-diver`);
    await page.getByRole("link", { name: "Book this date" }).last().click();
    // The booking form is controlled, so wait for hydration before typing —
    // otherwise a fill can land before React attaches and gets silently lost.
    await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Name").fill(diverName);
    await page.getByLabel("Email").fill(`late-bloomer-${stamp}@example.com`);
    await acceptAgeAttestation(page);
    await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
    // The confirmation heading greets by first name only ("...boat, Late! 🤿").
    await expect(
      page.getByRole("heading", {
        name: new RegExp(`You’re on the boat, ${diverName.split(" ")[0]}`),
      }),
    ).toBeVisible();

    await expect(page).toHaveURL(/\/ready\//);
    const readyUrl = page.url();
    // Fails open with no date on file: nothing age-related shown yet.
    await expect(page.getByText(/minimum age/)).toHaveCount(0);

    // Staff sign back in to record a date of birth putting them at 8 on the
    // course date — exactly the "recorded after the booking" case the
    // blocker exists to catch, since a booking-time-only gate would be inert
    // for this diver.
    await signInAs(page, DEV_STAFF_LOGINS.owner);
    await goToDiver(page, diverName);
    await page.getByText("Edit details").click();
    await page.getByLabel("Date of birth").fill(daysFromNow(-365 * 8));
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByRole("status")).toContainText("Diver details updated");

    // Same link, unchanged: the diver never re-requested it, but their own
    // checklist now names the real reason — no identity mismatch is in play
    // for this diver, so it isn't hidden behind the generic identity line.
    await page.goto(readyUrl);
    // The exact copy — including that it never states the diver's actual age
    // back — is pinned at the unit level (readiness-summary.test.ts); this
    // just confirms the real flow reaches it.
    await expect(page.getByText(/minimum age that the date of birth on file/)).toBeVisible();
  });
});

/**
 * The packing list's two groupings. One departure's pieces, read either down
 * the rack (every BCD together with its sizes) or down the roster (every diver
 * with their pieces) — both halves of packing a boat, and the choice lives in
 * `?group=` so it is linkable rather than a client toggle that a reload loses.
 */
test.describe("the prep list's two groupings", () => {
  signedInAsOwner();

  test("flips between the rack and the roster, and keeps the choice in the URL", async ({
    page,
  }) => {
    const tripPath = await tripPathByTitle(page, SHOP, "Two-Tank Reef — Molasses & French");
    await page.goto(`${tripPath}/prep`);
    const kit = page.getByRole("region", { name: "Rental kit" });
    // No `?group=` at all: the rack, which is what this page has always opened
    // on and what the departure packet prints.
    await expect(kit.getByRole("columnheader", { name: "Item" })).toBeVisible();

    await kit.getByRole("link", { name: "By diver" }).click();
    await expect(page).toHaveURL(/[?&]group=diver$/);
    await expect(kit.getByRole("columnheader", { name: "Diver" })).toBeVisible();
    await expect(kit.getByRole("columnheader", { name: "Kit" })).toBeVisible();
    // The roster grouping is the same pieces, so it makes the same refusal: the
    // flagged diver keeps their kit and still names no size to pull it in.
    await expect(kit).toContainText("Fit at check-in");
    await expect(kit).not.toContainText("XL");
    // The state only this grouping can express: a diver with nothing to pull.
    // The by-item view cannot show them at all — they contribute no line — so
    // "Own kit" beside a name is the whole reason the roster grouping exists.
    // Ines brings her own (`src/db/seed-rental-fit.ts`).
    const ines = kit.getByRole("row").filter({ hasText: "Ines Costa" });
    await expect(ines).toContainText("Own kit");
    // And it is genuinely "asked and answered", not the "nobody asked" row
    // sitting a few lines above it — the two read differently on purpose.
    await expect(ines).not.toContainText("not asked");
    // Every row is one diver, so every row is a door to that diver's record —
    // the by-item grouping can only name them inside a comma list. A raw
    // locator needs its own visibility filter (the fixture only patches the
    // `getBy*` queries).
    await expect(
      kit.locator('a[href*="/divers/"]').filter({ visible: true }).first(),
    ).toBeVisible();

    // A real URL, so a reload lands back on the same grouping.
    await page.reload();
    await expect(kit.getByRole("columnheader", { name: "Diver" })).toBeVisible();

    await kit.getByRole("link", { name: "By item" }).click();
    await expect(page).toHaveURL(/[?&]group=item$/);
    await expect(kit.getByRole("columnheader", { name: "Item" })).toBeVisible();
  });

  test("reads an unrecognised grouping as the rack rather than rendering nothing", async ({
    page,
  }) => {
    const tripPath = await tripPathByTitle(page, SHOP, "Two-Tank Reef — Molasses & French");
    await page.goto(`${tripPath}/prep?group=whatever`);
    const kit = page.getByRole("region", { name: "Rental kit" });
    await expect(kit.getByRole("columnheader", { name: "Item" })).toBeVisible();
  });
});

/**
 * The packing list on a phone. It is a dock surface — a staffer works down it
 * with a tank in the other hand — and its fourth column is a comma-joined list
 * of diver names, which at 390px crushes the item, size, and count the packer
 * actually pulls by. Below `sm` the table gives way to stacked cards, the same
 * split the diver roster uses.
 */
test.describe("the prep list on a phone", () => {
  signedInAsOwner();
  test.use({ viewport: { width: 390, height: 844 } });

  test("stacks the packing lines into cards instead of a four-column table", async ({ page }) => {
    const tripPath = await tripPathByTitle(page, SHOP, "Two-Tank Reef — Molasses & French");
    await page.goto(`${tripPath}/prep`);
    await expect(page.getByRole("heading", { name: "Tanks" })).toBeVisible();

    // No sideways scroll to discover: the table is gone at this width.
    await expect(page.getByRole("table")).toBeHidden();

    const kit = page.getByRole("region", { name: "Rental kit" });
    const bcdCard = kit.getByRole("listitem").filter({ hasText: "BCD" }).first();
    await expect(bcdCard).toBeVisible();
    // Every column the table carried is still on the card, each behind its own
    // label rather than positionally — the count is the number the packer
    // loads from, so it must never be the thing that gets truncated.
    await expect(bcdCard.getByRole("term").filter({ hasText: "Size" })).toBeVisible();
    await expect(bcdCard.getByRole("term").filter({ hasText: "For" })).toBeVisible();

    // The flagged diver still reads as "fit at check-in" here, not as a
    // substitute size — same refusal the table makes (see above).
    await expect(kit).toContainText("Fit at check-in");
    await expect(kit).not.toContainText("XL");
  });
});
