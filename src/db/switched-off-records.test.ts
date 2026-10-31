import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";
import { createBookingParty } from "./bookings";
import {
  createDiveSite,
  importGlobalDiveSiteTemplate,
  listDiveSiteCreatures,
  listGlobalDiveSiteTemplates,
  listSiteFieldGuides,
  pullDiveSiteTemplateUpdates,
  undoDiveSiteTemplateUpdate,
  updateDiveSiteForForm,
} from "./dive-sites";
import { upsertExecutedDive } from "./executed-dives";
import { deliverSeatOffer, offerDepartureToDiver } from "./interest-offers";
import { askForDeparture } from "./interests";
import { MARINE_LIFE_CATALOG } from "./marine-life-catalog";
import {
  addCrewRecapPhoto,
  addRecapPhoto,
  canAddCrewRecapPhoto,
  canAddRecapPhoto,
  deleteRecapPhoto,
  getRecapPageData,
  listRecapPhotosForTrips,
} from "./recap";
import { getMonthlyReport } from "./reporting";
import {
  bookings,
  diveSites,
  executedDives,
  globalDiveSites,
  globalDiveSiteVersions,
  interests,
  people,
  personRoles,
  shops,
  trips,
} from "./schema";
import { createTrip, getTripGuests, listStaff, upcomingTripsWithCounts } from "./trips";

/**
 * **A switched-off feature keeps what it holds** (ADR
 * 20261005-optional-shop-features, layer 3): the writers behind sightings and
 * recap photos refuse or leave a value alone while their switch is off, and
 * nothing already recorded is erased.
 */

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

describe("sightings switched off", () => {
  it("keeps the logged species when a dive is saved again", async () => {
    const { db, shop } = ctx;
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    const [trip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, shop.id))
      .limit(1);
    const [species] = MARINE_LIFE_CATALOG;
    if (!owner || !trip || !species) throw new Error("fixture needs an owner, a trip, a species");
    await db.delete(executedDives).where(eq(executedDives.tripId, trip.id));
    await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      observedSpeciesSlug: species.slug,
      recordedByPersonId: owner.id,
    });

    // The form drew no species field; a save of the depth must not erase it,
    // even from a post that sends an empty one.
    const resaved = await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      maxDepthMeters: 21,
      observedSpeciesSlug: null,
      keepObservedSpecies: true,
      recordedByPersonId: owner.id,
    });
    expect(resaved).toMatchObject({
      ok: true,
      dive: { maxDepthMeters: 21, observedSpeciesSlug: species.slug },
    });
  });

  it("saves the species a form that showed the picker posted, after the switch went off", async () => {
    const { db, shop } = ctx;
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    const [trip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, shop.id))
      .limit(1);
    const [species] = MARINE_LIFE_CATALOG;
    if (!owner || !trip || !species) throw new Error("fixture needs an owner, a trip, a species");
    await db.delete(executedDives).where(eq(executedDives.tripId, trip.id));
    // The form loaded with sightings on; the switch went off before Save.
    await db.update(shops).set({ sightingsEnabled: false }).where(eq(shops.id, shop.id));

    const saved = await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      observedSpeciesSlug: species.slug,
      keepObservedSpecies: false,
      recordedByPersonId: owner.id,
    });
    expect(saved).toMatchObject({ ok: true, dive: { observedSpeciesSlug: species.slug } });
  });
});

describe("recap photos switched off", () => {
  it("takes no photo from a diver or the crew, and keeps every one for takedown", async () => {
    const { db, shop } = ctx;
    const upcoming = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const reef = upcoming.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
    const [staff] = await listStaff(db, shop.id);
    if (!reef || !staff) throw new Error("demo reef trip or staff missing");
    const party = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: reef.id,
        fullName: "Pia Photos",
        email: "pia.photos@example.com",
      },
    ]);
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
    const bookingId = party.bookings[0].bookingId;
    const kept = await addRecapPhoto(db, { bookingId, imageUrl: "https://img/kept.jpg" });
    if (!kept.ok) throw new Error("photo not added");
    await db.update(shops).set({ diverPhotosEnabled: false }).where(eq(shops.id, shop.id));

    expect(await canAddRecapPhoto(db, bookingId)).toEqual({ ok: false, reason: "not_found" });
    expect(await addRecapPhoto(db, { bookingId, imageUrl: "https://img/new.jpg" })).toEqual({
      ok: false,
      reason: "not_found",
    });
    const crew = {
      shopId: shop.id,
      tripId: reef.id,
      uploadedByPersonId: staff.person.id,
      now: new Date(reef.endsAt.getTime() + 15 * 60 * 60 * 1000),
    };
    expect(await canAddCrewRecapPhoto(db, crew)).toEqual({ ok: false, reason: "not_found" });
    expect(await addCrewRecapPhoto(db, { ...crew, imageUrl: "https://img/crew.jpg" })).toEqual({
      ok: false,
      reason: "not_found",
    });

    // The diver's page shows no album; staff still see the photo to take it down.
    expect((await getRecapPageData(db, bookingId))?.photos).toEqual([]);
    const staffView = await listRecapPhotosForTrips(db, shop.id, [reef.id]);
    expect(staffView.some((photo) => photo.id === kept.photo.id)).toBe(true);
    expect(await deleteRecapPhoto(db, shop.id, kept.photo.id)).toEqual({
      deleted: true,
      imageUrl: "https://img/kept.jpg",
    });

    await db.update(shops).set({ diverPhotosEnabled: true }).where(eq(shops.id, shop.id));
    expect(await canAddRecapPhoto(db, bookingId)).toEqual({ ok: true });
  });
});

describe("partner links switched off", () => {
  it("counts no referred seat on Reports, and keeps every seat's source", async () => {
    const { db, shop } = ctx;
    const [seat] = await db
      .select({ id: bookings.id, startsAt: trips.startsAt })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .where(and(eq(bookings.shopId, shop.id), eq(bookings.status, "booked")))
      .limit(1);
    if (!seat) throw new Error("seed has no booked seat");
    await db
      .update(bookings)
      .set({ referralSource: "harbor-hotel" })
      .where(eq(bookings.id, seat.id));
    const from = new Date(seat.startsAt.getTime() - 60 * 60 * 1000);
    const to = new Date(seat.startsAt.getTime() + 60 * 60 * 1000);

    expect((await getMonthlyReport(db, shop.id, from, to)).partnerReferredSeats).toBeGreaterThan(0);
    await db.update(shops).set({ partnerLinksEnabled: false }).where(eq(shops.id, shop.id));
    expect((await getMonthlyReport(db, shop.id, from, to)).partnerReferredSeats).toBe(0);
    const [kept] = await db
      .select({ referralSource: bookings.referralSource })
      .from(bookings)
      .where(eq(bookings.id, seat.id));
    expect(kept?.referralSource).toBe("harbor-hotel");
  });
});

describe("field guide switched off", () => {
  async function guidedSite() {
    const { db, shop } = ctx;
    const site = await createDiveSite(db, {
      shopId: shop.id,
      name: "Switch Reef",
      fieldGuideTipsHeading: "Look under the ledges",
      creatures: ["banded-butterflyfish"],
    });
    if (!site) throw new Error("site not created");
    return { db, shop, site };
  }

  it("reads no guide for any site, and keeps every row", async () => {
    const { db, shop, site } = await guidedSite();
    expect((await listSiteFieldGuides(db, shop.id, [site.id])).get(site.id)).toHaveLength(1);
    await db.update(shops).set({ fieldGuideEnabled: false }).where(eq(shops.id, shop.id));
    expect((await listSiteFieldGuides(db, shop.id, [site.id])).size).toBe(0);
    expect(await listDiveSiteCreatures(db, shop.id, site.id)).toHaveLength(1);
  });

  it("keeps the guide and its tips heading when the site form saves without them", async () => {
    const { db, shop, site } = await guidedSite();
    await db.update(shops).set({ fieldGuideEnabled: false }).where(eq(shops.id, shop.id));
    // The form drew no field-guide section, so the parse hands over an empty
    // list and a blank heading; a hand-built post could carry anything.
    await updateDiveSiteForForm(db, shop.id, site.id, {
      shopId: shop.id,
      name: "Switch Reef",
      fieldGuideTipsHeading: "",
      creatures: [],
    });
    expect(await listDiveSiteCreatures(db, shop.id, site.id)).toHaveLength(1);
    const [row] = await db
      .select({ heading: diveSites.fieldGuideTipsHeading })
      .from(diveSites)
      .where(eq(diveSites.id, site.id));
    expect(row?.heading).toBe("Look under the ledges");
  });

  it("writes no guide from a template pull, or its undo, while off", async () => {
    // Review 2026-10-23, item 11: the pull is a writer of the site row too.
    const { db, shop } = ctx;
    const entry = (await listGlobalDiveSiteTemplates(db, { limit: 1000 })).templates.find(
      (row) => row.version.briefing.name === "Molasses Reef",
    );
    if (!entry) throw new Error("seed: no published Molasses Reef template");
    const imported = await importGlobalDiveSiteTemplate(db, shop.id, entry.template.id);
    if (!imported) throw new Error("expected a catalog copy");
    const next = entry.version.version + 1;
    await db.insert(globalDiveSiteVersions).values({
      globalDiveSiteId: entry.template.id,
      version: next,
      briefing: {
        ...entry.version.briefing,
        description: "A newer published briefing.",
        fieldGuideTipsHeading: "The catalog's tips",
        creatureSlugs: ["banded-butterflyfish", "green-sea-turtle"],
      },
    });
    await db
      .update(globalDiveSites)
      .set({ currentVersion: next })
      .where(eq(globalDiveSites.id, entry.template.id));
    const guideBefore = async () => ({
      creatures: (await listDiveSiteCreatures(db, shop.id, imported.id)).map((c) => c.catalogSlug),
      heading: (
        await db
          .select({ heading: diveSites.fieldGuideTipsHeading })
          .from(diveSites)
          .where(eq(diveSites.id, imported.id))
      )[0]?.heading,
    });
    const before = await guideBefore();
    await db.update(shops).set({ fieldGuideEnabled: false }).where(eq(shops.id, shop.id));

    const pulled = await pullDiveSiteTemplateUpdates(
      db,
      shop.id,
      imported.id,
      "replace-template-copy",
    );
    expect(pulled.status).toBe("updated");
    const [row] = await db.select().from(diveSites).where(eq(diveSites.id, imported.id));
    expect(row?.description).toBe("A newer published briefing.");
    expect(await guideBefore()).toEqual(before);

    expect((await undoDiveSiteTemplateUpdate(db, shop.id, imported.id)).status).toBe("undone");
    expect(await guideBefore()).toEqual(before);
  });

  it("writes the guide from the form while on", async () => {
    const { db, shop, site } = await guidedSite();
    await updateDiveSiteForForm(db, shop.id, site.id, {
      shopId: shop.id,
      name: "Switch Reef",
      fieldGuideTipsHeading: "",
      creatures: [],
    });
    expect(await listDiveSiteCreatures(db, shop.id, site.id)).toHaveLength(0);
  });
});

describe("wait list switched off", () => {
  /** A boat with one seat, taken: the wait list's only door. */
  async function fullBoat() {
    const { db, shop } = ctx;
    const startsAt = new Date(Date.UTC(2031, 0, 10, 13));
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Full Switch Boat",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      capacity: 1,
      plannedDives: 2,
    });
    if (!trip) throw new Error("trip not created");
    const seated = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Seated Sam",
        email: "seated-switch@example.com",
      },
    ]);
    if (!seated.ok) throw new Error("seat failed");
    return { db, shop, trip };
  }

  const ask = (shopId: string, tripId: string, email: string) => ({
    shopId,
    tripId,
    fullName: "Waiting Wren",
    email,
  });

  it("takes no join, and keeps an interest already on file in view until it is handled", async () => {
    const { db, shop, trip } = await fullBoat();
    const before = await askForDeparture(db, ask(shop.id, trip.id, "wren-before@example.com"));
    expect(before.ok).toBe(true);
    await db.update(shops).set({ waitlistEnabled: false }).where(eq(shops.id, shop.id));

    expect(await askForDeparture(db, ask(shop.id, trip.id, "wren-after@example.com"))).toEqual({
      ok: false,
      reason: "trip_unavailable",
    });
    const onFile = await db.select().from(interests).where(eq(interests.tripId, trip.id));
    expect(onFile).toHaveLength(1);

    const [row] = await db.select().from(shops).where(eq(shops.id, shop.id));
    if (!row) throw new Error("shop missing");
    const guests = await getTripGuests(db, row, trip.id);
    expect(guests?.waitlistOn).toBe(false);
    // Review 2026-10-23, item 8: a diver already waiting never vanishes.
    expect(guests?.interests.map(({ interest }) => interest.id)).toEqual([
      before.ok ? before.interestId : "",
    ]);
  });

  it("still answers that a seat is open before saying the list is off", async () => {
    // Review 2026-10-23, item 7: "go and book it" outranks the switch.
    const { db, shop, trip } = await fullBoat();
    await db.update(shops).set({ waitlistEnabled: false }).where(eq(shops.id, shop.id));
    await db.update(trips).set({ capacity: 2 }).where(eq(trips.id, trip.id));
    expect(await askForDeparture(db, ask(shop.id, trip.id, "wren-open@example.com"))).toEqual({
      ok: false,
      reason: "trip_available",
    });
  });

  it("sends no seat offer to a wait-list ask, and stamps nothing", async () => {
    const { db, shop, trip } = await fullBoat();
    const joined = await askForDeparture(db, ask(shop.id, trip.id, "wren-offer@example.com"));
    if (!joined.ok) throw new Error("join failed");
    await db.update(shops).set({ waitlistEnabled: false }).where(eq(shops.id, shop.id));
    expect(
      await deliverSeatOffer(db, {
        shopId: shop.id,
        shopSlug: shop.slug,
        tripId: trip.id,
        interestId: joined.interestId,
      }),
    ).toBe("fallback");
    const [row] = await db
      .select({ offeredAt: interests.offeredAt })
      .from(interests)
      .where(eq(interests.id, joined.interestId));
    expect(row?.offeredAt).toBeNull();
  });

  it("still lets a staffer email a waiting diver this date themselves", async () => {
    // Review 2026-10-23, item 4: the direct invite and the no-show desk's
    // "Email them this date" reuse the diver's wait-list row; the switch
    // governs the wait list's own sends, never a staffer's outreach.
    const { db, shop, trip } = await fullBoat();
    const joined = await askForDeparture(db, ask(shop.id, trip.id, "wren-direct@example.com"));
    if (!joined.ok) throw new Error("join failed");
    await db.update(shops).set({ waitlistEnabled: false }).where(eq(shops.id, shop.id));
    await db.update(trips).set({ capacity: 2 }).where(eq(trips.id, trip.id));
    const [waiting] = await db
      .select({ personId: interests.personId })
      .from(interests)
      .where(eq(interests.id, joined.interestId));
    const [staff] = await listStaff(db, shop.id);
    if (!waiting?.personId || !staff) throw new Error("fixture missing");
    const email = fakeEmail();

    expect(
      await offerDepartureToDiver(
        db,
        {
          shopId: shop.id,
          shopSlug: shop.slug,
          tripId: trip.id,
          personId: waiting.personId,
          createdByPersonId: staff.person.id,
        },
        email.provider,
      ),
    ).toBe("sent");
    const [row] = await db
      .select({ offeredAt: interests.offeredAt })
      .from(interests)
      .where(eq(interests.id, joined.interestId));
    expect(row?.offeredAt).not.toBeNull();
  });
});

describe("past-diver invites switched off", () => {
  it("suggests nobody on a boat with seats", async () => {
    const { db, shop } = ctx;
    const [row] = await db.select().from(shops).where(eq(shops.id, shop.id));
    if (!row) throw new Error("shop missing");
    const upcoming = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const open = upcoming.find((trip) => trip.booked < trip.capacity && trip.diveSite);
    if (!open) throw new Error("seed has no open boat at a site");
    await db.update(shops).set({ pastDiverInvitesEnabled: false }).where(eq(shops.id, shop.id));
    const guests = await getTripGuests(db, { ...row, pastDiverInvitesEnabled: false }, open.id);
    expect(guests?.inviteSuggestions).toBeNull();
  });

  it("sends a suggestion's invite nothing while off, and a staffer's own invite still goes", async () => {
    // Review 2026-10-23, items 9 and 10: the switch governs the suggestion's
    // send; the roster's Invite, the course ladder and the no-show desk are a
    // staffer's own choice of diver.
    const { db, shop } = ctx;
    const upcoming = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const open = upcoming.find((trip) => trip.booked < trip.capacity);
    const [staff] = await listStaff(db, shop.id);
    const [someone] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Pat Past", email: "pat-past@example.com" })
      .returning({ id: people.id });
    if (!open || !staff || !someone) throw new Error("fixture missing");
    const [row] = await db
      .insert(interests)
      .values({
        shopId: shop.id,
        scope: "departure",
        askedBy: "shop",
        tripId: open.id,
        personId: someone.id,
        createdByPersonId: staff.person.id,
        partySize: 1,
      })
      .returning({ id: interests.id });
    if (!row) throw new Error("interest insert failed");
    await db.update(shops).set({ pastDiverInvitesEnabled: false }).where(eq(shops.id, shop.id));
    const offer = (initiatedBy: "suggestion" | "shop") =>
      deliverSeatOffer(
        db,
        { shopId: shop.id, shopSlug: shop.slug, tripId: open.id, interestId: row.id, initiatedBy },
        fakeEmail().provider,
      );
    expect(await offer("suggestion")).toBe("fallback");
    expect(await offer("shop")).not.toBe("fallback");
  });
});
