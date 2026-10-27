import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { prepareContactImport } from "@/test/import-fixture";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { anonymizeDiver } from "./anonymize";
import {
  formBuddyTeam,
  formPartyTeams,
  listTripBuddyTeams,
  partyConfirmKey,
  planPartyTeams,
} from "./buddy-pairs";
import { commitContactImport } from "./import";
import { createCertification, restoreCertification } from "./readiness";
import {
  bookings,
  certifications,
  people,
  personRoles,
  shops,
  trips,
  userAccounts,
} from "./schema";

describePostgres("one-tap party decisions against junior evidence changes", () => {
  async function fixture() {
    const pg = await postgresTestDb();
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: "Race shop", slug: "race-shop", timezone: "UTC" })
      .returning();
    if (!shop) throw new Error("shop missing");
    const [staff] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Staff" })
      .returning();
    if (!staff) throw new Error("staff missing");
    await pg.db.insert(personRoles).values({ personId: staff.id, role: "owner" });
    await pg.db
      .insert(userAccounts)
      .values({ personId: staff.id, email: "owner@example.com", hashedPassword: "unused" });
    const [trip] = await pg.db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Race trip",
        startsAt: new Date("2031-05-12T13:00:00Z"),
        endsAt: new Date("2031-05-12T17:00:00Z"),
        capacity: 6,
      })
      .returning();
    if (!trip) throw new Error("trip missing");
    const [first, second] = await pg.db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "One", email: "one@example.com", dateOfBirth: "1990-01-01" },
        { shopId: shop.id, fullName: "Two", dateOfBirth: "1991-01-01" },
      ])
      .returning();
    if (!first || !second) throw new Error("divers missing");
    const [card] = await pg.db
      .insert(certifications)
      .values({
        shopId: shop.id,
        personId: first.id,
        agency: "naui",
        level: "open_water",
        identifier: "ONE",
        status: "verified",
        juniorStatus: "full",
        juniorStatusVerifiedAt: nowDate(),
        juniorStatusVerifiedByPersonId: staff.id,
      })
      .returning();
    if (!card) throw new Error("card missing");
    await pg.db.insert(certifications).values({
      shopId: shop.id,
      personId: second.id,
      agency: "padi",
      level: "open_water",
      identifier: "TWO",
      status: "verified",
    });
    const [lead] = await pg.db
      .insert(bookings)
      .values({
        shopId: shop.id,
        tripId: trip.id,
        personId: first.id,
        status: "booked",
        bookedAs: "diver",
        participantType: "diver",
      })
      .returning();
    if (!lead) throw new Error("booking missing");
    await pg.db.insert(bookings).values({
      shopId: shop.id,
      tripId: trip.id,
      personId: second.id,
      status: "booked",
      bookedAs: "diver",
      participantType: "diver",
      partyLeadBookingId: lead.id,
    });
    return { pg, shop, trip, first, staff, card };
  }

  it("teams the fixture's verified adult party before any correction", async () => {
    const { pg, shop, trip, staff } = await fixture();
    expect(
      await formPartyTeams(pg.connect(), {
        shopId: shop.id,
        tripId: trip.id,
        recordedByPersonId: staff.id,
      }),
    ).toBe(1);
    expect(await listTripBuddyTeams(pg.db, shop.id, trip.id)).toHaveLength(1);
  });

  it("cannot use a stale adult confirmation to team an erased person", async () => {
    const { pg, shop, trip, first, staff } = await fixture();
    const seats = await pg.db
      .select({ id: bookings.id, personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.tripId, trip.id));
    for (const seat of seats) {
      if (seat.personId)
        await pg.db.update(people).set({ dateOfBirth: null }).where(eq(people.id, seat.personId));
    }
    const [party] = (await planPartyTeams(pg.db, shop.id, trip.id)).ageUnconfirmed;
    if (!party) throw new Error("expected an unconfirmed party");
    expect(
      (
        await anonymizeDiver(pg.connect(), {
          shopId: shop.id,
          personId: first.id,
          actorPersonId: staff.id,
        })
      ).ok,
    ).toBe(true);
    expect(
      await formPartyTeams(pg.connect(), {
        shopId: shop.id,
        tripId: trip.id,
        recordedByPersonId: staff.id,
        confirmedAdultParties: [partyConfirmKey(party)],
      }),
    ).toBe(0);
    expect(await listTripBuddyTeams(pg.db, shop.id, trip.id)).toHaveLength(0);
  });

  it("refuses a manual team naming an erased person", async () => {
    const { pg, shop, trip, first, staff } = await fixture();
    const seats = await pg.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.tripId, trip.id));
    expect(
      (
        await anonymizeDiver(pg.connect(), {
          shopId: shop.id,
          personId: first.id,
          actorPersonId: staff.id,
        })
      ).ok,
    ).toBe(true);
    expect(
      await formBuddyTeam(pg.connect(), {
        shopId: shop.id,
        tripId: trip.id,
        recordedByPersonId: staff.id,
        members: seats.map((seat) => ({ kind: "diver" as const, bookingId: seat.id })),
      }),
    ).toEqual({ ok: false, reason: "booking_unavailable" });
    expect(await listTripBuddyTeams(pg.db, shop.id, trip.id)).toHaveLength(0);
  });

  it("backs out if the shop policy is locked, then teams after it is released", async () => {
    const { pg, shop, trip, staff } = await fixture();
    const gate = await holdRowLock(
      pg,
      sql`select id from shops where id = ${shop.id} for no key update`,
    );
    const input = { shopId: shop.id, tripId: trip.id, recordedByPersonId: staff.id };
    try {
      expect(await formPartyTeams(pg.connect(), input)).toBe("busy");
      expect(await listTripBuddyTeams(pg.db, shop.id, trip.id)).toHaveLength(0);
    } finally {
      await gate.release();
    }
    expect(await formPartyTeams(pg.connect(), input)).toBe(1);
  });

  for (const change of ["date of birth", "card status", "new card", "restored card"] as const) {
    it(`refuses an in-flight ${change} correction and then plans from the committed facts`, async () => {
      const { pg, shop, trip, first, staff, card } = await fixture();
      const [deleted] =
        change === "restored card"
          ? await pg.db
              .insert(certifications)
              .values({
                shopId: shop.id,
                personId: first.id,
                agency: "sdi",
                level: "open_water",
                identifier: "RESTORED",
                status: "verified",
                deletedAt: nowDate(),
              })
              .returning()
          : [];
      let release!: () => void;
      let ready!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const locked = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const writer = pg.connect().transaction(async (tx) => {
        if (change === "date of birth") {
          await tx.update(people).set({ dateOfBirth: "2018-01-01" }).where(eq(people.id, first.id));
        } else if (change === "card status") {
          await tx
            .select({ id: people.id })
            .from(people)
            .where(eq(people.id, first.id))
            .for("no key update");
          await tx
            .update(certifications)
            .set({ juniorStatus: "junior" })
            .where(eq(certifications.id, card.id));
        } else if (change === "new card") {
          await tx
            .select({ id: people.id })
            .from(people)
            .where(eq(people.id, first.id))
            .for("no key update");
          await tx.insert(certifications).values({
            shopId: shop.id,
            personId: first.id,
            agency: "sdi",
            level: "open_water",
            identifier: "NEW",
            status: "verified",
          });
        } else {
          if (!deleted) throw new Error("deleted card missing");
          await tx
            .update(certifications)
            .set({ deletedAt: null })
            .where(eq(certifications.id, deleted.id));
        }
        ready();
        await held;
      });
      await locked;
      const forming = formPartyTeams(pg.connect(), {
        shopId: shop.id,
        tripId: trip.id,
        recordedByPersonId: staff.id,
      });
      try {
        expect(await forming).toBe("busy");
        expect(await listTripBuddyTeams(pg.db, shop.id, trip.id)).toHaveLength(0);
      } finally {
        release();
        await writer;
      }
      expect(
        await formPartyTeams(pg.connect(), {
          shopId: shop.id,
          tripId: trip.id,
          recordedByPersonId: staff.id,
        }),
      ).toBe(0);
      expect(await listTripBuddyTeams(pg.db, shop.id, trip.id)).toHaveLength(0);
    });
  }

  it("makes actual card insertion and restoration writers participate in the person lock", async () => {
    const { pg, shop, first } = await fixture();
    const [deleted] = await pg.db
      .insert(certifications)
      .values({
        shopId: shop.id,
        personId: first.id,
        agency: "sdi",
        level: "open_water",
        identifier: "RESTORE",
        status: "verified",
        deletedAt: nowDate(),
      })
      .returning();
    if (!deleted) throw new Error("deleted card missing");
    const gate = await holdRowLock(
      pg,
      sql`select id from people where id = ${first.id} for no key update`,
    );
    const insert = createCertification(pg.connect(), {
      shopId: shop.id,
      personId: first.id,
      agency: "sdi",
      level: "open_water",
      identifier: "INSERT",
    });
    const restore = restoreCertification(pg.connect(), {
      shopId: shop.id,
      certificationId: deleted.id,
    });
    try {
      await waitForLockWaiters(pg.db, 2);
    } finally {
      await gate.release();
    }
    expect(await insert).not.toBeNull();
    expect(await restore).toBe(true);
  });

  it("makes a contact import wait on the same person lock before adding a card", async () => {
    const { pg, shop, first, staff } = await fixture();
    const gate = await holdRowLock(
      pg,
      sql`select id from people where id = ${first.id} for no key update`,
    );
    const prepared = prepareContactImport(
      "full_name,email,certification_agency,certification_level,certification_number\nOne,one@example.com,SDI,Open Water,IMPORTED",
    );
    const importing = commitContactImport(pg.connect(), shop.id, prepared, staff.id);
    try {
      await waitForLockWaiters(pg.db, 1);
    } finally {
      await gate.release();
    }
    expect((await importing).cardsAdded).toBe(1);
  });

  it("does not restore an erased person's identity when an import waited on erasure", async () => {
    const { pg, shop, first, staff, card } = await fixture();
    const gate = await holdRowLock(
      pg,
      sql`select id from certifications where id = ${card.id} for update`,
    );
    const erasing = anonymizeDiver(pg.connect(), {
      shopId: shop.id,
      personId: first.id,
      actorPersonId: staff.id,
    });
    const prepared = prepareContactImport(
      "full_name,email,certification_agency,certification_level,certification_number\nOne,one@example.com,SDI,Open Water,NEW-CARD",
    );
    let importing: Promise<Awaited<ReturnType<typeof commitContactImport>>> | undefined;
    try {
      await waitForLockWaiters(pg.db, 1);
      importing = commitContactImport(pg.connect(), shop.id, prepared, staff.id);
      await waitForLockWaiters(pg.db, 2);
    } finally {
      await gate.release();
    }
    expect((await erasing).ok).toBe(true);
    expect((await importing)?.cardsAdded).toBe(0);
    const [person] = await pg.db.select().from(people).where(eq(people.id, first.id));
    expect(person?.anonymizedAt).not.toBeNull();
    expect(person?.email).toBeNull();
    expect(person?.fullName).not.toBe("One");
  });
});

describePostgres("one-tap planning against erasure", () => {
  it("does not deadlock erasing the sole diver of a private departure named for them", async () => {
    const pg = await postgresTestDb();
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: "Erasure shop", slug: "erasure-race", timezone: "UTC" })
      .returning();
    if (!shop) throw new Error("shop missing");
    const [staff, diver] = await pg.db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Owner" },
        { shopId: shop.id, fullName: "Maya Stone", dateOfBirth: "1990-01-01" },
      ])
      .returning();
    if (!staff || !diver) throw new Error("people missing");
    await pg.db.insert(personRoles).values({ personId: staff.id, role: "owner" });
    await pg.db
      .insert(userAccounts)
      .values({ personId: staff.id, email: "owner@example.com", hashedPassword: "unused" });
    const [trip] = await pg.db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Maya Stone charter",
        isPrivate: true,
        startsAt: new Date("2031-05-12T13:00:00Z"),
        endsAt: new Date("2031-05-12T17:00:00Z"),
        capacity: 6,
      })
      .returning();
    if (!trip) throw new Error("trip missing");
    await pg.db.insert(bookings).values({
      shopId: shop.id,
      tripId: trip.id,
      personId: diver.id,
      status: "booked",
      bookedAs: "diver",
      participantType: "diver",
    });
    const [card] = await pg.db
      .insert(certifications)
      .values({
        shopId: shop.id,
        personId: diver.id,
        agency: "padi",
        level: "open_water",
        identifier: "CARD",
        status: "verified",
      })
      .returning();
    if (!card) throw new Error("card missing");
    const gate = await holdRowLock(
      pg,
      sql`select id from certifications where id = ${card.id} for update`,
    );
    const erasure = anonymizeDiver(pg.connect(), {
      shopId: shop.id,
      personId: diver.id,
      actorPersonId: staff.id,
    });
    const erased = Promise.allSettled([erasure]);
    let teamed: Promise<PromiseSettledResult<number | "busy">[]> | undefined;
    let teamFinished = false;
    try {
      await waitForLockWaiters(pg.db, 1);
      teamed = Promise.allSettled([
        formPartyTeams(pg.connect(), {
          shopId: shop.id,
          tripId: trip.id,
          recordedByPersonId: staff.id,
        }),
      ]);
      void teamed.then(() => {
        teamFinished = true;
      });
      // Either the safe attempt backs out, or the old code parks behind the
      // person while holding the trip. Release only after one is established.
      try {
        await waitForLockWaiters(pg.db, 2, 1_000);
      } catch (error) {
        if (!teamFinished) throw error;
      }
    } finally {
      await gate.release();
    }
    const [eraseResult] = await erased;
    const [teamResult] = await (teamed ?? Promise.resolve([]));
    expect(eraseResult).toMatchObject({ status: "fulfilled", value: { ok: true } });
    expect(teamResult?.status).toBe("fulfilled");
    const [saved] = await pg.db.select().from(trips).where(eq(trips.id, trip.id));
    expect(saved?.title).not.toContain("Stone");
    expect(await listTripBuddyTeams(pg.db, shop.id, trip.id)).toHaveLength(0);
  });
});
