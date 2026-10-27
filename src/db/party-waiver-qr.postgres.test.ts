import { eq, sql } from "drizzle-orm";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { raceShop } from "@/test/postgres-shop";
import { lockBoardingCertificationEvidence } from "./boarding-certification-snapshot";
import { issuePartyWaiver } from "./party-waiver-queue";
import { bookings, people, tripRequirements, trips, waiverRecords } from "./schema";
import { completeWaiver, getWaiverForToken, saveWaiverDraft } from "./waivers-completion";
import { issueWaiverRequest } from "./waivers-requests";
import { saveWaiverTemplate } from "./waivers-templates";
import { clearAnswers } from "./waivers-test-fixtures";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
async function fixture() {
  vi.stubEnv("SECRET_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("DIVEDAY_CLOCK", "");
  const pg = await postgresTestDb();
  const shop = await raceShop(pg.db);
  await saveWaiverTemplate(pg.db, {
    shopId: shop.id,
    title: "Release",
    body: "I understand the risks of diving.",
  });
  const [person] = await pg.db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Alex Lagoon" })
    .returning();
  const now = nowDate();
  const [trip] = await pg.db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Reef",
      startsAt: new Date(now.getTime() + 3600000),
      endsAt: new Date(now.getTime() + 7200000),
      capacity: 4,
    })
    .returning();
  if (!person || !trip) throw new Error("fixture missing");
  await pg.db
    .insert(tripRequirements)
    .values({ shopId: shop.id, tripId: trip.id, requiresWaiver: true });
  const [booking] = await pg.db
    .insert(bookings)
    .values({ shopId: shop.id, tripId: trip.id, personId: person.id, bookedAs: "diver" })
    .returning();
  if (!booking) throw new Error("booking missing");
  const issued = await issueWaiverRequest(pg.db, { shopId: shop.id, bookingId: booking.id });
  if (!issued.ok) throw new Error("waiver missing");
  return { pg, shop, person, trip, booking, issued };
}

/** A real transaction updates a row but holds its commit until the waiter parks. */
async function updateAndHold(
  pg: Awaited<ReturnType<typeof postgresTestDb>>,
  update: (tx: Parameters<Parameters<typeof pg.db.transaction>[0]>[0]) => Promise<void>,
) {
  let release!: () => void;
  let ready!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const locked = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const holder = pg.connect().transaction(async (tx) => {
    await update(tx);
    ready();
    await held;
  });
  await Promise.race([locked, holder]);
  let released: Promise<void> | undefined;
  const releaseOnce = () =>
    (released ??= (async () => {
      release();
      await holder;
    })());
  onTestFinished(releaseOnce);
  return { release: releaseOnce };
}

describePostgres("counter waiver locking", () => {
  it("does not revive a waiver that expired while issuance waited", async () => {
    const f = await fixture();
    const gate = await updateAndHold(f.pg, async (tx) => {
      await tx
        .update(waiverRecords)
        .set({ expiresAt: new Date(nowDate().getTime() - 1000) })
        .where(eq(waiverRecords.id, f.issued.recordId));
    });
    const next = issueWaiverRequest(f.pg.connect(), { shopId: f.shop.id, bookingId: f.booking.id });
    try {
      await waitForLockWaiters(f.pg.db, 1);
    } finally {
      await gate.release();
    }
    const result = await next;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.token).not.toBe(f.issued.token);
    expect(await getWaiverForToken(f.pg.db, f.issued.token)).toEqual({ state: "unavailable" });
  });
  it.each(["sign", "draft"] as const)(
    "refuses %s and contact after the token is superseded while waiting",
    async (operation) => {
      const f = await fixture();
      const gate = await updateAndHold(f.pg, async (tx) => {
        await tx
          .update(waiverRecords)
          .set({ supersededAt: nowDate() })
          .where(eq(waiverRecords.id, f.issued.recordId));
      });
      const action =
        operation === "sign"
          ? completeWaiver(f.pg.connect(), f.issued.token, {
              signerName: "Alex Lagoon",
              agreed: true,
              medicalAnswers: clearAnswers,
              emergencyContact: { name: "Jordan", phone: "1234567890" },
            })
          : saveWaiverDraft(f.pg.connect(), f.issued.token, {
              acknowledged: true,
              medicalAnswers: clearAnswers,
              emergencyContact: { name: "Jordan", phone: "1234567890" },
            });
      try {
        await waitForLockWaiters(f.pg.db, 1);
      } finally {
        await gate.release();
      }
      const result = await action;
      if (operation === "sign") expect(result).toMatchObject({ ok: false });
      else expect(result).toBe(false);
      const [person] = await f.pg.db.select().from(people).where(eq(people.id, f.person.id));
      expect(person?.emergencyContactName).toBeNull();
      const [record] = await f.pg.db
        .select()
        .from(waiverRecords)
        .where(eq(waiverRecords.id, f.issued.recordId));
      expect(record?.draftAcknowledged).not.toBe(true);
    },
  );
  it.each([
    ["guardian", { minorDeclaredAt: nowDate() }],
    ["held", { identityUnconfirmedAt: nowDate() }],
  ] as const)("rechecks %s after the seat lock", async (kind, patch) => {
    const f = await fixture();
    const gate = await updateAndHold(f.pg, async (tx) => {
      await tx.update(bookings).set(patch).where(eq(bookings.id, f.booking.id));
    });
    const action = completeWaiver(f.pg.connect(), f.issued.token, {
      signerName: "Alex Lagoon",
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    try {
      await waitForLockWaiters(f.pg.db, 1);
    } finally {
      await gate.release();
    }
    expect(await action).toEqual({
      ok: false,
      reason: kind === "held" ? "identity_unconfirmed" : "guardian_required",
    });
  });
  it("refuses QR issuance when a booking wait crosses the departure return cutoff", async () => {
    const f = await fixture();
    const clock = vi.spyOn(Date, "now");
    const current = nowDate().getTime();
    clock.mockReturnValue(current);
    await f.pg.db
      .update(trips)
      .set({ startsAt: new Date(current - 3600000), endsAt: new Date(current - 1800000) })
      .where(eq(trips.id, f.trip.id));
    const gate = await holdRowLock(
      f.pg,
      sql`select id from bookings where id = ${f.booking.id} for update`,
    );
    const issue = issuePartyWaiver(f.pg.connect(), {
      shopId: f.shop.id,
      tripId: f.trip.id,
      leadBookingId: f.booking.id,
      bookingId: f.booking.id,
    });
    try {
      await waitForLockWaiters(f.pg.db, 1);
      clock.mockReturnValue(current + 7200000);
    } finally {
      await gate.release();
    }
    expect(await issue).toBeNull();
  });
  it.each(["sign", "draft"] as const)(
    "ordinary issuance serializes before a concurrent %s without deadlocking",
    async (operation) => {
      const f = await fixture();
      await saveWaiverTemplate(f.pg.db, {
        shopId: f.shop.id,
        title: "Revised",
        body: "Revised terms for the release.",
      });
      const gate = await holdRowLock(
        f.pg,
        sql`select id from waiver_records where id = ${f.issued.recordId} for update`,
      );
      const issuance = issueWaiverRequest(f.pg.connect(), {
        shopId: f.shop.id,
        bookingId: f.booking.id,
      });
      await waitForLockWaiters(f.pg.db, 1);
      const write =
        operation === "sign"
          ? completeWaiver(f.pg.connect(), f.issued.token, {
              signerName: "Alex Lagoon",
              agreed: true,
              medicalAnswers: clearAnswers,
            })
          : saveWaiverDraft(f.pg.connect(), f.issued.token, {
              acknowledged: true,
              medicalAnswers: clearAnswers,
            });
      try {
        await waitForLockWaiters(f.pg.db, 2);
      } finally {
        await gate.release();
      }
      const replacement = await issuance;
      expect(replacement.ok).toBe(true);
      if (replacement.ok) expect(replacement.token).not.toBe(f.issued.token);
      const outcome = await write;
      if (operation === "sign") expect(outcome).toMatchObject({ ok: false });
      else expect(outcome).toBe(false);
    },
  );
  it("blocks a writer behind erasure's exclusive shop lock", async () => {
    const f = await fixture();
    const gate = await holdRowLock(
      f.pg,
      sql`select pg_advisory_xact_lock(hashtext('boarding_certification_evidence'),hashtext(${f.shop.id}))`,
    );
    const action = completeWaiver(f.pg.connect(), f.issued.token, {
      signerName: "Alex Lagoon",
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    try {
      await waitForLockWaiters(f.pg.db, 1);
    } finally {
      await gate.release();
    }
    expect((await action).ok).toBe(true);
  });
  it("blocks erasure's exclusive shop lock while signing owns its shared lock", async () => {
    const f = await fixture();
    const gate = await holdRowLock(
      f.pg,
      sql`select id from bookings where id = ${f.booking.id} for update`,
    );
    const action = completeWaiver(f.pg.connect(), f.issued.token, {
      signerName: "Alex Lagoon",
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    await waitForLockWaiters(f.pg.db, 1);
    const erase = f.pg.connect().transaction(async (tx) => {
      await lockBoardingCertificationEvidence(tx, f.shop.id, "rewrite");
    });
    try {
      await waitForLockWaiters(f.pg.db, 2);
    } finally {
      await gate.release();
    }
    expect((await action).ok).toBe(true);
    await erase;
  });
});
