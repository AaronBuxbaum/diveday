import { expect, READ_ONLY, signedInAsOwner, test } from "./fixtures";
import {
  createTrip,
  daysFromNow,
  e2eNow,
  openTripAbout,
  openTripTab,
  seededTripId,
} from "./helpers";

/**
 * **The boat's own cert gate, at the moment the seat is sold** (DOM-M6, ADR
 * 20260803-trip-admission-at-booking).
 *
 * AGENTS.md names cert/nitrox gating as a flow that must have an `e2e/` spec
 * and it had none — the rule was covered by unit tests on
 * `decideTripAdmission`, `createBookingRecord`, and `seatDiver`, but nothing
 * proved the refusal ever reaches a human. That gap is exactly where this
 * feature's near-misses lived: the structured refusal shipped and reached no
 * UI, and the public form fell through to "this trip isn't taking bookings
 * right now" on a page displaying spots left. Both were caught in review, not
 * by a test.
 *
 * Its own file rather than cases in `booking.spec.ts`: that file is the
 * schedule→book→roster loop, and every test in it already runs a 30-second
 * multi-navigation journey. This is a different flow with a different subject —
 * what a shop's cards refuse, and where it says so.
 *
 * The seeded fixtures come from `src/db/seed-cert-gates.ts`, which exists so
 * each of these refusals can be about exactly one thing:
 *
 * - **Advanced Drift — French Reef Wall** — Advanced Open Water and nothing
 *   else, at an ungated site: a level refusal, uncontaminated.
 * - **Deep Adventure — USCGC Duane** — the site's Deep card, with no nitrox
 *   demand (unlike the shop's other two Duane sailings): a specialty refusal.
 * - **Advanced Open Water Diver — two-day course** — a course session at that
 *   same gated site: the carve-out, which must admit an Open Water student.
 *
 * The refusal subjects are seeded too: **Diego Alvarez** (a verified Open Water
 * card and nothing more) and **Odile Marchand** (a verified *Instructor* card
 * and no specialty card at all — the top of the ladder, refused anyway).
 */

const ADVANCED_CHARTER = "Advanced Drift — French Reef Wall";
const DEEP_CHARTER = "Deep Adventure — USCGC Duane";
const AOW_COURSE = "Advanced Open Water Diver — two-day course";

test.describe("as owner", () => {
  signedInAsOwner();

  test("the public trip page states what the charter requires above the form, and says so again when the booking is refused", async ({
    page,
  }) => {
    // Finding the departure on the staff board, then reading it as a signed-out
    // visitor — two full page journeys, same aggregate-cost reasoning as
    // booking.spec.ts's own multi-navigation tests.
    test.setTimeout(30_000);
    const tripId = await seededTripId(page, "blue-mantis", ADVANCED_CHARTER);

    // Read it as a diver would: no session at all.
    await page.context().clearCookies();
    await page.goto(`/s/blue-mantis/trips/${tripId}`);
    await expect(page.getByRole("heading", { name: ADVANCED_CHARTER })).toBeVisible();

    // Stated *before* the form, not after the seat is bought. The requirement is
    // a property of the trip, so it discloses nothing about any reader — and it
    // is one unboxed line now, with no heading over it (ADR
    // 20260827-the-divers-thread, decision 2: "who it's for, one line, no box").
    const requirement = page.getByText(
      "This charter is for divers with Advanced Open Water or higher.",
    );
    await expect(requirement).toBeVisible();
    await expect(page.getByRole("heading", { name: "Who this trip is for" })).toHaveCount(0);
    const partySize = page.getByLabel("Number of divers");
    await expect(partySize).toHaveAttribute("data-hydrated", "true");
    const noteBox = await requirement.boundingBox();
    const formBox = await partySize.boundingBox();
    expect(noteBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(formBox?.y ?? 0);

    // Diego Alvarez is on file with a verified Open Water card and nothing
    // above it — the shop has adjudicated him, so this is a settled
    // impossibility rather than an absence of evidence.
    await page.getByLabel("Name", { exact: true }).fill("Diego Alvarez");
    await page.getByLabel("Email", { exact: true }).fill("diego.alvarez@example.com");
    await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();

    // What the *trip* requires, never what this person lacks (H-22). The
    // non-disclosing fallback would be a lie on a page showing spots left, so
    // it must not appear.
    await expect(
      page.getByText(/This charter is for divers with Advanced Open Water or higher, so we could/),
    ).toBeVisible();
    await expect(page.getByText(/isn't taking bookings right now/)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /You’re on the boat/ })).toHaveCount(0);
  });

  test("a diver the shop knows nothing about is not screened at the sale", async ({ page }) => {
    // The other half of the test above, and the line this gate now draws.
    // There, the shortfall rests on the shop's own *record* — a verified Open
    // Water card and nothing above it — and the refusal stands. Here the shop
    // holds nothing at all, so there is nothing to judge and the seat is sold:
    // H-08's fail-open, which the booking form's certification question briefly
    // covered over between 2026-08-20 and 2026-08-27 (ADR
    // 20260820-attested-at-booking-verified-at-boarding, amended).
    //
    // Readiness is what stops them at the dock, and it is unchanged: nothing
    // clears a boarding decision but a card a staffer has sighted.
    test.setTimeout(30_000);
    const tripId = await seededTripId(page, "blue-mantis", ADVANCED_CHARTER);
    await page.context().clearCookies();
    await page.goto(`/s/blue-mantis/trips/${tripId}`);
    await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");

    // The requirement is still disclosed above the form — a property of the
    // trip, and the half a deciding diver needs.
    await expect(
      page.getByText("This charter is for divers with Advanced Open Water or higher."),
    ).toBeVisible();
    // And the form asks nothing about anybody's diving.
    await expect(page.locator('select[name^="certificationLevel"]')).toHaveCount(0);

    await page.getByLabel("Name", { exact: true }).fill("Wren Halloway");
    await page.getByLabel("Email", { exact: true }).fill(`wren-${e2eNow().getTime()}@example.com`);
    await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
    await expect(page).toHaveURL(/\/ready\//);
    // And the old refusal is not what happened.
    await expect(
      page.getByText(/This charter is for divers with Advanced Open Water or higher, so we could/),
    ).toHaveCount(0);
  });

  test("the Guests tab names the level the charter wants and the level the diver holds", async ({
    page,
  }) => {
    const tripId = await seededTripId(page, "blue-mantis", ADVANCED_CHARTER);
    await page.goto(`/shop/blue-mantis/trips/${tripId}?diverq=Diego+Alvarez`);
    await page.getByRole("button", { name: "Add Diego Alvarez to the trip" }).click();

    // The structured refusal rides the redirect as a single `gate=` param and
    // becomes the sentence — without it every refusal shared one static line.
    // Asserted on `gate` rather than `notice`: this page's `FlashParams` strips
    // `notice` on mount so the message can't replay on refresh, which makes any
    // assertion on it a race. `gate` is not in that list and stays put.
    //
    // The codes stay readable and an HMAC follows them, bound to this
    // departure (src/lib/trip-admission-gate.ts) — unsigned, the param was an
    // instruction anyone could write.
    await expect(page).toHaveURL(/gate=advanced_open_water[^&]*\.[\w-]{40,}/);
    const banner = page.getByText("This charter requires Advanced Open Water.");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("highest certification on file is Open Water");
    // A level refusal has no missing card, and pointing a staffer at the
    // certifications form would be pointing them past a safety gate: a
    // hand-entered card lands `pending`, which clears admission next attempt
    // (H-24). So the "there's no such card on the record" sentence must not
    // render here.
    await expect(banner).not.toContainText("none on this diver");

    // Refused means refused — no seat was written.
    await expect(page.locator("#roster").getByText("Diego Alvarez")).toHaveCount(0);
  });

  test("a hand-written ?gate= cannot manufacture a specific refusal", async ({ page }) => {
    // The signature exists because the *specific* sentences are the dangerous
    // ones: "their Deep card isn't on file" points a staffer at the
    // certifications form, and a hand-entered card lands `pending`, which
    // clears admission on the next attempt (H-24). So the tamper doesn't bypass
    // a gate — it manufactures the prompt that gets a staffer to bypass one
    // (security review finding).
    const tripId = await seededTripId(page, "blue-mantis", ADVANCED_CHARTER);
    await page.goto(
      `/shop/blue-mantis/trips/${tripId}?notice=diver-trip-prerequisite&gate=~~deep~0`,
    );

    // The banner still appears — a refusal nobody can read is worse than a
    // vague one — but it says only the generic thing. `getByRole` (patched to
    // visible-only by `makeActivitySafe`, e2e/fixtures.ts) rather than a raw
    // `[role="alert"]` locator, same as invoicing.spec.ts and
    // promo-codes.spec.ts's own alert/status queries: this route's dynamic
    // content sits inside a real Suspense boundary, and React's own
    // streaming-resume machinery briefly parks a second, hidden clone of it
    // in a `<div id="S:n" hidden>` wrapper while the boundary settles — a
    // normal, invisible implementation detail, not a rendering bug — that an
    // unfiltered role query matches as readily as the real banner. `hasText`
    // rather than excluding Next's own always-present route announcer by id:
    // it also carries `role="alert"` but is filtered out here as a side
    // effect of not matching the text, the same disambiguation the other two
    // specs use.
    const banner = page.getByRole("alert").filter({ hasText: "certifications on file" });
    await expect(banner).toContainText("certifications on file don't reach what this trip");
    await expect(banner).not.toContainText("Deep certification");
    await expect(banner).not.toContainText("charter requires");
  });

  test("the global Add-booking door says a missing specialty certification is missing, whatever the diver's level", async ({
    page,
  }) => {
    const tripId = await seededTripId(page, "blue-mantis", DEEP_CHARTER);
    // Odile Marchand holds a verified Instructor card — the top rung — and no
    // specialty card at all. Nothing about her level can explain this refusal.
    await page.goto(`/shop/blue-mantis/bookings/new/${tripId}?diverq=Odile+Marchand`);
    await page.getByRole("button", { name: "Add Odile Marchand to this departure" }).click();

    // The global door's refusal stays on the form that produced it, boat still
    // chosen, so the staffer can pick someone else.
    await expect(page).toHaveURL(new RegExp(`/bookings/new/${tripId}\\?notice=`));
    const banner = page.getByText("This charter requires a Deep certification.");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("none on this diver");
    await expect(banner).not.toContainText("highest certification on file");
  });

  test("the counter collapses the same refusal to one blunt line and carries no gate detail", async ({
    page,
  }) => {
    // The walk-in picker only offers today's and tomorrow's boats, so the
    // counter's own case needs a same-day departure — the shape
    // check-in.spec.ts's full-boat refusal already uses.
    test.setTimeout(30_000);
    const title = `Counter Gate ${e2eNow().getTime()}`;
    await createTrip(page, {
      title,
      date: daysFromNow(0),
      departsAt: "20:00",
      returnsAt: "22:00",
      capacity: 4,
    });
    const tripId = await seededTripId(page, "blue-mantis", title);

    await page.goto(`/shop/blue-mantis/trips/${tripId}`);
    // The requirements form waits behind its Edit disclosure (summary-first
    // Overview).
    await openTripAbout(page);
    await page.getByText("Edit requirements", { exact: true }).click();
    await page.getByLabel("Minimum certification").selectOption("advanced_open_water");
    await page.getByRole("button", { name: "Save requirements" }).click();
    await expect(page.getByRole("status")).toContainText("Trip readiness requirements updated.");

    await page.goto(`/shop/blue-mantis/check-in/walk-in/${tripId}?diverq=Diego+Alvarez`);
    await page.getByRole("button", { name: "Add Diego Alvarez to this boat" }).click();

    // The counter names the gate now, on the form that produced the refusal,
    // with the boat still chosen. It used to collapse every gate into "open its
    // trip page for the reason", which sent the staffer to a different page at
    // the moment they had least time to go there. The structured detail rides a
    // signed `?gate=` bound to the departure in this route's own path, so the
    // banner can say which card is missing and what the diver holds.
    await expect(page).toHaveURL(new RegExp(`/check-in/walk-in/${tripId}\\?`));
    await expect(
      page.getByText(/Advanced Open Water|certifications on file|certifications don’t reach/),
    ).toBeVisible();
  });

  test("a course session admits the Open Water student its own site would refuse, and says why on the trip", async ({
    page,
  }) => {
    // The carve-out (ADR 20260803, amended after the dive-domain-expert
    // review): continuing education is taught at the sites it certifies people
    // for, so an AOW session's deep dive at a site marked `advanced_open_water`
    // + Deep must never refuse the student the course exists to create.
    test.setTimeout(30_000);
    const tripId = await seededTripId(page, "blue-mantis", AOW_COURSE);

    await page.goto(`/shop/blue-mantis/trips/${tripId}?diverq=Kwame+Asante`);
    await page.getByRole("button", { name: "Add Kwame Asante to the trip" }).click();
    // The seated notice, not the URL: `FlashParams` strips `notice` on mount
    // (by `replaceState`, so the server-rendered banner itself stays).
    await expect(page.getByRole("status")).toContainText("Diver added to the trip");
    await expect(page.locator("#roster").getByText("Kwame Asante").first()).toBeVisible();

    // The site's gate is still stated — on the one surface where staff cannot
    // edit it, it used to be invisible entirely — and it says out loud that it
    // never blocks enrolment.
    await page.goto(`/shop/blue-mantis/trips/${tripId}`);
    const requirements = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Readiness requirements" }) });
    await expect(
      requirements.getByText(/requires Advanced Open Water or higher and Deep specialty/),
    ).toBeVisible();
    // One site or several, singular or plural — the carve-out is the clause
    // that has to survive a copy trim, not the sentence carrying it.
    await expect(requirements.getByText(/never blocks? enrolment/)).toBeVisible();
    // A course session's rules are frozen; there is no form to tighten them.
    await expect(requirements.getByRole("button", { name: "Save requirements" })).toHaveCount(0);
  });

  test("tightening a booked trip's requirements says how many divers it just blocked", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    const title = `Tightened Gate ${e2eNow().getTime()}`;
    await createTrip(page, {
      title,
      date: daysFromNow(4),
      departsAt: "09:00",
      returnsAt: "13:00",
      capacity: 4,
    });
    const tripId = await seededTripId(page, "blue-mantis", title);

    // Seated while the trip states the shop's Open Water default, which his
    // verified card clears.
    await page.goto(`/shop/blue-mantis/trips/${tripId}?diverq=Diego+Alvarez`);
    await page.getByRole("button", { name: "Add Diego Alvarez to the trip" }).click();
    await expect(page.getByRole("status")).toContainText("Diver added to the trip");

    await page.goto(`/shop/blue-mantis/trips/${tripId}`);
    // The requirements form waits behind its Edit disclosure (summary-first
    // Overview).
    await openTripAbout(page);
    await page.getByText("Edit requirements", { exact: true }).click();
    await page.getByLabel("Minimum certification").selectOption("advanced_open_water");
    await page.getByRole("button", { name: "Save requirements" }).click();

    // A notice, never a refusal: the save always lands, and the staffer who
    // tightened the gate finds out who it caught instead of learning it from a
    // diver at the dock. Asserted on the rendered sentence — the trip page's
    // `FlashParams` strips both `notice`, `count`, and `form`.
    const outcome = page.getByRole("status").filter({ hasText: "Requirements updated." });
    await expect(outcome).toContainText(
      "Requirements updated. 1 booked diver no longer meets them",
    );
    // And it lands *in the requirements section*, beside the button that was
    // pressed. Overview carries six independent forms down a long page; this
    // one used to answer all of them in a single banner under the `<h1>`,
    // which on a phone is several screens from the control that earned it.
    const requirements = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Readiness requirements" }) });
    await expect(requirements.getByRole("status")).toContainText("Requirements updated.");
    await openTripTab(page, "Trip");
    await expect(page.locator("#roster").getByText("Diego Alvarez").first()).toBeVisible();
  });
});

/**
 * **TEST-6 — one whole booking flow rendered in Spanish.**
 *
 * Every other spec in this suite pins literal English, so no non-English render
 * was ever exercised: `Accept-Language` negotiation, the `es-ES` bundle, and —
 * the failure mode that motivated this — `DiverIntlProvider`. A diver Client
 * Component with no provider above it throws during the server render and the
 * page silently degrades to a blank client-only 200, which is invisible to a
 * status-code check and to every English-pinned assertion. Only a real render
 * in another language catches it.
 *
 * Asserted against the `es-ES` bundle's current values (swept on 2026-08-03 for
 * terminology — the shop is *el centro*, never *la tienda*; see
 * `src/i18n/locales/es-ES/README.md`).
 */
test.describe("with Accept-Language: es", () => {
  test.use({ locale: "es-ES" });

  test("a diver books a seat end to end and every word of it is Spanish", async ({ page }) => {
    test.setTimeout(30_000);
    await page.goto("/s/blue-mantis");

    // The list's own accessible name is itself a translated string — reaching
    // the trip through it is the first assertion, not scaffolding around one.
    await page
      .getByRole("list", { name: "Próximas salidas" })
      .locator("li")
      .filter({ hasText: "Two-Tank Reef — Christ of the Abyss" })
      .getByRole("link", { name: "Two-Tank Reef — Christ of the Abyss" })
      .first()
      .click();

    // The trip's own gate, in Spanish — proof the requirement note goes through
    // the bundle rather than being assembled from English fragments. One
    // unboxed sentence with no heading over it, the shape the English journey
    // above pins (ADR 20260827-the-divers-thread, decision 2); the sentence is
    // the whole of what the bundle has to get right.
    await expect(
      page.getByText("Esta salida es para buceadores con Open Water o superior."),
    ).toBeVisible();

    // The booking form is a Client Component reading copy through
    // `useTranslations` — these labels only exist if a `DiverIntlProvider` sits
    // above it with the diver namespaces loaded.
    await expect(page.getByRole("heading", { name: "Reserva tu plaza" })).toBeVisible();
    const partySize = page.getByLabel("Número de buceadores");
    await expect(partySize).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Nombre", { exact: true }).fill("Nora Quinn");
    await page
      .getByLabel("Correo electrónico", { exact: true })
      .fill(`nora-es-${e2eNow().getTime()}@example.com`);
    await page.getByRole("button", { name: /^Reservar (estas plazas|la última plaza)$/ }).click();

    // Where booking lands — the diver's own readiness page (ADR
    // 20260820-one-page-after-booking) — and the next step it offers, both in
    // the language the whole flow has been reading. The checklist heading is
    // the assertion that matters most here: it is rendered by the *destination*
    // route, so a locale that survived the booking form but was renegotiated
    // from scratch after the redirect would show up as English right here.
    await expect(page).toHaveURL(/\/ready\//);
    await expect(page.getByRole("heading", { name: /¡Estás a bordo, Nora/ })).toBeVisible();
    // The step spine replaced the checklist and its heading with it (slice 7c):
    // a step's title is a `<span>` inside a `<summary>`, which must be phrasing
    // content. `data-thread-step` is the spine's own e2e hook, and this keeps
    // what the assertion was for — a string rendered by the *destination*
    // route, in Spanish, so a locale renegotiated after the redirect shows up
    // here as English.
    await expect(page.locator('[data-thread-step="sign"]')).toContainText("Firma");
    await expect(page.getByRole("button", { name: "Firmar tu exención" })).toBeVisible();
  });
});

/**
 * **The same gate, one level up — on the list a diver actually scans**
 * (issue #695).
 *
 * Until this, the schedule showed a departure's requirement nowhere, so a
 * diver had to open all fifteen cards to learn which they could book, and
 * shops worked around it by typing the requirement into the free-text
 * description by hand — where it cannot be translated and where nothing
 * reconciles it with the gate the form above actually enforces. The demo
 * shop's own seed data did exactly that on three cards.
 *
 * Anonymous and READ_ONLY: the public schedule takes no session and writes
 * nothing. The assertions use the demo shop's own page-one departures rather
 * than `seed-cert-gates.ts`'s fixtures, which sail 29-32 days out and are
 * therefore several keyset pages down.
 */
test.describe("what the public schedule card says a departure requires", () => {
  test("a composed gate reaches the card, and a course session still shows none", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    await page.goto("/s/blue-mantis");
    // The filter <form> is immediately followed by the trip <ul> — the same
    // scoping schedule-filters.spec.ts uses to stay off any other list.
    const list = page.locator("form + ul");
    const row = (title: string) => list.getByRole("listitem").filter({ hasText: title });

    // The wreck charter asks only for Open Water in its own row; Spiegel Grove
    // is what demands Advanced Open Water and a Deep card, and the trip adds
    // nitrox. All three have to be on the card, or the composition is not what
    // reached it.
    // The labels went with the stacked detail lines when the storefront
    // recomposed (ADR 20260827-clearwater-surface-language, decision 8): each
    // marker is already worded to stand on its own, and the row's one meta line
    // sets them between separators.
    await expect(
      row("Wreck Trip — Spiegel Grove").getByText(/Advanced Open Water or higher · Deep · Nitrox/),
    ).toBeVisible();

    await expect(
      row("Two-Tank Reef — Molasses & French").getByText(/Open Water or higher/),
    ).toBeVisible();

    // And the requirement is no longer *also* typed into the description — the
    // duplication the seed used to model.
    await expect(list.getByText(/AOW \+ Deep \+ nitrox required/)).toHaveCount(0);
    await expect(list.getByText(/All levels, OW required/)).toHaveCount(0);
  });

  test("a course session states no gate, the same carve-out the trip page makes", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    // Continuing education is taught at the sites it certifies people for, so
    // an AOW session's deep site must never read as a bar on the very students
    // the course exists to create (ADR 20260803-trip-admission-at-booking).
    // The trip page has always made this carve-out; the card has to make the
    // same one or it contradicts the page one tap below it.
    await page.goto("/s/blue-mantis?tripType=course");
    const list = page.locator("form + ul");
    const rows = list.getByRole("listitem");
    await expect(rows).not.toHaveCount(0);
    await expect(list.getByText(/or higher/)).toHaveCount(0);
    await expect(list.getByText(/^Nitrox$/)).toHaveCount(0);
  });

  test("the embed carries the gate too", { tag: READ_ONLY }, async ({ page }) => {
    // `?embed=1` drops the shop chrome and is the surface a shop pastes into
    // its own site — the one most likely to be the only schedule a diver ever
    // sees (ADR 20260726-schedule-embed).
    //
    // A different departure from the test above, because the embed shows a
    // shorter list and Spiegel Grove sails past the end of it. This one is the
    // better witness anyway: its Advanced Open Water and Deep come from the
    // Duane, and its nitrox from the trip row.
    await page.goto("/s/blue-mantis?embed=1");
    await expect(
      page
        .getByRole("listitem")
        .filter({ hasText: "Deep Wreck Charter — the Duane on EANx" })
        .getByText(/Advanced Open Water or higher · Deep · Nitrox/),
    ).toBeVisible();
  });
});
