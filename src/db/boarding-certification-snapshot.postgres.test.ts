import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { advanceClock } from "@/test/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { anonymizeDiver } from "./anonymize";
import { lockBoardingCertificationEvidence } from "./boarding-certification-snapshot";
import { mergeDiverRecords } from "./diver-merge";
import { recordRollCall } from "./manifests";
import { certifications, people, personRoles, rollCallEvents } from "./schema";
import { seedDemo } from "./seed";
import { getShopBySlug } from "./shops";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";

describePostgres("boarding certification capture and concurrent erasure", () => {
  it("refuses a transaction whose snapshot can predate the evidence lock", async () => {
    const pg = await postgresTestDb();
    await expect(
      pg.connect().transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level repeatable read`);
        await lockBoardingCertificationEvidence(
          tx,
          "11111111-1111-4111-8111-111111111111",
          "boarding",
        );
      }),
    ).rejects.toThrow(/READ COMMITTED/);
  });
  it("allows two boardings together while a person rewrite waits for both", async () => {
    const pg = await postgresTestDb();
    const shopId = "11111111-1111-4111-8111-111111111111";
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const start = (mode: "boarding" | "rewrite", lockShopId = shopId) => {
      let acquired!: () => void;
      const locked = new Promise<void>((resolve) => {
        acquired = resolve;
      });
      const transaction = pg.connect().transaction(async (tx) => {
        await lockBoardingCertificationEvidence(tx, lockShopId, mode);
        acquired();
        await hold;
      });
      return { locked, transaction };
    };
    const first = start("boarding");
    const second = start("boarding");
    try {
      await Promise.race([first.locked, first.transaction]);
      await Promise.race([second.locked, second.transaction]);
      const otherShop = start("rewrite", "22222222-2222-4222-8222-222222222222");
      await Promise.race([otherShop.locked, otherShop.transaction]);
      const rewrite = start("rewrite");
      try {
        await waitForLockWaiters(pg.db, 1);
      } finally {
        release();
        await Promise.all([
          first.transaction,
          second.transaction,
          otherShop.transaction,
          rewrite.transaction,
        ]);
      }
    } finally {
      release();
      await Promise.allSettled([first.transaction, second.transaction]);
    }
  });
  it("keeps cards and reviewer from one statement snapshot across a concurrent change", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db);
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const reef = (await upcomingTripsWithCounts(pg.db, shop.id, new Date(0))).find((trip) =>
      trip.title.startsWith("Two-Tank Reef — Molasses"),
    );
    if (!reef) throw new Error("trip missing");
    const [seat] = await getTripRoster(pg.db, shop.id, reef.id);
    const [staff] = await listStaff(pg.db, shop.id);
    if (!seat || !staff) throw new Error("seat or staff missing");
    const [reviewer] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Original name" })
      .returning();
    if (!reviewer) throw new Error("reviewer missing");
    const [card] = await pg.db
      .insert(certifications)
      .values({
        shopId: shop.id,
        personId: seat.person.id,
        agency: "padi",
        level: "rescue",
        identifier: "STATEMENT-CARD",
        status: "verified",
        reviewedAt: nowDate(),
        reviewedByPersonId: reviewer.id,
      })
      .returning();
    if (!card) throw new Error("card missing");
    const issued = await issueWaiverRequest(pg.db, { shopId: shop.id, bookingId: seat.booking.id });
    if (!issued.ok) throw new Error("waiver missing");
    await completeWaiver(pg.db, issued.token, {
      signerName: seat.person.fullName,
      agreed: true,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
    });
    await pg.db.execute(
      sql`create function gate_certificate_capture() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(73033); return new; end $$`,
    );
    await pg.db.execute(
      sql`create trigger gate_certificate_capture before insert on roll_call_events for each row execute function gate_certificate_capture()`,
    );
    const gate = await holdRowLock(pg, sql`select pg_advisory_xact_lock(73033)`);
    const boarding = recordRollCall(pg.connect(), {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: seat.booking.id,
      recordedByPersonId: staff.person.id,
      status: "boarded",
    });
    try {
      await waitForLockWaiters(pg.db, 1);
      advanceClock(60_000);
      await pg.db
        .update(certifications)
        .set({ status: "pending", reviewedAt: null, reviewedByPersonId: null })
        .where(eq(certifications.id, card.id));
      await pg.db
        .update(people)
        .set({ fullName: "Updated name" })
        .where(eq(people.id, reviewer.id));
    } finally {
      await gate.release();
    }
    const result = await boarding;
    if (!result.ok) throw new Error("boarding refused");
    const [event] = await pg.db
      .select()
      .from(rollCallEvents)
      .where(eq(rollCallEvents.id, result.eventId));
    expect(
      event?.certificationSnapshot?.find((row) => row.identifier === "STATEMENT-CARD"),
    ).toMatchObject({ status: "verified", reviewedByName: "Original name" });
    expect(event?.certificationSnapshotStartedAt?.getTime()).toBeLessThan(
      event?.certificationSnapshotCapturedAt?.getTime() ?? 0,
    );
  });
  it("records a later capture time when a card is reviewed while boarding waits", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db);
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const reef = (await upcomingTripsWithCounts(pg.db, shop.id, new Date(0))).find((trip) =>
      trip.title.startsWith("Two-Tank Reef — Molasses"),
    );
    if (!reef) throw new Error("trip missing");
    const [seat] = await getTripRoster(pg.db, shop.id, reef.id);
    const [staff] = await listStaff(pg.db, shop.id);
    if (!seat || !staff) throw new Error("seat or staff missing");
    const [card] = await pg.db
      .insert(certifications)
      .values({
        shopId: shop.id,
        personId: seat.person.id,
        agency: "padi",
        level: "rescue",
        identifier: "REVIEW-WHILE-WAITING",
        status: "pending",
      })
      .returning();
    if (!card) throw new Error("card missing");
    const issued = await issueWaiverRequest(pg.db, { shopId: shop.id, bookingId: seat.booking.id });
    if (!issued.ok) throw new Error("waiver missing");
    await completeWaiver(pg.db, issued.token, {
      signerName: seat.person.fullName,
      agreed: true,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
    });
    const gate = await holdRowLock(
      pg,
      sql`select id from bookings where id = ${seat.booking.id} for update`,
    );
    const tap = nowDate();
    const boarding = recordRollCall(pg.connect(), {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: seat.booking.id,
      recordedByPersonId: staff.person.id,
      status: "boarded",
    });
    try {
      await waitForLockWaiters(pg.db, 1);
      advanceClock(60_000);
      await pg.db
        .update(certifications)
        .set({ status: "verified", reviewedAt: nowDate(), reviewedByPersonId: staff.person.id })
        .where(eq(certifications.id, card.id));
    } finally {
      await gate.release();
    }
    const result = await boarding;
    if (!result.ok) throw new Error("boarding refused");
    const [event] = await pg.db
      .select()
      .from(rollCallEvents)
      .where(eq(rollCallEvents.id, result.eventId));
    expect(event?.occurredAt).toEqual(tap);
    expect(event?.certificationSnapshotCapturedAt?.getTime()).toBeGreaterThan(tap.getTime());
    expect(
      event?.certificationSnapshot?.find((row) => row.identifier === "REVIEW-WHILE-WAITING"),
    ).toMatchObject({ status: "verified" });
  });
  it("erases reviewer names after concurrent merge and boarding", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db);
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const reef = (await upcomingTripsWithCounts(pg.db, shop.id, new Date(0))).find((trip) =>
      trip.title.startsWith("Two-Tank Reef — Molasses"),
    );
    if (!reef) throw new Error("trip missing");
    const [seat] = await getTripRoster(pg.db, shop.id, reef.id);
    const owner = (await listStaff(pg.db, shop.id)).find((row) => row.roles.includes("owner"));
    if (!seat || !owner) throw new Error("seat or owner missing");
    const [source, survivor] = await pg.db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Former reviewer", dateOfBirth: "1980-04-02" },
        { shopId: shop.id, fullName: "Former reviewer", dateOfBirth: "1980-04-02" },
      ])
      .returning();
    if (!source || !survivor) throw new Error("reviewers missing");
    await pg.db.insert(personRoles).values([
      { personId: source.id, role: "diver" },
      { personId: survivor.id, role: "diver" },
    ]);
    await pg.db.insert(certifications).values({
      shopId: shop.id,
      personId: seat.person.id,
      agency: "padi",
      level: "rescue",
      identifier: "MERGED-RACE-CARD",
      status: "verified",
      reviewedAt: nowDate(),
      reviewedByPersonId: source.id,
    });
    const issued = await issueWaiverRequest(pg.db, { shopId: shop.id, bookingId: seat.booking.id });
    if (!issued.ok) throw new Error("waiver missing");
    await completeWaiver(pg.db, issued.token, {
      signerName: seat.person.fullName,
      agreed: true,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
    });
    // Hold the shop evidence lock exclusively so both transactions reach the
    // same gate, regardless of which one the scheduler starts first.
    const gate = await holdRowLock(
      pg,
      sql`select pg_advisory_xact_lock(hashtext('boarding_certification_evidence'), hashtext(${shop.id}))`,
    );
    const merge = mergeDiverRecords({
      db: pg.connect(),
      shopId: shop.id,
      personId: source.id,
      survivorId: survivor.id,
      actorPersonId: owner.person.id,
    });
    const board = recordRollCall(pg.connect(), {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: seat.booking.id,
      recordedByPersonId: owner.person.id,
      status: "boarded",
    });
    try {
      await waitForLockWaiters(pg.db, 2);
    } finally {
      await gate.release();
    }
    const [merged, boarded] = await Promise.all([merge, board]);
    expect(merged).toMatchObject({ ok: true });
    if (!boarded.ok) throw new Error("boarding refused");
    expect(
      await anonymizeDiver(pg.db, {
        shopId: shop.id,
        personId: survivor.id,
        actorPersonId: owner.person.id,
      }),
    ).toMatchObject({ ok: true });
    const [event] = await pg.db
      .select()
      .from(rollCallEvents)
      .where(eq(rollCallEvents.id, boarded.eventId));
    expect(
      event?.certificationSnapshot?.find((card) => card.identifier === "MERGED-RACE-CARD"),
    ).toMatchObject({ reviewedByPersonId: null, reviewedByName: null });
  });
  it("does not retain evidence if self-review boarding races with erasure", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db);
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const reef = (await upcomingTripsWithCounts(pg.db, shop.id, new Date(0))).find((trip) =>
      trip.title.startsWith("Two-Tank Reef — Molasses"),
    );
    if (!reef) throw new Error("trip missing");
    const [seat] = await getTripRoster(pg.db, shop.id, reef.id);
    const owner = (await listStaff(pg.db, shop.id)).find((row) => row.roles.includes("owner"));
    if (!seat || !owner) throw new Error("seat or owner missing");
    await pg.db.insert(certifications).values({
      shopId: shop.id,
      personId: seat.person.id,
      agency: "padi",
      level: "rescue",
      identifier: "SELF-REVIEW-CARD",
      status: "verified",
      reviewedAt: nowDate(),
      reviewedByPersonId: seat.person.id,
    });
    const issued = await issueWaiverRequest(pg.db, { shopId: shop.id, bookingId: seat.booking.id });
    if (!issued.ok) throw new Error("waiver missing");
    await completeWaiver(pg.db, issued.token, {
      signerName: seat.person.fullName,
      agreed: true,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
    });
    const gate = await holdRowLock(
      pg,
      sql`select id from bookings where id = ${seat.booking.id} for update`,
    );
    const board = recordRollCall(pg.connect(), {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: seat.booking.id,
      recordedByPersonId: owner.person.id,
      status: "boarded",
    });
    const erase = anonymizeDiver(pg.connect(), {
      shopId: shop.id,
      personId: seat.person.id,
      actorPersonId: owner.person.id,
    });
    try {
      await waitForLockWaiters(pg.db, 2);
    } finally {
      await gate.release();
    }
    const [boardResult, eraseResult] = await Promise.all([board, erase]);
    if (!boardResult.ok) expect(["not_ready", "booking_unavailable"]).toContain(boardResult.reason);
    expect(eraseResult).toMatchObject({ ok: true });
    const events = await pg.db
      .select()
      .from(rollCallEvents)
      .where(eq(rollCallEvents.bookingId, seat.booking.id));
    expect(events.every((event) => event.certificationSnapshot === null)).toBe(true);
  });
});
