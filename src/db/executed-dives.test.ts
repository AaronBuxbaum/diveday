import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUR_MS } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { seededShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { checkInBooking, undoCheckInBooking } from "./check-in";
import type { AppDb } from "./client";
import {
  deleteExecutedDive,
  listExecutedDives,
  peopleWhoDivedBefore,
  upsertExecutedDive,
} from "./executed-dives";
import { MARINE_LIFE_CATALOG } from "./marine-life-catalog";
import {
  bookings,
  certifications,
  diveSiteCreatures,
  diveSites,
  executedDives,
  people,
  personRoles,
  shops,
  tripDeskEvents,
  tripDives,
  trips,
} from "./schema";
import { createTrip } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";

async function logFixture() {
  const { db, shop } = await seededShopContext();
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  const [trip] = await db
    .select({ id: trips.id, plannedDives: trips.plannedDives })
    .from(trips)
    .where(eq(trips.shopId, shop.id))
    .limit(1);
  if (!owner || !trip) throw new Error("executed-dive fixture needs the seeded owner and a trip");
  return { db, shop, owner, trip };
}

describe("upsertExecutedDive", () => {
  it("records a dive and reads it back on the trip", async () => {
    const { db, shop, owner, trip } = await logFixture();

    const saved = await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      maxDepthMeters: 18,
      recordedByPersonId: owner.id,
    });
    expect(saved).toMatchObject({ ok: true, dive: { maxDepthMeters: 18 } });

    const listed = await listExecutedDives(db, shop.id, trip.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.executed.diveNumber).toBe(1);
  });

  /**
   * Two divemasters writing the same dive number at the rail is a real
   * sequence, and this used to be a select-then-insert: the loser hit
   * `executed_dives_trip_number_live_unique` and escaped as a 500.
   */
  it("lets a second write for the same dive number land on the first one's row", async () => {
    const { db, shop, owner, trip } = await logFixture();
    const write = (maxDepthMeters: number) =>
      upsertExecutedDive(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveNumber: 1,
        maxDepthMeters,
        recordedByPersonId: owner.id,
      });

    const [first, second] = await Promise.all([write(18), write(21)]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    const listed = await listExecutedDives(db, shop.id, trip.id);
    expect(listed).toHaveLength(1);
    expect([18, 21]).toContain(listed[0]?.executed.maxDepthMeters);
  });

  it("refuses a dive number the trip does not plan", async () => {
    const { db, shop, owner, trip } = await logFixture();

    expect(
      await upsertExecutedDive(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveNumber: 0,
        recordedByPersonId: owner.id,
      }),
    ).toEqual({ ok: false, reason: "dive_number_out_of_range" });
    expect(
      await upsertExecutedDive(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveNumber: trip.plannedDives + 1,
        recordedByPersonId: owner.id,
      }),
    ).toEqual({ ok: false, reason: "dive_number_out_of_range" });
  });

  it("refuses a transposed entry and exit time rather than storing it", async () => {
    const { db, shop, owner, trip } = await logFixture();

    expect(
      await upsertExecutedDive(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveNumber: 1,
        enteredAt: new Date("2026-07-21T15:00:00.000Z"),
        exitedAt: new Date("2026-07-21T14:00:00.000Z"),
        recordedByPersonId: owner.id,
      }),
    ).toEqual({ ok: false, reason: "times_transposed" });
    expect(await listExecutedDives(db, shop.id, trip.id)).toHaveLength(0);
  });

  it("refuses a negative depth", async () => {
    const { db, shop, owner, trip } = await logFixture();

    expect(
      await upsertExecutedDive(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveNumber: 1,
        maxDepthMeters: -5,
        recordedByPersonId: owner.id,
      }),
    ).toEqual({ ok: false, reason: "depth_out_of_range" });
  });

  /** A shop may only write the log of its own departure. */
  it("refuses another shop's trip", async () => {
    const { db, shop, owner, trip } = await logFixture();

    expect(
      await upsertExecutedDive(db, {
        shopId: crypto.randomUUID(),
        tripId: trip.id,
        diveNumber: 1,
        recordedByPersonId: owner.id,
      }),
    ).toEqual({ ok: false, reason: "unknown_trip" });
    expect(await listExecutedDives(db, shop.id, trip.id)).toHaveLength(0);
  });

  it("refuses a recorder who is not on this shop's roster", async () => {
    const { db, shop, trip } = await logFixture();

    expect(
      await upsertExecutedDive(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveNumber: 1,
        recordedByPersonId: crypto.randomUUID(),
      }),
    ).toEqual({ ok: false, reason: "unknown_recorder" });
  });

  it("keeps only the two observed-condition fields it understands", async () => {
    const { db, shop, owner, trip } = await logFixture();

    const saved = await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      observedConditions: { visibility: "20m", current: "mild", surprise: "dropped" },
      recordedByPersonId: owner.id,
    });

    expect(saved).toMatchObject({
      ok: true,
      dive: { observedConditions: { visibility: "20m", current: "mild" } },
    });
  });
});

describe("deleteExecutedDive", () => {
  it("takes a dive off the log and frees its number for a fresh entry", async () => {
    const { db, shop, owner, trip } = await logFixture();
    const saved = await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      maxDepthMeters: 18,
      recordedByPersonId: owner.id,
    });
    if (!saved.ok) throw new Error("fixture write failed");

    expect(
      await deleteExecutedDive(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveNumber: 1,
        deletedByPersonId: owner.id,
      }),
    ).toBe(true);
    expect(await listExecutedDives(db, shop.id, trip.id)).toHaveLength(0);

    // The unique index covers live rows only, so the number is available again.
    const again = await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      maxDepthMeters: 21,
      recordedByPersonId: owner.id,
    });
    expect(again).toMatchObject({ ok: true, dive: { maxDepthMeters: 21 } });
  });
});

/**
 * **One species the crew saw, from the site's own field guide** (issue #1190,
 * delight report D30).
 *
 * The boundary is the feature: `dive_site_creatures` is what a reef *may* show
 * you, a standing claim the shop makes about a place; this column is somebody
 * saying they saw it, once, on one dive. Drawing from the same catalog is what
 * makes the words arrive in the diver's own language; keeping them in different
 * columns is what stops the first ever rendering as the second.
 *
 * The site constraint is enforced here rather than only in the `<select>`,
 * because a constraint that lives in a form is a suggestion.
 */
describe("upsertExecutedDive — the observed species", () => {
  it("records any species DiveDay carries, not only the ones the site is known for", async () => {
    // The correction a dive-domain review made on 2026-09-04. Bounding this to
    // the site's field guide had it backwards: a guide is at most eight faces a
    // shop names because that reef shows them *reliably*, so it holds the blue
    // tang and not the eagle ray — and the eagle ray is the whole reason
    // anybody writes a sighting down.
    const { db, shop, owner, trip } = await logFixture();
    const [site] = await db
      .select({ id: diveSites.id })
      .from(diveSites)
      .where(eq(diveSites.shopId, shop.id))
      .limit(1);
    if (!site) throw new Error("seeded shop has no dive site");

    const listed = await db
      .select({ slug: diveSiteCreatures.catalogSlug })
      .from(diveSiteCreatures)
      .where(and(eq(diveSiteCreatures.shopId, shop.id), eq(diveSiteCreatures.diveSiteId, site.id)));
    const guide = new Set(listed.map((row) => row.slug));
    const offGuide = MARINE_LIFE_CATALOG.map((species) => species.slug).find(
      (slug) => !guide.has(slug),
    );
    if (!offGuide) throw new Error("this site’s guide is the whole catalog");

    const saved = await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      actualSiteId: site.id,
      observedSpeciesSlug: offGuide,
      recordedByPersonId: owner.id,
    });
    expect(saved).toMatchObject({ ok: true, dive: { observedSpeciesSlug: offGuide } });
  });

  it("records a sighting on a dive that names no site", async () => {
    // Crews log dives with no site constantly — a shore checkout, a spot not in
    // the library yet, a drift that ended somewhere nobody named. Some of those
    // are the days with the manta in them, and a sighting is a fact about a
    // dive rather than about a row in the site library.
    const { db, shop, owner, trip } = await logFixture();
    const [species] = MARINE_LIFE_CATALOG;
    if (!species) throw new Error("the catalog is empty");
    const saved = await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      actualSiteId: null,
      observedSpeciesSlug: species.slug,
      recordedByPersonId: owner.id,
    });
    expect(saved).toMatchObject({ ok: true, dive: { observedSpeciesSlug: species.slug } });
  });

  it("drops a slug the catalog does not carry without losing the dive record", async () => {
    // **The ornament degrades; the safety record saves.** Entry, exit and depth
    // are what `buildIncidentExport` seals for an investigator or a treating
    // physician, and a decorative field must never be able to open a hole in
    // that document — which an early return did, on a form filled in at the
    // rail (dive-domain review, 2026-09-04).
    const { db, shop, owner, trip } = await logFixture();
    const saved = await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      maxDepthMeters: 18,
      observedSpeciesSlug: "mermaid",
      recordedByPersonId: owner.id,
    });
    expect(saved).toMatchObject({
      ok: true,
      dive: { maxDepthMeters: 18, observedSpeciesSlug: null },
    });
  });

  it("leaves the column null when nothing stood out", async () => {
    // The ordinary dive. Deliberately *not* an entry in `not_recorded`: a depth
    // nobody wrote down is a hole in a record that should have one, and a dive
    // where nothing stood out is just a dive. There is nothing to declare.
    const { db, shop, owner, trip } = await logFixture();
    const saved = await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      recordedByPersonId: owner.id,
    });
    expect(saved).toMatchObject({ ok: true, dive: { observedSpeciesSlug: null, notRecorded: [] } });
  });

  it("clears a recorded sighting when the crew takes it back", async () => {
    const { db, shop, owner, trip } = await logFixture();
    const [species] = MARINE_LIFE_CATALOG;
    if (!species) throw new Error("the catalog is empty");
    await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      observedSpeciesSlug: species.slug,
      recordedByPersonId: owner.id,
    });
    const cleared = await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      observedSpeciesSlug: null,
      recordedByPersonId: owner.id,
    });
    expect(cleared).toMatchObject({ ok: true, dive: { observedSpeciesSlug: null } });
  });
});

/**
 * The plan-change door (issue #1184, delight report D24). Its boundary is that
 * the record says what *happened* and never rewrites what was *planned*, so one
 * case here asserts `trip_dives` outright rather than trusting that two tables
 * cannot touch.
 */
describe("upsertExecutedDive — the plan change", () => {
  it("records why the plan changed and reads it back", async () => {
    const { db, shop, owner, trip } = await logFixture();
    const saved = await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      planChangeReason: "current",
      planChangeNote: "Ran the drift the other way.",
      recordedByPersonId: owner.id,
    });
    expect(saved).toMatchObject({
      ok: true,
      dive: { planChangeReason: "current", planChangeNote: "Ran the drift the other way." },
    });

    const listed = await listExecutedDives(db, shop.id, trip.id);
    expect(listed[0]?.executed.planChangeReason).toBe("current");
  });

  it("takes a reason with no note — a crew that said nothing more still said why", async () => {
    const { db, shop, owner, trip } = await logFixture();
    expect(
      await upsertExecutedDive(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveNumber: 1,
        planChangeReason: "weather",
        recordedByPersonId: owner.id,
      }),
    ).toMatchObject({ ok: true, dive: { planChangeReason: "weather", planChangeNote: null } });
  });

  it("refuses a note with no reason above it", async () => {
    // The boundary #1187 draws: a free-text box with no code above it is the
    // second staff chat, not a record. Refused rather than dropped, because
    // silently discarding what a divemaster typed is issue #1018's own defect.
    const { db, shop, owner, trip } = await logFixture();
    expect(
      await upsertExecutedDive(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveNumber: 1,
        planChangeNote: "The mooring was taken.",
        recordedByPersonId: owner.id,
      }),
    ).toEqual({ ok: false, reason: "plan_change_note_without_reason" });
  });

  it("refuses a note past the bound rather than truncating it", async () => {
    const { db, shop, owner, trip } = await logFixture();
    expect(
      await upsertExecutedDive(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveNumber: 1,
        planChangeReason: "visibility",
        planChangeNote: "x".repeat(281),
        recordedByPersonId: owner.id,
      }),
    ).toEqual({ ok: false, reason: "plan_change_note_too_long" });
  });

  it("lets the note go when the reason does", async () => {
    const { db, shop, owner, trip } = await logFixture();
    await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      planChangeReason: "crew_call",
      planChangeNote: "The skipper called it for the light on the shallow side.",
      recordedByPersonId: owner.id,
    });
    const cleared = await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      planChangeReason: null,
      recordedByPersonId: owner.id,
    });
    expect(cleared).toMatchObject({
      ok: true,
      dive: { planChangeReason: null, planChangeNote: null },
    });
  });

  it("leaves the published plan byte-identical", async () => {
    const { db, shop, owner, trip } = await logFixture();
    const before = await db
      .select()
      .from(tripDives)
      .where(eq(tripDives.tripId, trip.id))
      .orderBy(tripDives.diveNumber);
    await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      actualSiteId: null,
      planChangeReason: "current",
      planChangeNote: "Went to the lee side instead.",
      recordedByPersonId: owner.id,
    });
    const after = await db
      .select()
      .from(tripDives)
      .where(eq(tripDives.tripId, trip.id))
      .orderBy(tripDives.diveNumber);
    expect(after).toEqual(before);
  });

  it("writes one desk event for the crew who were not on the dive", async () => {
    const { db, shop, owner, trip } = await logFixture();
    await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      planChangeReason: "weather",
      recordedByPersonId: owner.id,
    });
    const events = await db
      .select({ kind: tripDeskEvents.kind })
      .from(tripDeskEvents)
      .where(and(eq(tripDeskEvents.shopId, shop.id), eq(tripDeskEvents.tripId, trip.id)));
    expect(events).toEqual([{ kind: "plan_changed" }]);
  });

  it("writes no desk event for a dive that went to plan", async () => {
    const { db, shop, owner, trip } = await logFixture();
    await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      maxDepthMeters: 18,
      recordedByPersonId: owner.id,
    });
    const events = await db
      .select({ kind: tripDeskEvents.kind })
      .from(tripDeskEvents)
      .where(and(eq(tripDeskEvents.shopId, shop.id), eq(tripDeskEvents.tripId, trip.id)));
    expect(events).toEqual([]);
  });
});

/**
 * `peopleWhoDivedBefore` answers the "multiple days of diving" half of DAN's
 * 18-hour preflight clause for a whole boat at once (issue #1439). Every case
 * below is a row it must *not* count — the false positives are the ones that
 * matter, because each hands a diver a longer wait for a day they did not
 * spend in the water.
 */
describe("peopleWhoDivedBefore", () => {
  /**
   * Two departures a day apart, one diver aboard both, with a dive recorded on
   * the earlier one. `after` is the one being asked about.
   */
  async function twoDays(gapHours = 20, options: { logDive?: boolean } = {}) {
    const { db, shop } = await seededShopContext();
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    if (!owner) throw new Error("fixture needs the seeded owner");
    const base = new Date("2026-07-25T13:00:00.000Z");
    const departure = async (title: string, startsAt: Date) => {
      const trip = await createTrip(db, {
        shopId: shop.id,
        title,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
        capacity: 6,
        plannedDives: 1,
      });
      if (!trip) throw new Error(`createTrip refused ${title}`);
      return trip;
    };
    const before = await departure("Yesterday", new Date(base.getTime() - gapHours * HOUR_MS));
    const after = await departure("Today", base);
    const seat = async (tripId: string) => {
      const party = await createBookingParty(db, [
        {
          actor: "staff",
          shopId: shop.id,
          tripId,
          fullName: "Nadia Twoday",
          email: "nadia-twoday@example.com",
        },
      ]);
      if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
      return party.bookings[0];
    };
    const earlierBooking = await seat(before.id);
    const laterBooking = await seat(after.id);
    // Same person on both departures — `createBookingParty` matches on email.
    expect(earlierBooking.personId).toBe(laterBooking.personId);
    if (options.logDive !== false) {
      const recorded = await upsertExecutedDive(db, {
        shopId: shop.id,
        tripId: before.id,
        diveNumber: 1,
        exitedAt: new Date(before.startsAt.getTime() + 2 * HOUR_MS),
        recordedByPersonId: owner.id,
      });
      expect(recorded.ok).toBe(true);
    }
    const ask = () =>
      peopleWhoDivedBefore(db, shop.id, [laterBooking.personId], after.startsAt, shop.timezone);
    return { db, shop, owner, before, after, personId: laterBooking.personId, earlierBooking, ask };
  }

  /** A second tenant, for the scoping probes. */
  async function otherShop(db: AppDb) {
    const rows = await db
      .insert(shops)
      .values({ name: "Other Reef", slug: "other-reef-flysafe", timezone: "America/New_York" })
      .returning();
    if (!rows[0]) throw new Error("other shop insert failed");
    return rows;
  }

  it("counts a dive on an earlier departure inside the window", async () => {
    const { personId, ask } = await twoDays();
    expect([...(await ask())]).toEqual([personId]);
  });

  it("counts local days, so schedule drift around 24 hours cannot decide the answer", async () => {
    // The reason this counts days rather than hours. Consecutive departures at
    // the same clock time are *exactly* 24 hours apart, and a boat that leaves
    // fifteen minutes early for the tide is 24h15m — so an hours window let the
    // tide decide the answer. All three of these are the day before.
    for (const gap of [23, 24, 25]) {
      expect((await (await twoDays(gap)).ask()).size, `${gap}h`).toBe(1);
    }
  });

  it("reaches back the whole window and stops", async () => {
    // Two local days: the day before and the one before that are dive days,
    // three days back is a holiday rather than a surface interval. 70 hours
    // rather than a round 96 on purpose — it sits *inside* the query's own
    // coarse bound, so it is the calendar comparison that has to refuse it.
    expect((await (await twoDays(24)).ask()).size, "1 day").toBe(1);
    expect((await (await twoDays(48)).ask()).size, "2 days").toBe(1);
    expect((await (await twoDays(70)).ask()).size, "3 days").toBe(0);
  });

  it("counts the morning boat for the afternoon one", async () => {
    // `flySafeFrom` sees only its own departure's dives, so without this a
    // diver who took one tank at 9 and another at 3 reads the single-dive wait
    // for the afternoon boat. One calendar day, and still two dives.
    expect((await (await twoDays(6)).ask()).size).toBe(1);
  });

  it("counts a departure the crew never logged a dive on", async () => {
    // Crews do not reliably log; `flySafeFrom` answers from `planned_dives`
    // for exactly that reason. Requiring a dive row here would let today's
    // boat speak from the plan while yesterday's fell silent, and that fails
    // toward the shorter advice.
    expect((await (await twoDays(24, { logDive: false })).ask()).size).toBe(1);
  });

  it("counts neither this departure's own dives nor a later one's", async () => {
    // Today's tanks are the caller's to count; double-counting them here would
    // make every second dive of a day look like a second day. And a dive the
    // crew has already logged on the *afternoon* boat is not a reason to tell
    // the morning boat's divers they have been at this for days.
    const { db, shop, owner, after, personId } = await twoDays(96);
    const evening = await createTrip(db, {
      shopId: shop.id,
      title: "This evening",
      startsAt: new Date(after.startsAt.getTime() + 6 * HOUR_MS),
      endsAt: new Date(after.startsAt.getTime() + 10 * HOUR_MS),
      capacity: 6,
      plannedDives: 1,
    });
    if (!evening) throw new Error("createTrip refused the evening departure");
    const party = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: evening.id,
        fullName: "Nadia Twoday",
        email: "nadia-twoday@example.com",
      },
    ]);
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
    for (const tripId of [after.id, evening.id]) {
      const recorded = await upsertExecutedDive(db, {
        shopId: shop.id,
        tripId,
        diveNumber: 1,
        exitedAt: new Date(after.startsAt.getTime() + 2 * HOUR_MS),
        recordedByPersonId: owner.id,
      });
      expect(recorded.ok).toBe(true);
    }
    const found = await peopleWhoDivedBefore(
      db,
      shop.id,
      [personId],
      after.startsAt,
      shop.timezone,
    );
    expect(found.size).toBe(0);
  });

  it("does not count a diver who cancelled or never showed", async () => {
    // The plain shape, with nothing on the arrival trail — the leg that proves
    // #1558's escape hatch below did not simply delete the exclusion.
    for (const status of ["cancelled", "no_show"] as const) {
      const { db, shop, after, personId, earlierBooking } = await twoDays();
      await db.update(bookings).set({ status }).where(eq(bookings.id, earlierBooking.bookingId));
      const found = await peopleWhoDivedBefore(
        db,
        shop.id,
        [personId],
        after.startsAt,
        shop.timezone,
      );
      expect(found.size, `a ${status} booking is not a dive day`).toBe(0);
    }
  });

  /**
   * **The desk outranks a status column somebody stamped afterwards** (issue
   * #1558). Every case here goes through `checkInBooking` / `undoCheckInBooking`
   * rather than inserting `booking_arrival_events` rows by hand, so what is
   * pinned is the whole path: the counter really does leave the trail this read
   * depends on, and a sweep really cannot erase it.
   *
   * Nothing in the product writes `no_show` yet (`src/db/recap.ts` says so in as
   * many words), so the sweep is set by hand here and this is hardening for a
   * writer that does not exist rather than a live bug. The status has to be set
   * *after* the check-in either way — `checkInBooking` refuses anything but a
   * `booked` seat.
   */
  async function checkInAtTheDesk(
    ctx: Awaited<ReturnType<typeof twoDays>>,
    bookingId: string,
  ): Promise<void> {
    // Everything the seeded shop demands of a diver before the desk may tap
    // them in: a card on file, and a signed release with a clear questionnaire.
    await ctx.db.insert(certifications).values({
      shopId: ctx.shop.id,
      personId: ctx.personId,
      agency: "padi",
      level: "instructor",
      identifier: "C-TWODAY",
      status: "verified",
    });
    const issued = await issueWaiverRequest(ctx.db, { shopId: ctx.shop.id, bookingId });
    if (!issued.ok) throw new Error(`waiver request refused: ${issued.reason}`);
    const signed = await completeWaiver(ctx.db, issued.token, {
      signerName: "Nadia Twoday",
      agreed: true,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
    });
    if (!signed.ok) throw new Error(`waiver refused: ${signed.reason}`);
    const outcome = await checkInBooking(ctx.db, {
      shopId: ctx.shop.id,
      bookingId,
      recordedByPersonId: ctx.owner.id,
    });
    if (!outcome.ok) {
      // The blockers, not just "not_ready": a fixture that stops being ready
      // because readiness grew a rule is otherwise a silent afternoon.
      const blockers = "blockers" in outcome ? JSON.stringify(outcome.blockers) : "";
      throw new Error(`check-in refused: ${outcome.reason} ${blockers}`);
    }
  }

  it("counts a dive day a later no_show tried to erase", async () => {
    const ctx = await twoDays();
    await checkInAtTheDesk(ctx, ctx.earlierBooking.bookingId);
    await ctx.db
      .update(bookings)
      .set({ status: "no_show" })
      .where(eq(bookings.id, ctx.earlierBooking.bookingId));
    expect([...(await ctx.ask())]).toEqual([ctx.personId]);
  });

  it("still refuses a no_show whose check-in was undone", async () => {
    // An undo is the shop taking the sighting back, and it is allowed to: the
    // standing event is `cleared`, so nothing says this diver was in the
    // building and the exclusion holds.
    const ctx = await twoDays();
    await checkInAtTheDesk(ctx, ctx.earlierBooking.bookingId);
    const undone = await undoCheckInBooking(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: ctx.earlierBooking.bookingId,
      recordedByPersonId: ctx.owner.id,
    });
    expect(undone.ok, "the undo has to land for this case to mean anything").toBe(true);
    await ctx.db
      .update(bookings)
      .set({ status: "no_show" })
      .where(eq(bookings.id, ctx.earlierBooking.bookingId));
    expect((await ctx.ask()).size).toBe(0);
  });

  it("leaves cancelled alone even with a standing arrival", async () => {
    // A cancellation is a re-papering of the sale, not a statement about the
    // dock — it lands days later, on a seat somebody really did check in — so
    // it gets none of the escape `no_show` gets.
    const ctx = await twoDays();
    await checkInAtTheDesk(ctx, ctx.earlierBooking.bookingId);
    await ctx.db
      .update(bookings)
      .set({ status: "cancelled" })
      .where(eq(bookings.id, ctx.earlierBooking.bookingId));
    expect((await ctx.ask()).size).toBe(0);
  });

  it("does not count a blown-out departure nobody dived, or a deleted one", async () => {
    for (const strike of ["cancelled", "deleted"] as const) {
      const { db, shop, before, after, personId } = await twoDays(24, { logDive: false });
      await db
        .update(trips)
        .set(
          strike === "cancelled"
            ? { status: "cancelled" }
            : { deletedAt: new Date("2026-07-25T09:00:00.000Z") },
        )
        .where(eq(trips.id, before.id));
      const found = await peopleWhoDivedBefore(
        db,
        shop.id,
        [personId],
        after.startsAt,
        shop.timezone,
      );
      expect(found.size, `a ${strike} departure is not a dive day`).toBe(0);
    }
  });

  it("believes a logged dive over a status changed after the boat ran", async () => {
    // A live `executed_dives` row is affirmative evidence people went in the
    // water; `trips.status` is a column somebody edits afterwards, for a
    // refund or a re-papered charter. Deleting the departure is different —
    // that is staff saying the row should not exist — so it still counts for
    // nobody.
    const { db, shop, before, after, personId } = await twoDays(24);
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, before.id));
    const found = await peopleWhoDivedBefore(
      db,
      shop.id,
      [personId],
      after.startsAt,
      shop.timezone,
    );
    expect(found.size).toBe(1);
  });

  it("still counts a day whose one dive record was struck, but stops vouching for it", async () => {
    // Striking a dive row says that *record* was wrong, not that the boat
    // stayed tied up — so the day still counts, on the booking. What the row no
    // longer does is speak for a departure the shop has since marked something
    // other than `scheduled`; with both gone, nothing is left saying it ran.
    const { db, shop, owner, before, after, personId } = await twoDays();
    const [dive] = await listExecutedDives(db, shop.id, before.id);
    if (!dive) throw new Error("fixture dive missing");
    await deleteExecutedDive(db, {
      shopId: shop.id,
      tripId: before.id,
      diveNumber: dive.executed.diveNumber,
      deletedByPersonId: owner.id,
    });
    const ask = () => peopleWhoDivedBefore(db, shop.id, [personId], after.startsAt, shop.timezone);
    expect((await ask()).size, "the departure still ran").toBe(1);
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, before.id));
    expect((await ask()).size, "and now nothing says it did").toBe(0);
  });

  it("is scoped on both tables of its join, not only the one it reads from", async () => {
    // The join reaches `bookings -> trips`, so a scope on the first alone would
    // leave a path into another tenant's rows. Re-pointing each table's
    // `shop_id` in turn is the only probe that shows both predicates carry
    // weight — a synthetic shop id fails on the first and proves nothing about
    // the second.
    const reassign = {
      trips: (db: AppDb, tripId: string, shopId: string) =>
        db.update(trips).set({ shopId }).where(eq(trips.id, tripId)),
      bookings: (db: AppDb, tripId: string, shopId: string) =>
        db.update(bookings).set({ shopId }).where(eq(bookings.tripId, tripId)),
    };
    for (const [table, moveToOtherShop] of Object.entries(reassign)) {
      const { db, shop, before, after, personId } = await twoDays();
      const [other] = await otherShop(db);
      await moveToOtherShop(db, before.id, other.id);
      const found = await peopleWhoDivedBefore(
        db,
        shop.id,
        [personId],
        after.startsAt,
        shop.timezone,
      );
      expect(found.size, `${table}.shop_id is not scoped`).toBe(0);
    }
  });

  it("does not let another shop's dive record vouch for a blown-out departure", async () => {
    // The `executed_dives` leftJoin is the one escape from the status filter,
    // so it carries the shop scope too: a dive row belonging to another tenant
    // must not be what says this departure ran.
    const { db, shop, before, after, personId } = await twoDays();
    const [other] = await otherShop(db);
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, before.id));
    await db
      .update(executedDives)
      .set({ shopId: other.id })
      .where(eq(executedDives.tripId, before.id));
    const found = await peopleWhoDivedBefore(
      db,
      shop.id,
      [personId],
      after.startsAt,
      shop.timezone,
    );
    expect(found.size).toBe(0);
  });

  it("answers an empty roster with an empty set", async () => {
    const { db, shop, after } = await twoDays();
    expect(await peopleWhoDivedBefore(db, shop.id, [], after.startsAt, shop.timezone)).toEqual(
      new Set(),
    );
  });
});
