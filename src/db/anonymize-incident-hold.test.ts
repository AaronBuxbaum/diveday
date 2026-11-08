import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "../features/anonymize/store";
import { removeIncidentPerson } from "./incident-reports";
import {
  bookings,
  incidentReportAddenda,
  incidentReportPeople,
  incidentReports,
  people,
  personRoles,
  tripAssignments,
  trips,
} from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **An erasure waits for an incident's legal hold** (Aaron chose option A on
 * issue #3805). Erasing someone linked to a held incident would clear that
 * departure's evidence: the boarding certification snapshot, the notes on a
 * seat, a former staffer's crew credential. While any held report links the
 * person (a booking on its departure, a name on the report, a place on its
 * crew), the erasure is refused with `incident_hold` and nothing changes.
 */
const ctx = fileScopedShopContext();

async function setting() {
  const { db, shop } = ctx;
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  if (!owner) throw new Error("expected the seeded owner");
  const [seat] = await db
    .select({ personId: bookings.personId, tripId: bookings.tripId })
    .from(bookings)
    .where(and(eq(bookings.shopId, shop.id), ne(bookings.status, "cancelled")))
    .orderBy(bookings.id)
    .limit(1);
  if (!seat) throw new Error("expected a seeded booking");
  // A departure the diver was never on.
  const [elsewhere] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shop.id),
        liveTrip(),
        ne(trips.id, seat.tripId),
        // Not one of the diver's other seats either.
        ne(
          trips.id,
          db
            .select({ id: bookings.tripId })
            .from(bookings)
            .where(eq(bookings.personId, seat.personId))
            .limit(1),
        ),
      ),
    )
    .limit(1);
  if (!elsewhere) throw new Error("expected a second departure");
  await db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, seat.personId));
  return { db, shop, owner: owner.id, diver: seat.personId, tripId: seat.tripId, elsewhere };
}

async function report(
  db: typeof ctx.db,
  input: { shopId: string; tripId: string; createdBy: string; held: boolean },
) {
  const [row] = await db
    .insert(incidentReports)
    .values({
      shopId: input.shopId,
      tripId: input.tripId,
      createdByPersonId: input.createdBy,
      legalHoldAt: input.held ? nowDate() : null,
    })
    .returning({ id: incidentReports.id });
  if (!row) throw new Error("report not written");
  return row.id;
}

async function erase(db: typeof ctx.db, shopId: string, personId: string, actor: string) {
  return anonymizeDiver(db, { shopId, personId, actorPersonId: actor });
}

async function isErased(db: typeof ctx.db, personId: string) {
  const [row] = await db
    .select({ anonymizedAt: people.anonymizedAt })
    .from(people)
    .where(eq(people.id, personId));
  return row?.anonymizedAt != null;
}

describe("erasure and an incident's legal hold", () => {
  it("refuses a diver booked on a departure whose report is held, and changes nothing", async () => {
    const { db, shop, owner, diver, tripId } = await setting();
    await report(db, { shopId: shop.id, tripId, createdBy: owner, held: true });
    expect(await erase(db, shop.id, diver, owner)).toEqual({
      ok: false,
      reason: "incident_hold",
    });
    expect(await isErased(db, diver)).toBe(false);
  });

  it("refuses on a cancelled seat on that departure too: the erasure would scrub it", async () => {
    const { db, shop, owner, diver, tripId } = await setting();
    await db
      .update(bookings)
      .set({ status: "cancelled" })
      .where(and(eq(bookings.personId, diver), eq(bookings.tripId, tripId)));
    await report(db, { shopId: shop.id, tripId, createdBy: owner, held: true });
    expect(await erase(db, shop.id, diver, owner)).toMatchObject({ reason: "incident_hold" });
  });

  it("refuses a person named on a held report on a departure they had no seat on", async () => {
    const { db, shop, owner, diver, elsewhere } = await setting();
    const reportId = await report(db, {
      shopId: shop.id,
      tripId: elsewhere.id,
      createdBy: owner,
      held: true,
    });
    await db
      .insert(incidentReportPeople)
      .values({ shopId: shop.id, reportId, personId: diver, involvement: "witness" });
    expect(await erase(db, shop.id, diver, owner)).toMatchObject({ reason: "incident_hold" });
  });

  it("refuses a former staffer who crewed the held departure", async () => {
    const { db, shop, owner, diver, elsewhere } = await setting();
    await db.insert(tripAssignments).values({ tripId: elsewhere.id, personId: diver });
    await report(db, { shopId: shop.id, tripId: elsewhere.id, createdBy: owner, held: true });
    expect(await erase(db, shop.id, diver, owner)).toMatchObject({ reason: "incident_hold" });
  });

  // Security review of #3805, blocker: the outsider sweep must not rewrite a
  // held report, so a typed name it would redact is a link.
  it("refuses while a held report lists them by typed name, and leaves that row as written", async () => {
    const { db, shop, owner, diver, elsewhere } = await setting();
    const [person] = await db
      .select({ fullName: people.fullName })
      .from(people)
      .where(eq(people.id, diver));
    if (!person) throw new Error("diver missing");
    const reportId = await report(db, {
      shopId: shop.id,
      tripId: elsewhere.id,
      createdBy: owner,
      held: true,
    });
    await db.insert(incidentReportPeople).values({
      shopId: shop.id,
      reportId,
      outsiderName: person.fullName,
      involvement: "witness",
    });
    expect(await erase(db, shop.id, diver, owner)).toMatchObject({ reason: "incident_hold" });
    const rows = await db
      .select({ outsiderName: incidentReportPeople.outsiderName })
      .from(incidentReportPeople)
      .where(eq(incidentReportPeople.reportId, reportId));
    expect(rows).toEqual([{ outsiderName: person.fullName }]);
  });

  it.each([
    ["createdByPersonId", {}],
    ["filedByPersonId", {}],
  ] as const)("refuses a former staffer who is the held report's %s", async (column, with_) => {
    const { db, shop, owner, diver, elsewhere } = await setting();
    const reportId = await report(db, {
      shopId: shop.id,
      tripId: elsewhere.id,
      createdBy: owner,
      held: true,
    });
    await db
      .update(incidentReports)
      .set({ ...with_, [column]: diver })
      .where(eq(incidentReports.id, reportId));
    expect(await erase(db, shop.id, diver, owner)).toMatchObject({ reason: "incident_hold" });
  });

  it.each(["missingAlertReachedPersonIds", "missingAllClearSentPersonIds"] as const)(
    "refuses a former staffer listed in the held report's %s",
    async (column) => {
      const { db, shop, owner, diver, elsewhere } = await setting();
      const reportId = await report(db, {
        shopId: shop.id,
        tripId: elsewhere.id,
        createdBy: owner,
        held: true,
      });
      await db
        .update(incidentReports)
        .set({ [column]: [diver] })
        .where(eq(incidentReports.id, reportId));
      expect(await erase(db, shop.id, diver, owner)).toMatchObject({ reason: "incident_hold" });
    },
  );

  it("refuses a former staffer who wrote an addendum on the held report", async () => {
    const { db, shop, owner, diver, elsewhere } = await setting();
    const reportId = await report(db, {
      shopId: shop.id,
      tripId: elsewhere.id,
      createdBy: owner,
      held: true,
    });
    await db
      .insert(incidentReportAddenda)
      .values({ shopId: shop.id, reportId, authorPersonId: diver, body: "Saw the ascent." });
    expect(await erase(db, shop.id, diver, owner)).toMatchObject({ reason: "incident_hold" });
  });

  // Attacker review S5: the link cannot be edited away while the hold stands.
  it("will not take a person off a held draft", async () => {
    const { db, shop, owner, diver, elsewhere } = await setting();
    const reportId = await report(db, {
      shopId: shop.id,
      tripId: elsewhere.id,
      createdBy: owner,
      held: true,
    });
    const [row] = await db
      .insert(incidentReportPeople)
      .values({ shopId: shop.id, reportId, personId: diver, involvement: "witness" })
      .returning({ id: incidentReportPeople.id });
    if (!row) throw new Error("row missing");
    expect(
      await removeIncidentPerson(db, {
        shopId: shop.id,
        reportId,
        tripId: elsewhere.id,
        rowId: row.id,
        actorPersonId: owner,
      }),
    ).toEqual({ ok: false, reason: "held" });
    expect(await erase(db, shop.id, diver, owner)).toMatchObject({ reason: "incident_hold" });
  });

  it("erases once the hold is released", async () => {
    const { db, shop, owner, diver, tripId } = await setting();
    const reportId = await report(db, { shopId: shop.id, tripId, createdBy: owner, held: true });
    expect(await erase(db, shop.id, diver, owner)).toMatchObject({ reason: "incident_hold" });
    await db
      .update(incidentReports)
      .set({ legalHoldAt: null })
      .where(eq(incidentReports.id, reportId));
    expect(await erase(db, shop.id, diver, owner)).toMatchObject({ ok: true });
    expect(await isErased(db, diver)).toBe(true);
  });

  it("erases past an unheld report on their departure", async () => {
    const { db, shop, owner, diver, tripId } = await setting();
    await report(db, { shopId: shop.id, tripId, createdBy: owner, held: false });
    expect(await erase(db, shop.id, diver, owner)).toMatchObject({ ok: true });
  });

  it("erases past a held report on a departure they have no link to", async () => {
    const { db, shop, owner, diver, elsewhere } = await setting();
    await report(db, { shopId: shop.id, tripId: elsewhere.id, createdBy: owner, held: true });
    expect(await erase(db, shop.id, diver, owner)).toMatchObject({ ok: true });
  });
});
