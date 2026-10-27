import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { prepareContactImport } from "@/test/import-fixture";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { formPartyTeams, listTripBuddyTeams } from "./buddy-pairs";
import { commitContactImport } from "./import";
import { createCertification, restoreCertification } from "./readiness";
import { bookings, certifications, people, personRoles, shops, trips } from "./schema";

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

  for (const change of ["date of birth", "card status", "new card", "restored card"] as const) {
    it(`waits for an in-flight ${change} correction and plans from the committed facts`, async () => {
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
        await waitForLockWaiters(pg.db, 1, 2000);
      } finally {
        release();
        await writer;
      }
      expect(await forming).toBe(0);
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
});
