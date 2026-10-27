import { and, eq, sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { raceShop } from "@/test/postgres-shop";
import { issueBookingCapability, revokeBookingCapabilities } from "./booking-capabilities";
import { moveBooking } from "./bookings";
import {
  courseFormDisplayDigest,
  getCourseFormsForBooking,
  signCourseFormForLink,
} from "./course-forms";
import {
  bookingCapabilities,
  bookings,
  courseFormRecords,
  courseFormRequirements,
  courseForms,
  courseFormVersions,
  courses,
  people,
  tripAssignments,
  trips,
} from "./schema";

/** The same form on a course seat and a marked charter seat, on a real server. */
async function fixture() {
  const pg = await postgresTestDb();
  const db = pg.db;
  const shop = await raceShop(db);
  const now = nowDate();
  const start = new Date(now.getTime() + 86_400_000);
  const end = new Date(start.getTime() + 7_200_000);
  const [person] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Casey Diver", dateOfBirth: "1990-01-01" })
    .returning();
  const [course] = await db
    .insert(courses)
    .values({ shopId: shop.id, title: "Course", slug: "course" })
    .returning();
  if (!person || !course) throw new Error("person or course missing");
  const [session] = await db
    .insert(trips)
    .values({
      id: "00000000-0000-4000-8000-000000000001",
      shopId: shop.id,
      title: "Session",
      courseId: course.id,
      startsAt: start,
      endsAt: end,
      capacity: 6,
    })
    .returning();
  const [charter] = await db
    .insert(trips)
    .values({
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      shopId: shop.id,
      title: "Charter",
      startsAt: start,
      endsAt: end,
      capacity: 6,
    })
    .returning();
  if (!session || !charter) throw new Error("departure missing");
  const [enrollment] = await db
    .insert(bookings)
    .values({ shopId: shop.id, tripId: session.id, personId: person.id, bookedAs: "diver" })
    .returning();
  if (!enrollment) throw new Error("enrollment missing");
  const [seat] = await db
    .insert(bookings)
    .values({
      shopId: shop.id,
      tripId: charter.id,
      personId: person.id,
      bookedAs: "diver",
      trainingEnrollmentBookingId: enrollment.id,
      trainingMarkedAt: now,
      trainingMarkedByPersonId: person.id,
    })
    .returning();
  if (!seat) throw new Error("seat missing");
  const [form] = await db.insert(courseForms).values({ shopId: shop.id }).returning();
  if (!form) throw new Error("form missing");
  const [version] = await db
    .insert(courseFormVersions)
    .values({
      shopId: shop.id,
      formId: form.id,
      version: 1,
      title: "Statement",
      body: "I will follow {instructorNames}'s plan.",
    })
    .returning();
  if (!version) throw new Error("version missing");
  await db
    .insert(courseFormRequirements)
    .values({ shopId: shop.id, courseId: course.id, formId: form.id, position: 0 });
  const bearer = await issueBookingCapability(db, {
    shopId: shop.id,
    bookingId: seat.id,
    purpose: "course_forms",
  });
  const enrollmentLink = await issueBookingCapability(db, {
    shopId: shop.id,
    bookingId: enrollment.id,
    purpose: "readiness",
  });
  if (!bearer || !enrollmentLink) throw new Error("capability missing");
  const forms = await getCourseFormsForBooking(db, shop.id, seat.id);
  const displayed = forms?.outstanding[0];
  if (!forms || !displayed) throw new Error("displayed form missing");
  const input = {
    shopId: shop.id,
    bookingId: seat.id,
    token: bearer.token,
    formVersionId: version.id,
    displayedDigest: courseFormDisplayDigest({
      shopId: shop.id,
      bookingId: seat.id,
      formVersionId: version.id,
      body: displayed.body,
      context: forms.enrollment.context,
    }),
    signerName: person.fullName,
    agreed: true,
  };
  return {
    pg,
    shop,
    person,
    seat,
    enrollment,
    bearer,
    enrollmentLink,
    form,
    input,
    now,
    session,
    charter,
  };
}

describePostgres("course forms signing races", () => {
  it("refuses a roster change after the displayed words were authenticated", async () => {
    const { pg, shop, session, input } = await fixture();
    const [instructor] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "New Instructor" })
      .returning();
    if (!instructor) throw new Error("instructor missing");
    await pg.db
      .insert(tripAssignments)
      .values({ tripId: session.id, personId: instructor.id, tripRole: "instructor" });
    expect(await signCourseFormForLink(pg.db, input)).toEqual({
      ok: false,
      reason: "version_changed",
    });
    expect(await pg.db.select().from(courseFormRecords)).toHaveLength(0);
  });
  it("refuses a capability that expires while the form is locked", async () => {
    const { pg, seat, form, input, now } = await fixture();
    await pg.db
      .update(bookingCapabilities)
      .set({ expiresAt: new Date(now.getTime() + 60_000) })
      .where(eq(bookingCapabilities.bookingId, seat.id));
    const gate = await holdRowLock(
      pg,
      sql`select id from course_forms where id = ${form.id} for update`,
    );
    const sign = signCourseFormForLink(pg.connect(), input);
    try {
      await waitForLockWaiters(pg.db, 1);
      vi.stubEnv("DIVEDAY_CLOCK", new Date(now.getTime() + 120_000).toISOString());
    } finally {
      await gate.release();
    }
    try {
      expect(await sign).toEqual({ ok: false, reason: "unavailable" });
      expect(await pg.db.select().from(courseFormRecords)).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("refuses when an actual move commits after the signer reads its departure", async () => {
    const { pg, shop, seat, charter, input } = await fixture();
    const [target] = await pg.db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Other charter",
        startsAt: charter.startsAt,
        endsAt: charter.endsAt,
        capacity: 6,
      })
      .returning();
    if (!target) throw new Error("target missing");
    await pg.db.execute(
      sql`create function gate_moving_seat() returns trigger language plpgsql as $$ begin if new.trip_id <> old.trip_id then perform pg_advisory_xact_lock(2276); end if; return new; end $$`,
    );
    await pg.db.execute(
      sql`create trigger gate_moving_seat before update on bookings for each row execute function gate_moving_seat()`,
    );
    const gate = await holdRowLock(pg, sql`select pg_advisory_xact_lock(2276)`);
    const move = moveBooking(pg.connect(), {
      shopId: shop.id,
      bookingId: seat.id,
      fromTripId: charter.id,
      toTripId: target.id,
    });
    let sign: ReturnType<typeof signCourseFormForLink> | undefined;
    try {
      await waitForLockWaiters(pg.db, 1);
      sign = signCourseFormForLink(pg.connect(), input);
      await waitForLockWaiters(pg.db, 2);
    } finally {
      await gate.release();
    }
    expect(await move).toMatchObject({ ok: true });
    expect(await sign).toEqual({ ok: false, reason: "unavailable" });
    expect(await pg.db.select().from(courseFormRecords)).toHaveLength(0);
  });

  it("serializes signing and a move that needs both trips in sorted order", async () => {
    const { pg, shop, seat, charter, session, input } = await fixture();
    const gate = await holdRowLock(
      pg,
      sql`select id from trips where id = ${session.id} for update`,
    );
    const move = moveBooking(pg.connect(), {
      shopId: shop.id,
      bookingId: seat.id,
      fromTripId: charter.id,
      toTripId: session.id,
    });
    let sign: ReturnType<typeof signCourseFormForLink> | undefined;
    try {
      await waitForLockWaiters(pg.db, 1);
      sign = signCourseFormForLink(pg.connect(), input);
      await waitForLockWaiters(pg.db, 2);
    } finally {
      await gate.release();
    }
    expect(await sign).toMatchObject({ ok: true });
    expect(await move).toEqual({ ok: false, reason: "course_mismatch" });
  });
  it("refuses a revoked bearer that commits while signing is waiting", async () => {
    const { pg, shop, seat, input, now } = await fixture();
    let release!: () => void;
    let changed!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const updated = new Promise<void>((resolve) => {
      changed = resolve;
    });
    const revoke = pg.connect().transaction(async (tx) => {
      await revokeBookingCapabilities(tx, { shopId: shop.id, bookingId: seat.id, now });
      changed();
      await wait;
    });
    await updated;
    const sign = signCourseFormForLink(pg.connect(), input);
    try {
      await waitForLockWaiters(pg.db, 1);
    } finally {
      release();
      await revoke;
    }
    expect(await sign).toEqual({ ok: false, reason: "unavailable" });
    expect(await pg.db.select().from(courseFormRecords)).toHaveLength(0);
  });

  it("refuses a cleared mark that commits while signing is waiting", async () => {
    const { pg, shop, seat, input } = await fixture();
    let release!: () => void;
    let changed!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const updated = new Promise<void>((resolve) => {
      changed = resolve;
    });
    const clear = pg.connect().transaction(async (tx) => {
      await tx
        .update(bookings)
        .set({
          trainingEnrollmentBookingId: null,
          trainingMarkedAt: null,
          trainingMarkedByPersonId: null,
        })
        .where(and(eq(bookings.shopId, shop.id), eq(bookings.id, seat.id)));
      changed();
      await wait;
    });
    await updated;
    const sign = signCourseFormForLink(pg.connect(), input);
    try {
      await waitForLockWaiters(pg.db, 1);
    } finally {
      release();
      await clear;
    }
    expect(await sign).toEqual({ ok: false, reason: "unavailable" });
    expect(await pg.db.select().from(courseFormRecords)).toHaveLength(0);
  });

  it("refuses when the enrollment's link is revoked before signing can read it", async () => {
    const { pg, shop, enrollment, input, now } = await fixture();
    let release!: () => void;
    let changed!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const updated = new Promise<void>((resolve) => {
      changed = resolve;
    });
    const revoke = pg.connect().transaction(async (tx) => {
      await revokeBookingCapabilities(tx, { shopId: shop.id, bookingId: enrollment.id, now });
      changed();
      await wait;
    });
    await updated;
    const sign = signCourseFormForLink(pg.connect(), input);
    try {
      await waitForLockWaiters(pg.db, 1);
    } finally {
      release();
      await revoke;
    }
    expect(await sign).toEqual({ ok: false, reason: "unavailable" });
    expect(await pg.db.select().from(courseFormRecords)).toHaveLength(0);
  });

  it("refuses an enrollment identity hold that commits before the signature", async () => {
    const { pg, shop, enrollment, input, now } = await fixture();
    let release!: () => void;
    let changed!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const updated = new Promise<void>((resolve) => {
      changed = resolve;
    });
    const hold = pg.connect().transaction(async (tx) => {
      await tx
        .update(bookings)
        .set({ identityUnconfirmedAt: now, identityBookedAs: "Casey" })
        .where(and(eq(bookings.shopId, shop.id), eq(bookings.id, enrollment.id)));
      changed();
      await wait;
    });
    await updated;
    const sign = signCourseFormForLink(pg.connect(), input);
    try {
      await waitForLockWaiters(pg.db, 1);
    } finally {
      release();
      await hold;
    }
    expect(await sign).toEqual({ ok: false, reason: "unavailable" });
    expect(await pg.db.select().from(courseFormRecords)).toHaveLength(0);
  });

  it("uses a corrected birth date that commits while signing is waiting", async () => {
    const { pg, shop, person, input } = await fixture();
    let release!: () => void;
    let changed!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const updated = new Promise<void>((resolve) => {
      changed = resolve;
    });
    const correction = pg.connect().transaction(async (tx) => {
      await tx
        .update(people)
        .set({ dateOfBirth: "2014-01-01" })
        .where(and(eq(people.shopId, shop.id), eq(people.id, person.id)));
      changed();
      await wait;
    });
    await updated;
    const sign = signCourseFormForLink(pg.connect(), input);
    try {
      await waitForLockWaiters(pg.db, 1);
    } finally {
      release();
      await correction;
    }
    expect(await sign).toEqual({ ok: false, reason: "guardian_required" });
    expect(await pg.db.select().from(courseFormRecords)).toHaveLength(0);
  });

  it("refuses words superseded while the signature is waiting", async () => {
    const { pg, shop, form, input } = await fixture();
    let release!: () => void;
    let changed!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const updated = new Promise<void>((resolve) => {
      changed = resolve;
    });
    const editor = pg.connect().transaction(async (tx) => {
      await tx
        .select({ id: courseForms.id })
        .from(courseForms)
        .where(eq(courseForms.id, form.id))
        .for("update");
      await tx.insert(courseFormVersions).values({
        shopId: shop.id,
        formId: form.id,
        version: 2,
        title: "Updated statement",
        body: "The updated words.",
      });
      changed();
      await wait;
    });
    await updated;
    const sign = signCourseFormForLink(pg.connect(), input);
    try {
      await waitForLockWaiters(pg.db, 1, 1000);
    } finally {
      release();
      await editor;
    }
    expect(await sign).toEqual({ ok: false, reason: "version_changed" });
    expect(await pg.db.select().from(courseFormRecords)).toHaveLength(0);
  });

  it("a concurrent revocation waits until a signature already holding its lock commits", async () => {
    const { pg, shop, seat, input } = await fixture();
    await pg.db.execute(
      sql`create function gate_course_signature() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(2275); return new; end $$`,
    );
    await pg.db.execute(
      sql`create trigger gate_course_signature before insert on course_form_records for each row execute function gate_course_signature()`,
    );
    const gate = await holdRowLock(pg, sql`select pg_advisory_xact_lock(2275)`);
    const sign = signCourseFormForLink(pg.connect(), input);
    let revoke: Promise<void> | undefined;
    try {
      await waitForLockWaiters(pg.db, 1);
      revoke = revokeBookingCapabilities(pg.connect(), { shopId: shop.id, bookingId: seat.id });
      await waitForLockWaiters(pg.db, 2);
    } finally {
      await gate.release();
    }
    expect(await sign).toMatchObject({ ok: true });
    await revoke;
    expect(await pg.db.select().from(courseFormRecords)).toHaveLength(1);
    const [cap] = await pg.db
      .select({ revokedAt: bookingCapabilities.revokedAt })
      .from(bookingCapabilities)
      .where(eq(bookingCapabilities.bookingId, seat.id));
    expect(cap?.revokedAt).not.toBeNull();
  });
});
