import { asc, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { canonicalRollCallEvidenceId, foldRollCallEvidence } from "@/lib/roll-call-causality";
import { countingShopContext } from "@/test/query-count";
import { manifestContext } from "@/test/substrate-fixtures/db/manifests-test-fixtures";
import type { DbExecutor } from "./client";
import { getTripManifest } from "./manifests";
import { createPerson } from "./people";
import { scopedCausalEvidence } from "./roll-call-causal-store";
import { bookings, rollCallEvents, tripAssignments, tripScheduleDays, trips } from "./schema";
import { type SeedRollCallEvidenceInput, seedRollCallEvidence } from "./seed-roll-call-evidence";

async function fixture() {
  const { db, shop, reef, booking, staff } = await manifestContext();
  return {
    db,
    shop,
    reef,
    booking,
    staff,
    base: {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      checkpoint: "after_dive_1",
      meetingDay: 0,
      occurredAt: nowDate(),
    },
  };
}

describe("fixture evidence authorship", () => {
  it("retains the scalar stored projection when SQL finds an existing UUID alias outside the input scope keys", async () => {
    const { db, base } = await fixture();
    const bookingId = base.bookingId.toUpperCase();
    expect(bookingId).not.toBe(base.bookingId);
    await seedRollCallEvidence(db, {
      ...base,
      status: "not_boarded",
      note: "Original prior report",
    });
    const input: SeedRollCallEvidenceInput = {
      ...base,
      bookingId,
      id: crypto.randomUUID(),
      status: "boarded",
    };
    const read = async (tx: DbExecutor) => {
      const [row] = await tx
        .select()
        .from(rollCallEvents)
        .where(eq(rollCallEvents.id, input.id as string));
      const { seq: _seq, ...stored } = row;
      return stored;
    };
    let scalar: Awaited<ReturnType<typeof read>> | undefined;
    const rollback = new Error("discard UUID alias scalar oracle");
    await expect(
      db.transaction(async (tx) => {
        await seedRollCallEvidence(tx, input);
        scalar = await read(tx);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(scalar).toMatchObject({ status: "not_boarded", evidenceConflict: true });
    await seedRollCallEvidence(db, [input]);
    expect(await read(db)).toEqual(scalar);
  });

  it("retains scalar refresh when the trip lock found no live row", async () => {
    const counted = await countingShopContext();
    const at = nowDate();
    const [trip] = await counted.db
      .insert(trips)
      .values({
        shopId: counted.shop.id,
        title: "Deleted fixture lock boundary",
        startsAt: at,
        endsAt: new Date(at.getTime() + 3_600_000),
        capacity: 4,
        deletedAt: at,
      })
      .returning();
    if (!trip) throw new Error("deleted fixture trip missing");
    const captain = await createPerson(counted.db, {
      shopId: counted.shop.id,
      fullName: "Deleted fixture recorder",
      email: null,
      phone: null,
      origin: "waitlist",
      roles: ["captain"],
    });
    await counted.db.insert(tripAssignments).values({ tripId: trip.id, personId: captain.id });
    counted.reset();
    const rows = await seedRollCallEvidence(counted.db, [
      {
        shopId: counted.shop.id,
        tripId: trip.id,
        subjectKind: "crew",
        crewPersonId: captain.id,
        recordedByPersonId: captain.id,
        checkpoint: "after_dive_1",
        occurredAt: at,
        status: "boarded",
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(
      counted.statements.some((statement) => /^update "roll_call_events"/i.test(statement)),
    ).toBe(true);
  });

  it("does not add SQL refresh round trips for each distinct fresh subject", async () => {
    const counted = await countingShopContext();
    const at = nowDate();
    const [trip] = await counted.db
      .insert(trips)
      .values({
        shopId: counted.shop.id,
        title: "Fresh scope query budget",
        startsAt: at,
        endsAt: new Date(at.getTime() + 3_600_000),
        capacity: 32,
      })
      .returning();
    if (!trip) throw new Error("fresh fixture trip missing");
    const recorder = await createPerson(counted.db, {
      shopId: counted.shop.id,
      fullName: "Fresh fixture recorder",
      email: null,
      phone: null,
      origin: "waitlist",
      roles: ["captain"],
    });
    await counted.db.insert(tripAssignments).values({ tripId: trip.id, personId: recorder.id });
    const events: SeedRollCallEvidenceInput[] = [];
    for (let index = 0; index < 25; index++) {
      const person = await createPerson(counted.db, {
        shopId: counted.shop.id,
        fullName: `Fresh fixture diver ${index}`,
        email: null,
        phone: null,
        origin: "waitlist",
      });
      const [seat] = await counted.db
        .insert(bookings)
        .values({
          shopId: counted.shop.id,
          tripId: trip.id,
          personId: person.id,
          bookedAs: "diver",
          status: "booked",
        })
        .returning();
      if (!seat) throw new Error("fresh fixture seat missing");
      events.push({
        shopId: counted.shop.id,
        tripId: trip.id,
        bookingId: seat.id,
        recordedByPersonId: recorder.id,
        checkpoint: "after_dive_1",
        meetingDay: 0,
        occurredAt: at,
        status: "boarded",
      });
    }
    counted.reset();
    await seedRollCallEvidence(counted.db, events.slice(0, 1));
    const one = counted.count();
    counted.reset();
    await seedRollCallEvidence(counted.db, events.slice(1));
    console.info("fresh-subject SQL counts", { one, twentyFour: counted.count() });
    expect(counted.count()).toBe(one);
  });

  for (const role of ["diver", "crew"] as const) {
    for (const sequence of [
      "explicit out of order",
      "explicit equal",
      "automatic below existing high",
    ] as const) {
      it(`keeps the scalar author's actual sequence revisions: ${role}, ${sequence}`, async () => {
        const { db, base, shop, reef } = await fixture();
        const person = await createPerson(db, {
          shopId: shop.id,
          fullName: "Sequence regression",
          email: null,
          phone: null,
          origin: "waitlist",
          roles: role === "crew" ? ["captain"] : ["diver"],
        });
        let subject: Pick<SeedRollCallEvidenceInput, "bookingId" | "crewPersonId" | "subjectKind">;
        if (role === "crew") {
          await db.insert(tripAssignments).values({ tripId: reef.id, personId: person.id });
          subject = { bookingId: null, crewPersonId: person.id, subjectKind: "crew" };
        } else {
          const [seat] = await db
            .insert(bookings)
            .values({
              shopId: shop.id,
              tripId: reef.id,
              personId: person.id,
              bookedAs: "diver",
              status: "booked",
            })
            .returning();
          if (!seat) throw new Error("sequence fixture seat missing");
          subject = { bookingId: seat.id, crewPersonId: null, subjectKind: "seat" };
        }
        const common = { ...base, ...subject };
        const ids = Array.from({ length: 5 }, () => crypto.randomUUID());
        let events: SeedRollCallEvidenceInput[];
        if (sequence !== "automatic below existing high") {
          events = [
            { ...common, id: ids[0], seq: 100, status: "not_boarded" },
            {
              ...common,
              id: ids[1],
              seq: sequence === "explicit equal" ? 100 : 50,
              status: "boarded",
            },
            { ...common, id: ids[2], seq: 101, status: "not_boarded" },
          ];
        } else {
          const [initial] = await seedRollCallEvidence(db, {
            ...common,
            id: ids[3],
            status: "boarded",
          });
          await seedRollCallEvidence(db, {
            ...common,
            id: ids[4],
            seq: initial.seq + 1_000,
            status: "not_boarded",
          });
          events = [
            { ...common, id: ids[0], status: "boarded" },
            { ...common, id: ids[1], status: "not_boarded" },
          ];
        }
        const read = async (tx: DbExecutor) =>
          (
            await tx
              .select()
              .from(rollCallEvents)
              .where(inArray(rollCallEvents.id, ids))
              .orderBy(asc(rollCallEvents.id))
          ).map(({ seq: _seq, ...row }) => row);
        const scalarReturned: Omit<typeof rollCallEvents.$inferSelect, "seq">[] = [];
        let scalar: Awaited<ReturnType<typeof read>> = [];
        const rollback = new Error("discard sequence oracle");
        await expect(
          db.transaction(async (tx) => {
            for (const event of events) {
              const [{ seq: _seq, ...row }] = await seedRollCallEvidence(tx, event, {
                observesPrevious: true,
              });
              scalarReturned.push(row);
            }
            scalar = await read(tx);
            throw rollback;
          }),
        ).rejects.toBe(rollback);
        const batch = await seedRollCallEvidence(db, events, { observesPrevious: true });
        const stored = await read(db);
        if (sequence === "explicit equal") {
          // seq is not unique and native SQL orders by seq alone. A repeated
          // scalar control proved its tie choice can differ before any batch
          // call: retain audit and valid prefix basis, not an invented winner.
          const audit = ({
            status: _status,
            causalFrontier: _frontier,
            evidenceConflict: _conflict,
            evidenceOrderingUnknown: _unknown,
            observedEvidenceIds: _implicitBasis,
            ...row
          }: Omit<typeof rollCallEvents.$inferSelect, "seq">) => row;
          expect(batch.map(({ seq: _seq, ...row }) => audit(row))).toEqual(
            scalarReturned.map(audit),
          );
          expect(stored.map(audit)).toEqual(scalar.map(audit));
          const available = new Set<string>();
          for (const row of batch) {
            expect(row.observedEvidenceIds).not.toBeNull();
            expect(row.observedEvidenceIds?.every((id) => available.has(id))).toBe(true);
            available.add(canonicalRollCallEvidenceId(row));
          }
          const projection = foldRollCallEvidence(
            scopedCausalEvidence(stored, common.checkpoint, 0),
            common.checkpoint,
          );
          expect(stored.find((row) => row.id === ids[2])).toMatchObject({
            status: "not_boarded",
            causalFrontier: projection.frontier,
            evidenceConflict: projection.conflict,
          });
          await expect(
            seedRollCallEvidence(db, events, { observesPrevious: true }),
          ).rejects.toThrow();
          expect(await read(db)).toEqual(stored);
        } else {
          expect(batch.map(({ seq: _seq, ...row }) => row)).toEqual(scalarReturned);
          expect(stored).toEqual(scalar);
        }
        if (sequence !== "automatic below existing high")
          expect(batch.map((row) => row.seq)).toEqual([
            100,
            sequence === "explicit equal" ? 100 : 50,
            101,
          ]);
      });
    }
  }

  for (const role of ["diver", "crew"] as const) {
    for (const observesPrevious of [false, true]) {
      for (const hasInitialEvidence of [true, false]) {
        it(`stores the scalar author's exact audit and day projections when batched: ${role}, sequential=${observesPrevious}, existing=${hasInitialEvidence}`, async () => {
          const { db, base, reef, staff } = await fixture();
          await db.delete(tripScheduleDays).where(eq(tripScheduleDays.tripId, reef.id));
          await db.insert(tripScheduleDays).values(
            [0, 1].map((day) => ({
              tripId: reef.id,
              dayNumber: day + 1,
              startsAt: new Date(base.occurredAt.getTime() + day * 86_400_000),
              endsAt: new Date(base.occurredAt.getTime() + day * 86_400_000 + 3_600_000),
            })),
          );
          const ids = Array.from({ length: 8 }, () => crypto.randomUUID());
          const common = {
            ...base,
            ...(role === "crew"
              ? { bookingId: null, crewPersonId: staff.id, subjectKind: "crew" as const }
              : {}),
          };
          if (!hasInitialEvidence) {
            const person = await createPerson(db, {
              shopId: base.shopId,
              fullName: "Fresh day parity",
              email: null,
              phone: null,
              origin: "waitlist",
              roles: role === "crew" ? ["captain"] : ["diver"],
            });
            if (role === "crew") {
              await db.insert(tripAssignments).values({ tripId: reef.id, personId: person.id });
              Object.assign(common, { crewPersonId: person.id });
            } else {
              const [seat] = await db
                .insert(bookings)
                .values({
                  shopId: base.shopId,
                  tripId: reef.id,
                  personId: person.id,
                  bookedAs: "diver",
                  status: "booked",
                })
                .returning();
              if (!seat) throw new Error("fresh parity seat missing");
              Object.assign(common, { bookingId: seat.id });
            }
          }
          // An already stored day's latest row is revised by the unknown-day
          // withdrawal before a later authored mark makes it historical.
          if (hasInitialEvidence)
            await seedRollCallEvidence(db, {
              ...common,
              id: ids[7],
              status: "boarded",
              meetingDay: 1,
            });
          const writtenIds = hasInitialEvidence ? ids : ids.slice(0, 7);
          const events: SeedRollCallEvidenceInput[] = [
            { ...common, id: ids[0], status: "not_boarded", note: "Original report" },
            {
              ...common,
              id: ids[1],
              status: "boarded",
              occurredAt: new Date(base.occurredAt.getTime() - 60_000),
            },
            {
              ...common,
              id: ids[3],
              status: "cleared",
              meetingDay: undefined,
              note: "Day not recorded",
            },
            { ...common, id: ids[2], status: "boarded", meetingDay: 1 },
            {
              ...common,
              id: ids[4],
              status: "boarded",
              meetingDay: 1,
              observedEvidenceIds: [
                canonicalRollCallEvidenceId({ id: ids[2] }),
                canonicalRollCallEvidenceId({ id: ids[3] }),
              ],
              reconcilesEvidence: true,
            },
            {
              ...common,
              id: ids[5],
              status: "cleared",
              meetingDay: 1,
              observedEvidenceIds: [canonicalRollCallEvidenceId({ id: ids[4] })],
              retractsEventId: ids[4],
            },
            {
              ...common,
              id: ids[6],
              status: "not_boarded",
              checkpoint: "departure",
              clientEventId: crypto.randomUUID(),
            },
          ];
          const rollback = new Error("discard scalar oracle");
          let scalar: Omit<typeof rollCallEvents.$inferSelect, "seq">[] = [];
          const scalarReturned: Omit<typeof rollCallEvents.$inferSelect, "seq">[] = [];
          await expect(
            db.transaction(async (tx) => {
              for (const event of events) {
                const [{ seq: _seq, ...returned }] = await seedRollCallEvidence(tx, event, {
                  observesPrevious,
                });
                scalarReturned.push(returned);
              }
              // Sequence values are allocation machinery and are not rolled back;
              // every audit and projection column, plus relative order, is compared.
              scalar = (
                await tx
                  .select()
                  .from(rollCallEvents)
                  .where(inArray(rollCallEvents.id, ids))
                  .orderBy(asc(rollCallEvents.seq))
              ).map(({ seq: _seq, ...row }) => row);
              throw rollback;
            }),
          ).rejects.toBe(rollback);
          const batchReturned = await seedRollCallEvidence(db, events, { observesPrevious });
          expect(batchReturned.map(({ seq: _seq, ...row }) => row)).toEqual(scalarReturned);
          const batched = (
            await db
              .select()
              .from(rollCallEvents)
              .where(inArray(rollCallEvents.id, ids))
              .orderBy(asc(rollCallEvents.seq))
          ).map(({ seq: _seq, ...row }) => row);
          expect(batched).toEqual(scalar);
          expect(batchReturned.map((row) => row.recordedByPersonId)).toEqual(
            events.map((row) => row.recordedByPersonId),
          );
          // Duplicate audit identities must still fail atomically, never replace
          // original marks or silently mint a second copy on a repeated call.
          await expect(seedRollCallEvidence(db, events, { observesPrevious })).rejects.toThrow();
          expect(
            (await db.select().from(rollCallEvents).where(inArray(rollCallEvents.id, ids)))
              .map((row) => row.id)
              .sort(),
          ).toEqual([...writtenIds].sort());
        });
      }
    }
  }

  it("does not legalize a withdrawal that precedes its target in a batch", async () => {
    const { db, base } = await fixture();
    const id = crypto.randomUUID();
    const laterId = crypto.randomUUID();
    const events: SeedRollCallEvidenceInput[] = [
      { ...base, id, status: "cleared", retractsEventId: laterId },
      { ...base, id: laterId, status: "boarded" },
    ];
    await expect(seedRollCallEvidence(db, events[0])).rejects.toThrow();
    await expect(seedRollCallEvidence(db, events)).rejects.toThrow();
    expect(
      await db
        .select()
        .from(rollCallEvents)
        .where(inArray(rollCallEvents.id, [id, laterId])),
    ).toEqual([]);
  });

  it("does not add SQL round trips for extra authored marks in the same existing scope", async () => {
    // Query-count's logger wraps a real database, not a file-scoped rollback
    // transaction (which intentionally exposes no standalone driver client).
    const counted = await countingShopContext();
    const [seat] = await counted.db
      .select()
      .from(bookings)
      .where(eq(bookings.shopId, counted.shop.id))
      .limit(1);
    if (!seat) throw new Error("fixture seat missing");
    const base = {
      shopId: counted.shop.id,
      tripId: seat.tripId,
      bookingId: seat.id,
      recordedByPersonId: seat.personId,
      checkpoint: "after_dive_1",
      meetingDay: 0,
      occurredAt: nowDate(),
    };
    // Hold initial state constant: both measured arrays append to an existing
    // scope. Fresh-subject growth is measured independently above.
    await seedRollCallEvidence(counted.db, { ...base, status: "boarded" });
    counted.reset();
    await seedRollCallEvidence(counted.db, [{ ...base, status: "boarded" }]);
    const one = counted.count();
    counted.reset();
    await seedRollCallEvidence(
      counted.db,
      Array.from({ length: 24 }, () => ({ ...base, status: "boarded" as const })),
    );
    console.info("existing-scope SQL counts", { one, twentyFour: counted.count() });
    expect(counted.count()).toBe(one);
  });

  it("defaults to unknown basis and keeps opposing evidence despite reversed capture clocks", async () => {
    const { db, base, shop, reef, booking } = await fixture();
    const rows = await seedRollCallEvidence(db, [
      { ...base, status: "boarded", occurredAt: new Date("2026-07-20T14:10Z") },
      { ...base, status: "not_boarded", occurredAt: new Date("2026-07-20T14:00Z") },
    ]);
    expect(rows.map((row) => row.observedEvidenceIds)).toEqual([null, null]);
    expect(rows[1]).toMatchObject({
      status: "not_boarded",
      statementStatus: "not_boarded",
      evidenceConflict: true,
    });
    expect(
      (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.divers.find(
        (row) => row.bookingId === booking.booking.id,
      )?.rollCallContext,
    ).toMatchObject({ conflict: true });
  });

  it("merges compatible unknown statements without inventing observation", async () => {
    const { db, base } = await fixture();
    const rows = await seedRollCallEvidence(db, [
      { ...base, status: "boarded" },
      { ...base, status: "boarded" },
    ]);
    expect(rows.map((row) => row.observedEvidenceIds)).toEqual([null, null]);
    expect(rows[1]).toMatchObject({ status: "boarded", evidenceConflict: false });
    expect(rows[1].causalFrontier).toHaveLength(2);
  });

  it("chains a deliberately authored sequential correction and exact undo", async () => {
    const { db, base } = await fixture();
    const rows = await seedRollCallEvidence(
      db,
      [
        { ...base, status: "not_boarded", occurredAt: new Date("2026-07-20T14:10Z") },
        { ...base, status: "boarded", occurredAt: new Date("2026-07-20T14:00Z") },
        { ...base, status: "cleared", occurredAt: new Date("2026-07-20T13:55Z") },
      ],
      { observesPrevious: true },
    );
    expect(rows[1].observedEvidenceIds).toEqual([canonicalRollCallEvidenceId(rows[0])]);
    expect(rows[1]).toMatchObject({ status: "boarded", evidenceConflict: false });
    expect(rows[2]).toMatchObject({
      status: "cleared",
      retractsEventId: rows[1].id,
      evidenceConflict: false,
    });
  });

  it("does not turn declared observation of opposing marks into implicit reconciliation", async () => {
    const { db, base } = await fixture();
    await seedRollCallEvidence(db, [
      { ...base, status: "not_boarded" },
      { ...base, status: "boarded" },
    ]);
    const [ordinary] = await seedRollCallEvidence(
      db,
      { ...base, status: "boarded" },
      { observesPrevious: true },
    );
    expect(ordinary).toMatchObject({
      status: "not_boarded",
      evidenceConflict: true,
      reconcilesEvidence: false,
    });
  });
});
