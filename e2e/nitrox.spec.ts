import type { Page } from "@playwright/test";
import { expect, makeActivitySafe, signedInAsOwner, test } from "./fixtures";
import { acceptAgeAttestation, e2eNow, openSettingsRow, openThreadStep } from "./helpers";

async function openWreckTrip(page: Page) {
  await page.goto("/shop/blue-mantis/schedule/board");
  await page
    .locator("li")
    .filter({ hasText: "Wreck Trip — Spiegel Grove" })
    .getByRole("link", { name: "Wreck Trip — Spiegel Grove", exact: true })
    .click();
}

test.describe("staff", () => {
  signedInAsOwner();

  test("a verified nitrox card turns a diver's tanks to Nitrox on the prep list", async ({
    page,
  }) => {
    // A unique card number keeps the flow self-contained and re-run safe.
    const cardNo = `EANX-T${e2eNow().getTime()}`;

    // Nitrox evidence is handled with the diver's other cards, then verified there.
    await page.goto("/shop/blue-mantis/divers");
    await page.getByRole("searchbox", { name: "Search divers" }).fill("June Park");
    await page.getByRole("link", { name: /June Park/ }).click();
    await page.getByText("Add certification", { exact: true }).click();
    // One capture form for every card kind now (ADR 20260827-people-not-lists);
    // the card itself is the question, and nitrox is its own option because it
    // is its own table and its own gas gate.
    const captureForm = page.locator("form", {
      has: page.getByRole("button", { name: "Capture for review", exact: true }),
    });
    await captureForm
      .locator('select[name="card"]')
      .filter({ visible: true })
      .selectOption("nitrox");
    await captureForm.locator('input[name="identifier"]').filter({ visible: true }).fill(cardNo);
    await page.getByRole("button", { name: "Capture for review", exact: true }).click();

    const card = page.locator("li").filter({ hasText: cardNo });
    await card.getByRole("button", { name: "Mark certified" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Marked certified." })).toBeVisible();

    await openWreckTrip(page);
    await page
      .getByRole("navigation", { name: "Trip" })
      .getByRole("link", { name: "Prep" })
      .click();
    await expect(page.getByRole("heading", { name: /Wreck Trip/ })).toBeVisible();

    // The prep list is derived from rental fit, so it always lists tanks and
    // rental kit even when nobody on the boat rents a single piece of kit.
    await expect(page.getByRole("heading", { name: "Rental kit" })).toBeVisible();
    // One tank per diver per dive, and the seeded nitrox request is on the split.
    await expect(page.getByText("one tank per diver per dive")).toBeVisible();
    const tanks = page
      .getByRole("heading", { name: "Tanks" })
      .locator("xpath=..")
      .filter({ visible: true });
    await expect(tanks).toContainText("Nitrox");
    // Nothing on this page claims to know what is in a cylinder.
    await expect(page.getByText("DiveDay logs no gas analysis")).toBeVisible();
  });
});

/**
 * The two tests that turn the shop's nitrox catalog off. `shops.rental_items`
 * is not restored by the per-test reset — it puts back three `shops` columns
 * and no others — so each of these takes a shop of its own (`privateShop`, ADR
 * 20260815-per-test-private-shops) instead of the `try/finally` that used to
 * put blue-mantis's catalog back. A `finally` is not isolation: it does not run
 * when the worker dies, and nothing enforces that the next author writes one.
 *
 * A minted shop carries the same seeded schedule and the same rental catalog
 * (nitrox included), so both tests read exactly the fixture they always did.
 */
test.describe("a shop that stops filling nitrox", () => {
  test("resaving the rental-fit form after the shop disables nitrox doesn't clear an existing request", async ({
    page,
    browser,
    workerBaseURL,
    privateShop,
  }) => {
    // The mint and the live sign-in the fixture pays for, then two actors
    // (diver + staff), a settings round trip, and a prep-list read.
    test.setTimeout(60_000);
    const SHOP = privateShop.slug;
    // The diver's half of this test runs signed out — a fresh context so the
    // owner session on `page` (used to toggle settings below) never bleeds
    // into it.
    const anonContext = await browser.newContext({
      baseURL: workerBaseURL,
      storageState: { cookies: [], origins: [] },
    });
    const anon = makeActivitySafe(await anonContext.newPage());
    await anon.goto(`/s/${SHOP}`);
    await anon
      .locator("li")
      .filter({ hasText: "Two-Tank Reef — Christ of the Abyss" })
      .getByRole("link", { name: "Two-Tank Reef — Christ of the Abyss" })
      .click();
    // The booking form is controlled, so wait for hydration before typing.
    await expect(anon.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
    // Read off the trip page itself, before booking: a booked diver lands on
    // `/ready/<token>`, which names no trip (ADR 20260820-one-page-after-booking).
    // Reused below instead of clicking back through the schedule as staff.
    // After the hydration wait above, never before it — the click that got here
    // has not necessarily finished navigating, and reading the URL early sees
    // the schedule it came from.
    const tripId = anon.url().match(/\/trips\/([^/?]+)/)?.[1];
    if (!tripId) throw new Error("trip page URL missing a trip id");
    await anon.getByLabel("Name").fill("Priya Sharma");
    await anon.getByLabel("Email").fill(`priya+${e2eNow().getTime()}@example.com`);
    await anon.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
    await expect(anon.getByRole("heading", { name: /You’re on the boat, Priya/ })).toBeVisible();

    // The card first, because the request is gated on it now — filed from the
    // spine's certification step, which is the only place this page takes one.
    // At most one step is open at rest, so the step opens before the
    // disclosure inside it (ADR 20260827-the-divers-thread, decision 3).
    const certification = await openThreadStep(anon, "certification");
    const nitroxCard = certification
      .locator("details")
      .filter({ has: anon.getByText("Add your nitrox card", { exact: true }) });
    await nitroxCard.getByText("Add your nitrox card", { exact: true }).click();
    await nitroxCard.locator('select[name="agency"]').selectOption("padi");
    await nitroxCard.locator('input[name="identifier"]').fill(`EANX-PRIYA-${e2eNow().getTime()}`);
    await nitroxCard.getByRole("button", { name: "Add my certification" }).click();
    await expect(anon.getByRole("status").filter({ hasText: "Certification added" })).toBeVisible();

    // The request box lives in the gear step, which opening the certification
    // step closed — the spine is one native `<details name>` accordion.
    const gear = await openThreadStep(anon, "gear");
    await gear.locator('input[name="nitrox"]').check();
    await anon.getByRole("button", { name: "Save rental fit" }).click();
    await expect(
      (await openThreadStep(anon, "gear")).locator('input[name="nitrox"]'),
    ).toBeChecked();
    // The diver's own readiness page, which is where they came back to.
    const bookingUrl = anon.url();

    await page.goto(`/shop/${SHOP}/settings`);
    await openSettingsRow(page, "What we rent");
    await page.getByRole("checkbox", { name: "Nitrox fills" }).uncheck();
    await page.getByRole("button", { name: "Save rental catalog" }).click();
    await expect(page.getByText("Rental catalog saved.")).toBeVisible();

    // The diver comes back and resaves their gear for any reason at all. The
    // nitrox fieldset is gone (the shop doesn't fill it any more), but saving
    // must not silently erase the request already on file for this trip.
    //
    // A bare resave, with nothing changed: since issue 627 the free-text note
    // is its own form with its own save (`saveNoteFromReady`), so the note is
    // no longer a way to make this form submit — and the submit itself is the
    // whole point here, not what was typed into it.
    await anon.goto(bookingUrl);
    await expect(anon.locator('input[name="nitrox"]').filter({ visible: true })).toHaveCount(0);
    await anon.getByRole("button", { name: "Save rental fit" }).click();
    await expect(anon.getByText("Saved.").filter({ visible: true })).toBeVisible();

    // The request survives even with nitrox off — read it back from the
    // prep list (visible with the catalog disabled per the live-data check
    // above) rather than re-enabling nitrox just to look at the checkbox.
    await page.goto(`/shop/${SHOP}/trips/${tripId}/prep`);
    const tanks = page
      .getByRole("heading", { name: "Tanks" })
      .locator("xpath=..")
      .filter({ visible: true });
    await expect(tanks).toContainText("Nitrox");

    await anonContext.close();
  });

  test("the prep page collapses Total and Air into one tile when nitrox is off with no live request", async ({
    page,
    privateShop,
  }) => {
    test.setTimeout(60_000);
    const SHOP = privateShop.slug;
    await page.goto(`/shop/${SHOP}/settings`);
    await openSettingsRow(page, "What we rent");
    await page.getByRole("checkbox", { name: "Nitrox fills" }).uncheck();
    await page.getByRole("button", { name: "Save rental catalog" }).click();
    await expect(page.getByText("Rental catalog saved.")).toBeVisible();

    // Two-Tank Reef never had a nitrox request seeded onto it (unlike the
    // wreck charter above), so with the catalog off there is no live data
    // to keep the tile alive: Total and Air are the same number with
    // nothing left to distinguish, and the tile grid collapses to one.
    await page.goto(`/shop/${SHOP}/schedule/board`);
    await page
      .locator("li")
      .filter({ hasText: "Two-Tank Reef — Molasses & French" })
      .getByRole("link", { name: "Two-Tank Reef — Molasses & French", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Trip" })
      .getByRole("link", { name: "Prep" })
      .click();
    const tanks = page
      .getByRole("heading", { name: "Tanks" })
      .locator("xpath=..")
      .filter({ visible: true });
    await expect(tanks.getByText("Total", { exact: true })).toHaveCount(1);
    await expect(tanks.getByText("Air", { exact: true })).toHaveCount(0);
    await expect(tanks.getByText("Nitrox", { exact: true })).toHaveCount(0);
  });
});

// What a *brand new* shop starts with, which no seeded fixture can answer —
// so this one really does onboard a trial shop rather than take a seeded
// `privateShop`. Its slug is unique per run: a fixed one collides with itself
// the moment the same database sees this spec twice, and a trial shop is a
// real shop that no reset ever clears.
test("a freshly onboarded shop starts without nitrox, and turning it on unlocks the price field", async ({
  page,
}) => {
  // `Date.now()` (the runner's real clock), never `e2eNow()`: the fleet's clock
  // is frozen at one instant, so a slug built from it is the same string on
  // every run — which is the collision this is avoiding. The pid separates two
  // workers that land on the same millisecond.
  const slug = `nitrox-off-e2e-${Date.now()}-${process.pid}`;
  await page.goto("/onboard");
  await page.locator('input[name="shopName"]').filter({ visible: true }).fill("Nitrox Off Divers");
  await page.locator('input[name="shopSlug"]').filter({ visible: true }).fill(slug);
  await page.locator('input[name="ownerName"]').filter({ visible: true }).fill("Nadia Cole");
  await page
    .locator('input[name="ownerEmail"]')
    .filter({ visible: true })
    .fill(`nadia-${slug}@example.com`);
  await page
    .locator('input[name="ownerPassword"]')
    .filter({ visible: true })
    .fill("trial-pass-123");
  await page.getByRole("button", { name: "Create shop & start trial" }).click();
  await expect(page).toHaveURL(new RegExp(`/shop/${slug}`));

  await page.goto(`/shop/${slug}/settings`);
  await openSettingsRow(page, "What we rent");
  const nitroxCheckbox = page.getByRole("checkbox", { name: "Nitrox fills" });
  await expect(nitroxCheckbox).not.toBeChecked();
  // Most shops don't fill nitrox: no price field to fill in until it's ticked.
  await expect(page.locator('input[name="nitroxPrice"]').filter({ visible: true })).toHaveCount(0);

  await nitroxCheckbox.check();
  await page.getByRole("button", { name: "Save rental catalog" }).click();
  await expect(page.getByText("Rental catalog saved.")).toBeVisible();
  // The price boxes wait behind their own row.
  await openSettingsRow(page, "Rental prices");
  await expect(page.locator('input[name="nitroxPrice"]').filter({ visible: true })).toHaveCount(1);
});

test("the nitrox request is hidden until the diver files a nitrox card, then appears", async ({
  page,
}) => {
  // The request box is not a place to ask for a card; it is a thing the card
  // brings into being. Before this the box was live for anyone, ticking it grew
  // two card fields inside the gear form, and a diver could leave with a request
  // and no card at all — a tank the crew cannot fill and only finds out about at
  // the dock. It then spent a while rendering *disabled* under a line pointing
  // back up the page, which is a control a diver cannot use and therefore a
  // question they have to work out the answer to; since issue 627 the section
  // simply is not there until the card that makes it real is.
  //
  // Nothing about the safety contract moved: the number is still believed for
  // planning and sighted before the dive (ADR
  // 20260820-attested-at-booking-verified-at-boarding), and `authorizesNitroxFill`
  // still reads `verified`, which only a staffer can set.
  await page.goto("/s/blue-mantis");
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Christ of the Abyss" })
    .getByRole("link", { name: "Two-Tank Reef — Christ of the Abyss" })
    .click();
  // The booking form is controlled, so wait for hydration before typing.
  await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name").fill("Nora Quinn");
  // Unique email for this spec's own diver; the e2eNow() suffix keeps every
  // test-side timestamp anchored to the frozen clock (helpers.ts). Isolation
  // from other specs — including the visual suite — comes from the per-test
  // demo reset in fixtures.ts.
  await page.getByLabel("Email").fill(`nora+${e2eNow().getTime()}@example.com`);
  await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
  await expect(page.getByRole("heading", { name: /You’re on the boat, Nora/ })).toBeVisible();

  // Nothing on file, so there is no request box at all — and no sentence
  // pointing at one either. Scoped to the gear step and read without a
  // visibility filter: a step closed at rest would make a visible-only
  // assertion pass for the wrong reason.
  await expect(
    page.locator('[data-thread-step="gear"]').locator('input[name="nitrox"]'),
  ).toHaveCount(0);
  await expect(page.getByText(/Add your nitrox card above/)).toHaveCount(0);
  // What there *is* is the card itself, in the certification step with the
  // other cards, marked as the optional offer it is — and the explanation of
  // what nitrox even is now lives inside it, where a diver meets the word.
  const certification = await openThreadStep(page, "certification");
  const nitroxCard = certification
    .locator("details")
    .filter({ has: page.getByText("Add your nitrox card", { exact: true }) });
  await expect(nitroxCard).toHaveCount(1);
  await expect(nitroxCard.getByText("Optional")).toBeVisible();

  // Filing it. Collapsed by default, so it opens first — that is the point of
  // the disclosure, and a diver short three cards sees three summaries rather
  // than three open forms.
  await nitroxCard.getByText("Add your nitrox card", { exact: true }).click();
  // The "what is nitrox?" explanation moved off the gear row's locked legend
  // and into this section (issue 627), as text rather than a hover marker.
  await expect(nitroxCard.getByText(/breathing gas with extra oxygen/i)).toBeVisible();
  await nitroxCard.locator('select[name="agency"]').selectOption("padi");
  await nitroxCard.locator('input[name="identifier"]').fill("EANX-E2E-001");
  await nitroxCard.getByRole("button", { name: "Add my certification" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Certification added" })).toBeVisible();

  // The card is on the record — pending, never verified, since only a staffer
  // can sight one — and that is enough for the request to appear.
  const request = (await openThreadStep(page, "gear")).locator('input[name="nitrox"]');
  await expect(request).toBeEnabled();
  await request.check();
  await page.getByRole("button", { name: "Save rental fit" }).click();
  await expect((await openThreadStep(page, "gear")).locator('input[name="nitrox"]')).toBeChecked();
  // The offer is answered, so the page stops making it.
  await expect(
    page
      .locator('[data-thread-step="certification"]')
      .getByText("Add your nitrox card", { exact: true }),
  ).toHaveCount(0);
});

test("a course taught on air offers no nitrox request, at the same shop that fills it", async ({
  page,
}) => {
  // Two gates, not one (`nitroxAvailableOn`, src/lib/rentals.ts). The test
  // above books an ordinary reef trip at this shop and is offered nitrox; the
  // Open Water class is at the same shop, on the same catalog, and must not
  // be — its students are being certified on air and none of them can hold the
  // verified nitrox card a fill needs. Offering the box there advertises a
  // fill the course cannot give.
  // In through the course's own page rather than the schedule: that is the
  // route a diver enrolling in a course actually takes, and the session sits
  // far enough out that the schedule's first page need not carry it.
  await page.goto("/s/blue-mantis/courses/open-water-diver");
  await page.getByRole("link", { name: "Book this date" }).first().click();
  await expect(page.getByText("Course session · Open Water Diver")).toBeVisible();
  await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name").fill("Owen Reid");
  await page.getByLabel("Email").fill(`owen+${e2eNow().getTime()}@example.com`);
  // The course carries the agency's minimum age, so this booking form asks
  // for the attestation an ordinary charter's does not.
  await acceptAgeAttestation(page);
  await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
  await expect(page.getByRole("heading", { name: /You’re on the boat, Owen/ })).toBeVisible();

  // The rest of the rental form is untouched — this closes one box, not the
  // picker — so the assertion is about nitrox alone, not about a form that
  // failed to render.
  await expect(page.getByRole("button", { name: "Save rental fit" })).toBeVisible();
  await expect(page.locator('input[name="nitrox"]').filter({ visible: true })).toHaveCount(0);
});
