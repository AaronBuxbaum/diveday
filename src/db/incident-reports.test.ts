import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { IncidentDraftFields } from "@/lib/incident-reports";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import type { AppDb } from "./client";
import {
  addIncidentAddendum,
  addIncidentPerson,
  fileIncidentReport,
  getIncidentReport,
  listShopIncidentReports,
  listTripIncidentReports,
  removeIncidentPerson,
  saveIncidentDraft,
  startIncidentReport,
} from "./incident-reports";
import { pruneExpiredRecords } from "./retention";
import {
  activityEvents,
  incidentReportAddenda,
  incidentReportPeople,
  incidentReports,
  tripAssignments,
} from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

// One seeded database for the file and a rolled-back transaction per test:
// every test writes its own report and reads it back.
const ctx = fileScopedShopContext();

const OTHER_SHOP = "99999999-8888-4777-8666-555555555555";

const complete: IncidentDraftFields = {
  occurredAt: new Date("2026-10-01T15:20:00Z"),
  diveSiteId: null,
  locationText: "North wall mooring",
  whatHappened: "Diver surfaced coughing after a fast ascent from 18 m.",
  firstAidGiven: true,
  oxygenGiven: true,
  oxygenMinutes: 25,
  emergencyServicesCalled: false,
  handoverKind: "diver",
  handoverDetail: null,
  handedOverAt: new Date("2026-10-01T16:30:00Z"),
  followUp: null,
};

/**
 * A booked departure, a crew member on it (the divemaster), staff who are not
 * (the captain), and the owner. Crew is set here rather than read from the
 * seed, so the test says who is aboard.
 */
async function fixture(db: AppDb, shopId: string) {
  const trip = (await upcomingTripsWithCounts(db, shopId)).find((row) => row.booked > 0);
  if (!trip) throw new Error("expected a booked trip");
  const [seat] = await getTripRoster(db, shopId, trip.id);
  const staff = await listStaff(db, shopId);
  const byRole = (role: string) => staff.find((member) => member.roles.includes(role))?.person;
  const owner = byRole("owner");
  const crew = byRole("divemaster");
  const ashore = byRole("captain");
  if (!seat || !owner || !crew || !ashore) throw new Error("expected seeded people");
  await db.delete(tripAssignments).where(eq(tripAssignments.tripId, trip.id));
  await db.insert(tripAssignments).values({ tripId: trip.id, personId: crew.id });
  return { trip, seat, owner, crew, ashore };
}

describe("starting a report", () => {
  it("lets the departure's crew and the owner start one, and nobody else", async () => {
    const { db, shop } = ctx;
    const { trip, owner, crew, ashore } = await fixture(db, shop.id);
    expect(
      await startIncidentReport(db, { shopId: shop.id, tripId: trip.id, actorPersonId: crew.id }),
    ).toMatchObject({ ok: true });
    expect(
      await startIncidentReport(db, { shopId: shop.id, tripId: trip.id, actorPersonId: owner.id }),
    ).toMatchObject({ ok: true });
    expect(
      await startIncidentReport(db, {
        shopId: shop.id,
        tripId: trip.id,
        actorPersonId: ashore.id,
      }),
    ).toEqual({ ok: false, reason: "not_allowed" });
  });

  it("refuses another shop's departure as if it did not exist", async () => {
    const { db, shop } = ctx;
    const { trip, owner } = await fixture(db, shop.id);
    expect(
      await startIncidentReport(db, {
        shopId: OTHER_SHOP,
        tripId: trip.id,
        actorPersonId: owner.id,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("a draft, then a filed report", () => {
  async function draftBy(personId: string) {
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    const started = await startIncidentReport(db, {
      shopId: shop.id,
      tripId: f.trip.id,
      actorPersonId: personId === "crew" ? f.crew.id : f.owner.id,
    });
    if (!started.ok) throw new Error("expected a draft");
    return { ...f, reportId: started.reportId };
  }

  it("refuses to file until when, what, and the three yes/no questions are answered", async () => {
    const { db, shop } = ctx;
    const { reportId, crew } = await draftBy("crew");
    expect(
      await fileIncidentReport(db, { shopId: shop.id, reportId, actorPersonId: crew.id }),
    ).toEqual({
      ok: false,
      reason: "incomplete",
      gaps: ["occurred_at", "what_happened", "first_aid", "oxygen", "emergency_services"],
    });
  });

  it("files a complete draft, writes the actor-only activity line, and freezes the report", async () => {
    const { db, shop } = ctx;
    const { reportId, crew, trip } = await draftBy("crew");
    expect(
      await saveIncidentDraft(db, {
        shopId: shop.id,
        reportId,
        actorPersonId: crew.id,
        fields: complete,
      }),
    ).toEqual({ ok: true });
    expect(
      await fileIncidentReport(db, { shopId: shop.id, reportId, actorPersonId: crew.id }),
    ).toEqual({ ok: true });

    const [line] = await db
      .select()
      .from(activityEvents)
      .where(
        and(eq(activityEvents.tripId, trip.id), eq(activityEvents.code, "incident_report_filed")),
      );
    // Who filed it, and nothing about who was hurt.
    expect(line?.params).toEqual({ actor: crew.fullName });

    expect(
      await saveIncidentDraft(db, {
        shopId: shop.id,
        reportId,
        actorPersonId: crew.id,
        fields: { ...complete, whatHappened: "Rewritten after the fact." },
      }),
    ).toEqual({ ok: false, reason: "filed" });
    expect(
      await fileIncidentReport(db, { shopId: shop.id, reportId, actorPersonId: crew.id }),
    ).toEqual({ ok: false, reason: "filed" });
    const view = await getIncidentReport(db, shop.id, reportId, crew.id);
    expect(view?.status).toBe("filed");
    expect(view?.fields.whatHappened).toBe(complete.whatHappened);
    expect(view?.filedByName).toBe(crew.fullName);
  });

  it("drops oxygen minutes that stand beside a no", async () => {
    const { db, shop } = ctx;
    const { reportId, crew } = await draftBy("crew");
    await saveIncidentDraft(db, {
      shopId: shop.id,
      reportId,
      actorPersonId: crew.id,
      fields: { ...complete, oxygenGiven: false, oxygenMinutes: 10 },
    });
    const view = await getIncidentReport(db, shop.id, reportId, crew.id);
    expect(view?.fields.oxygenMinutes).toBeNull();
  });

  it("refuses a dive site from another shop", async () => {
    const { db, shop } = ctx;
    const { reportId, crew } = await draftBy("crew");
    expect(
      await saveIncidentDraft(db, {
        shopId: shop.id,
        reportId,
        actorPersonId: crew.id,
        fields: { ...complete, diveSiteId: OTHER_SHOP },
      }),
    ).toEqual({ ok: false, reason: "site_not_found" });
  });

  it("takes addenda only once filed, each attributed, with its own activity line", async () => {
    const { db, shop } = ctx;
    const { reportId, crew, owner, trip } = await draftBy("crew");
    expect(
      await addIncidentAddendum(db, {
        shopId: shop.id,
        reportId,
        actorPersonId: crew.id,
        body: "Too early",
      }),
    ).toEqual({ ok: false, reason: "draft" });
    await saveIncidentDraft(db, {
      shopId: shop.id,
      reportId,
      actorPersonId: crew.id,
      fields: complete,
    });
    await fileIncidentReport(db, { shopId: shop.id, reportId, actorPersonId: crew.id });
    expect(
      await addIncidentAddendum(db, {
        shopId: shop.id,
        reportId,
        actorPersonId: owner.id,
        body: "   ",
      }),
    ).toEqual({ ok: false, reason: "blank" });
    expect(
      await addIncidentAddendum(db, {
        shopId: shop.id,
        reportId,
        actorPersonId: owner.id,
        body: "Diver called: discharged from the clinic, no treatment needed.",
      }),
    ).toEqual({ ok: true });
    const view = await getIncidentReport(db, shop.id, reportId, owner.id);
    expect(view?.addenda).toMatchObject([
      {
        body: "Diver called: discharged from the clinic, no treatment needed.",
        authorName: owner.fullName,
      },
    ]);
    const lines = await db
      .select()
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.tripId, trip.id),
          eq(activityEvents.code, "incident_report_addendum_added"),
        ),
      );
    expect(lines).toHaveLength(1);
  });
});

describe("who reads what", () => {
  it("shows a crew member their own reports and the owner every report", async () => {
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    const mine = await startIncidentReport(db, {
      shopId: shop.id,
      tripId: f.trip.id,
      actorPersonId: f.crew.id,
    });
    const owners = await startIncidentReport(db, {
      shopId: shop.id,
      tripId: f.trip.id,
      actorPersonId: f.owner.id,
    });
    if (!mine.ok || !owners.ok) throw new Error("expected two drafts");

    const crewList = await listTripIncidentReports(db, shop.id, f.trip.id, f.crew.id);
    expect(crewList.mayStart).toBe(true);
    expect(crewList.reports.map((row) => row.id)).toEqual([mine.reportId]);
    expect(await getIncidentReport(db, shop.id, owners.reportId, f.crew.id)).toBeNull();

    const ownerList = await listTripIncidentReports(db, shop.id, f.trip.id, f.owner.id);
    expect(ownerList.reports.map((row) => row.id).sort()).toEqual(
      [mine.reportId, owners.reportId].sort(),
    );

    // Not on the crew, not an owner: nothing, and no door.
    const ashore = await listTripIncidentReports(db, shop.id, f.trip.id, f.ashore.id);
    expect(ashore).toEqual({ mayStart: false, reports: [] });
    // And a foreign shop's id reads as nothing at all.
    expect(await getIncidentReport(db, OTHER_SHOP, mine.reportId, f.owner.id)).toBeNull();
  });

  it("refuses another staffer's draft to anyone but its author and the owner", async () => {
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    const owners = await startIncidentReport(db, {
      shopId: shop.id,
      tripId: f.trip.id,
      actorPersonId: f.owner.id,
    });
    if (!owners.ok) throw new Error("expected a draft");
    expect(
      await saveIncidentDraft(db, {
        shopId: shop.id,
        reportId: owners.reportId,
        actorPersonId: f.crew.id,
        fields: complete,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("lists the shop's reports by when they happened, for owners and managers only", async () => {
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    const started = await startIncidentReport(db, {
      shopId: shop.id,
      tripId: f.trip.id,
      actorPersonId: f.crew.id,
    });
    if (!started.ok) throw new Error("expected a draft");
    await saveIncidentDraft(db, {
      shopId: shop.id,
      reportId: started.reportId,
      actorPersonId: f.crew.id,
      fields: complete,
    });
    const october = [new Date("2026-10-01T00:00:00Z"), new Date("2026-11-01T00:00:00Z")] as const;
    expect(
      (await listShopIncidentReports(db, shop.id, f.owner.id, ...october)).map((row) => row.id),
    ).toContain(started.reportId);
    expect(await listShopIncidentReports(db, shop.id, f.crew.id, ...october)).toEqual([]);
    const september = [new Date("2026-09-01T00:00:00Z"), new Date("2026-10-01T00:00:00Z")] as const;
    expect(
      (await listShopIncidentReports(db, shop.id, f.owner.id, ...september)).map((row) => row.id),
    ).not.toContain(started.reportId);
  });
});

describe("the people in a report", () => {
  it("names a diver by their seat on this departure, a staffer, and an outsider, once each", async () => {
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    const started = await startIncidentReport(db, {
      shopId: shop.id,
      tripId: f.trip.id,
      actorPersonId: f.crew.id,
    });
    if (!started.ok) throw new Error("expected a draft");
    const base = { shopId: shop.id, reportId: started.reportId, actorPersonId: f.crew.id };
    expect(
      await addIncidentPerson(db, {
        ...base,
        subject: { kind: "booking", bookingId: f.seat.booking.id },
        involvement: "affected",
      }),
    ).toEqual({ ok: true });
    expect(
      await addIncidentPerson(db, {
        ...base,
        subject: { kind: "booking", bookingId: f.seat.booking.id },
        involvement: "witness",
      }),
    ).toEqual({ ok: false, reason: "already_listed" });
    expect(
      await addIncidentPerson(db, {
        ...base,
        subject: { kind: "staff", personId: f.crew.id },
        involvement: "responder",
      }),
    ).toEqual({ ok: true });
    // A diver is never named as staff: their seat is the handle erasure follows.
    expect(
      await addIncidentPerson(db, {
        ...base,
        subject: { kind: "staff", personId: f.seat.person.id },
        involvement: "witness",
      }),
    ).toEqual({ ok: false, reason: "subject_not_found" });
    expect(
      await addIncidentPerson(db, {
        ...base,
        subject: { kind: "outsider", name: "Skipper of the Marlin" },
        involvement: "witness",
      }),
    ).toEqual({ ok: true });

    const view = await getIncidentReport(db, shop.id, started.reportId, f.crew.id);
    expect(view?.people.map((person) => [person.kind, person.name, person.involvement])).toEqual([
      ["booking", f.seat.person.fullName, "affected"],
      ["outsider", "Skipper of the Marlin", "witness"],
      ["staff", f.crew.fullName, "responder"],
    ]);

    const outsider = view?.people[1];
    if (!outsider) throw new Error("expected the outsider");
    expect(await removeIncidentPerson(db, { ...base, rowId: outsider.id })).toEqual({ ok: true });
    expect(
      (await getIncidentReport(db, shop.id, started.reportId, f.crew.id))?.people,
    ).toHaveLength(2);
  });

  it("refuses a seat from another departure", async () => {
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    const other = (await upcomingTripsWithCounts(db, shop.id)).find(
      (row) => row.booked > 0 && row.id !== f.trip.id,
    );
    if (!other) throw new Error("expected a second booked trip");
    const [otherSeat] = await getTripRoster(db, shop.id, other.id);
    if (!otherSeat) throw new Error("expected a seat");
    const started = await startIncidentReport(db, {
      shopId: shop.id,
      tripId: f.trip.id,
      actorPersonId: f.crew.id,
    });
    if (!started.ok) throw new Error("expected a draft");
    expect(
      await addIncidentPerson(db, {
        shopId: shop.id,
        reportId: started.reportId,
        actorPersonId: f.crew.id,
        subject: { kind: "booking", bookingId: otherSeat.booking.id },
        involvement: "affected",
      }),
    ).toEqual({ ok: false, reason: "subject_not_found" });
  });
});

describe("erasing a diver named in a report", () => {
  it("keeps the report and removes the diver's identity from it", async () => {
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    const name = f.seat.person.fullName;
    const started = await startIncidentReport(db, {
      shopId: shop.id,
      tripId: f.trip.id,
      actorPersonId: f.crew.id,
    });
    if (!started.ok) throw new Error("expected a draft");
    const base = { shopId: shop.id, reportId: started.reportId, actorPersonId: f.crew.id };
    await saveIncidentDraft(db, {
      ...base,
      fields: { ...complete, whatHappened: `${name} surfaced coughing. Oxygen started at once.` },
    });
    await addIncidentPerson(db, {
      ...base,
      subject: { kind: "booking", bookingId: f.seat.booking.id },
      involvement: "affected",
    });
    await addIncidentPerson(db, {
      ...base,
      subject: { kind: "outsider", name },
      involvement: "witness",
    });
    await fileIncidentReport(db, base);
    await addIncidentAddendum(db, { ...base, body: `Called ${name.toUpperCase()} the next day.` });

    expect(
      await anonymizeDiver(db, {
        shopId: shop.id,
        personId: f.seat.person.id,
        actorPersonId: f.owner.id,
      }),
    ).toMatchObject({ ok: true });

    const view = await getIncidentReport(db, shop.id, started.reportId, f.owner.id);
    expect(view?.status).toBe("filed");
    expect(view?.fields.whatHappened).toBe("[redacted] surfaced coughing. Oxygen started at once.");
    expect(view?.fields.oxygenMinutes).toBe(25);
    expect(view?.addenda[0]?.body).toBe("Called [redacted] the next day.");
    expect(JSON.stringify(view)).not.toContain(name);
    // The seat link stays, under the erased name.
    expect(view?.people.map((person) => [person.kind, person.involvement])).toEqual([
      ["booking", "affected"],
      ["outsider", "witness"],
    ]);
  });
});

describe("retention", () => {
  it("prunes a report seven years after the incident, with its people and addenda", async () => {
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    const started = await startIncidentReport(db, {
      shopId: shop.id,
      tripId: f.trip.id,
      actorPersonId: f.crew.id,
    });
    if (!started.ok) throw new Error("expected a draft");
    const base = { shopId: shop.id, reportId: started.reportId, actorPersonId: f.crew.id };
    await saveIncidentDraft(db, { ...base, fields: complete });
    await addIncidentPerson(db, {
      ...base,
      subject: { kind: "outsider", name: "Harbor master" },
      involvement: "witness",
    });
    await fileIncidentReport(db, base);
    await addIncidentAddendum(db, { ...base, body: "Closed." });

    const justInside = new Date(complete.occurredAt!.getTime() + 2554 * 86_400_000);
    await pruneExpiredRecords(db, { now: justInside });
    expect(
      await db.select().from(incidentReports).where(eq(incidentReports.id, started.reportId)),
    ).toHaveLength(1);

    const past = new Date(complete.occurredAt!.getTime() + 2556 * 86_400_000);
    await pruneExpiredRecords(db, { now: past });
    expect(
      await db.select().from(incidentReports).where(eq(incidentReports.id, started.reportId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(incidentReportPeople)
        .where(eq(incidentReportPeople.reportId, started.reportId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(incidentReportAddenda)
        .where(eq(incidentReportAddenda.reportId, started.reportId)),
    ).toHaveLength(0);
  });
});
