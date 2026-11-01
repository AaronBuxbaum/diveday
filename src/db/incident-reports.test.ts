import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate, nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { demoteOwnerToManager } from "@/test/staff-session";
import { anonymizeDiver } from "./anonymize";
import { loadShopExportBundleInput } from "./export";
import {
  addIncidentAddendum,
  addIncidentPerson,
  discardIncidentDraft,
  fileIncidentReport,
  getIncidentReport,
  listDepartureLogIncidentReports,
  listIncidentSeatChoices,
  listShopIncidentReports,
  listTripIncidentReports,
  listUnfiledIncidentDrafts,
  removeIncidentPerson,
  saveIncidentDraft,
  setIncidentLegalHold,
  startIncidentReport,
} from "./incident-reports";
import {
  blank,
  complete,
  draftsBy,
  fixture,
  OCCURRED_AT,
  OTHER_SHOP,
  OTHER_TRIP,
} from "./incident-reports-test-fixtures";
import { pruneExpiredRecords } from "./retention";
import {
  activityEvents,
  bookings,
  incidentReportAddenda,
  incidentReportPeople,
  incidentReports,
  trips,
} from "./schema";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";

// One seeded database for the file and a rolled-back transaction per test:
// every test writes its own report and reads it back.
const ctx = fileScopedShopContext();

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

  it("opens the writer's own unfiled draft on a second tap rather than starting another", async () => {
    const { db, shop } = ctx;
    const { trip, crew } = await fixture(db, shop.id);
    const input = { shopId: shop.id, tripId: trip.id, actorPersonId: crew.id };
    const first = await startIncidentReport(db, input);
    const second = await startIncidentReport(db, input);
    expect(first).toMatchObject({ ok: true, reused: false });
    expect(second).toMatchObject({ ok: true, reused: true });
    if (!first.ok || !second.ok) throw new Error("expected drafts");
    expect(second.reportId).toBe(first.reportId);
    expect(await draftsBy(db, trip.id, crew.id)).toBe(1);
  });

  it("starts a new report once the writer's open draft says anything at all", async () => {
    // Domain review 2026-10-16: reuse is for a double tap, never for a second
    // incident. A writer with an open draft about one thing must still be able
    // to start a report about another.
    const { db, shop } = ctx;
    const { trip, crew, seat } = await fixture(db, shop.id);
    const input = { shopId: shop.id, tripId: trip.id, actorPersonId: crew.id };
    const written = await startIncidentReport(db, input);
    if (!written.ok) throw new Error("expected a draft");
    await saveIncidentDraft(db, {
      ...input,
      reportId: written.reportId,
      fields: { ...blank, whatHappened: "Regulator free-flowing at 12 m." },
    });
    const second = await startIncidentReport(db, input);
    if (!second.ok) throw new Error("expected a draft");
    expect(second).toMatchObject({ reused: false });
    expect(second.reportId).not.toBe(written.reportId);

    // A draft naming somebody is not untouched either.
    await addIncidentPerson(db, {
      ...input,
      reportId: second.reportId,
      subject: { kind: "booking", bookingId: seat.booking.id },
      involvement: "witness",
    });
    const third = await startIncidentReport(db, input);
    if (!third.ok) throw new Error("expected a draft");
    expect(third.reportId).not.toBe(second.reportId);
    expect(await draftsBy(db, trip.id, crew.id)).toBe(3);
  });

  it("never hands one writer somebody else's draft", async () => {
    const { db, shop } = ctx;
    const { trip, crew, owner } = await fixture(db, shop.id);
    const crews = await startIncidentReport(db, {
      shopId: shop.id,
      tripId: trip.id,
      actorPersonId: crew.id,
    });
    // The owner may read the crew's draft, and still gets one of their own:
    // reuse is the writer's own draft, never the departure's.
    const owners = await startIncidentReport(db, {
      shopId: shop.id,
      tripId: trip.id,
      actorPersonId: owner.id,
    });
    if (!crews.ok || !owners.ok) throw new Error("expected drafts");
    expect(owners.reportId).not.toBe(crews.reportId);
    expect(owners.reused).toBe(false);
  });

  it("starts a fresh draft once the writer's last one is filed", async () => {
    const { db, shop } = ctx;
    const { trip, crew } = await fixture(db, shop.id);
    const input = { shopId: shop.id, tripId: trip.id, actorPersonId: crew.id };
    const first = await startIncidentReport(db, input);
    if (!first.ok) throw new Error("expected a draft");
    await saveIncidentDraft(db, { ...input, reportId: first.reportId, fields: complete });
    expect(await fileIncidentReport(db, { ...input, reportId: first.reportId })).toEqual({
      ok: true,
    });
    const next = await startIncidentReport(db, input);
    expect(next).toMatchObject({ ok: true, reused: false });
    if (!next.ok) throw new Error("expected a draft");
    expect(next.reportId).not.toBe(first.reportId);
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
    return { ...f, reportId: started.reportId, tripId: f.trip.id };
  }

  it("refuses to file until when, what, its kind and severity, and the three yes/no questions are answered", async () => {
    const { db, shop } = ctx;
    const { reportId, tripId, crew } = await draftBy("crew");
    expect(
      await fileIncidentReport(db, { shopId: shop.id, reportId, tripId, actorPersonId: crew.id }),
    ).toEqual({
      ok: false,
      reason: "incomplete",
      gaps: [
        "occurred_at",
        "location",
        "what_happened",
        "kind",
        "severity",
        "first_aid",
        "oxygen",
        "emergency_services",
      ],
    });
  });

  it("answers a write under another departure's address as if the report did not exist", async () => {
    const { db, shop } = ctx;
    const { reportId, crew } = await draftBy("crew");
    const elsewhere = { shopId: shop.id, reportId, tripId: OTHER_TRIP, actorPersonId: crew.id };
    expect(await saveIncidentDraft(db, { ...elsewhere, fields: complete })).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await fileIncidentReport(db, elsewhere)).toEqual({ ok: false, reason: "not_found" });
    expect(
      await addIncidentPerson(db, {
        ...elsewhere,
        subject: { kind: "outsider", name: "Boat skipper" },
        involvement: "witness",
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a note or a name longer than the record holds", async () => {
    const { db, shop } = ctx;
    const { reportId, tripId, crew } = await draftBy("crew");
    const base = { shopId: shop.id, reportId, tripId, actorPersonId: crew.id };
    expect(
      await addIncidentPerson(db, {
        ...base,
        subject: { kind: "outsider", name: "x".repeat(201) },
        involvement: "witness",
      }),
    ).toEqual({ ok: false, reason: "too_long" });
    await saveIncidentDraft(db, { ...base, fields: complete });
    await fileIncidentReport(db, base);
    expect(await addIncidentAddendum(db, { ...base, body: "x".repeat(5001) })).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  it("files a complete draft, writes the actor-only activity line, and freezes the report", async () => {
    const { db, shop } = ctx;
    const { reportId, tripId, crew, trip } = await draftBy("crew");
    expect(
      await saveIncidentDraft(db, {
        shopId: shop.id,
        reportId,
        tripId,
        actorPersonId: crew.id,
        fields: complete,
      }),
    ).toEqual({ ok: true });
    expect(
      await fileIncidentReport(db, { shopId: shop.id, reportId, tripId, actorPersonId: crew.id }),
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
        tripId,
        actorPersonId: crew.id,
        fields: { ...complete, whatHappened: "Rewritten after the fact." },
      }),
    ).toEqual({ ok: false, reason: "filed" });
    expect(
      await fileIncidentReport(db, { shopId: shop.id, reportId, tripId, actorPersonId: crew.id }),
    ).toEqual({ ok: false, reason: "filed" });
    const view = await getIncidentReport(db, shop.id, reportId, crew.id);
    expect(view?.status).toBe("filed");
    expect(view?.fields.whatHappened).toBe(complete.whatHappened);
    expect(view?.filedByName).toBe(crew.fullName);
  });

  it("files a fatality as its own kind, and the shop export says so", async () => {
    // Dive-domain review 20261014: a death is not "injury, serious".
    const { db, shop } = ctx;
    const { reportId, tripId, crew } = await draftBy("crew");
    const fields = { ...complete, kind: "fatality" as const, severity: "serious" as const };
    expect(
      await saveIncidentDraft(db, {
        shopId: shop.id,
        reportId,
        tripId,
        actorPersonId: crew.id,
        fields,
      }),
    ).toEqual({ ok: true });
    expect(
      await fileIncidentReport(db, { shopId: shop.id, reportId, tripId, actorPersonId: crew.id }),
    ).toEqual({ ok: true });
    expect((await getIncidentReport(db, shop.id, reportId, crew.id))?.fields.kind).toBe("fatality");

    const input = await loadShopExportBundleInput(db, shop.id);
    const file = input?.tables.find((candidate) => candidate.file === "incident_reports.csv");
    if (!file) throw new Error("expected the incident export");
    const kindColumn = file.header.indexOf("kind");
    const row = file.rows.find((candidate) => candidate.includes(reportId));
    expect(row?.[kindColumn]).toBe("fatality");
  });

  it("drops oxygen minutes that stand beside a no", async () => {
    const { db, shop } = ctx;
    const { reportId, tripId, crew } = await draftBy("crew");
    await saveIncidentDraft(db, {
      shopId: shop.id,
      reportId,
      tripId,
      actorPersonId: crew.id,
      fields: { ...complete, oxygenGiven: false, oxygenMinutes: 10 },
    });
    const view = await getIncidentReport(db, shop.id, reportId, crew.id);
    expect(view?.fields.oxygenMinutes).toBeNull();
  });

  it("refuses a dive site from another shop", async () => {
    const { db, shop } = ctx;
    const { reportId, tripId, crew } = await draftBy("crew");
    expect(
      await saveIncidentDraft(db, {
        shopId: shop.id,
        reportId,
        tripId,
        actorPersonId: crew.id,
        fields: { ...complete, diveSiteId: OTHER_SHOP },
      }),
    ).toEqual({ ok: false, reason: "site_not_found" });
  });

  it("takes addenda only once filed, each attributed, with its own activity line", async () => {
    const { db, shop } = ctx;
    const { reportId, tripId, crew, owner, trip } = await draftBy("crew");
    expect(
      await addIncidentAddendum(db, {
        shopId: shop.id,
        reportId,
        tripId,
        actorPersonId: crew.id,
        body: "Too early",
      }),
    ).toEqual({ ok: false, reason: "draft" });
    await saveIncidentDraft(db, {
      shopId: shop.id,
      reportId,
      tripId,
      actorPersonId: crew.id,
      fields: complete,
    });
    await fileIncidentReport(db, { shopId: shop.id, reportId, tripId, actorPersonId: crew.id });
    expect(
      await addIncidentAddendum(db, {
        shopId: shop.id,
        reportId,
        tripId,
        actorPersonId: owner.id,
        body: "   ",
      }),
    ).toEqual({ ok: false, reason: "blank" });
    expect(
      await addIncidentAddendum(db, {
        shopId: shop.id,
        reportId,
        tripId,
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
        tripId: f.trip.id,
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
      tripId: f.trip.id,
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

  it("lists a departure's reports for its log to owners and managers only", async () => {
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    const started = await startIncidentReport(db, {
      shopId: shop.id,
      tripId: f.trip.id,
      actorPersonId: f.crew.id,
    });
    if (!started.ok) throw new Error("expected a draft");
    const forOwner = await listDepartureLogIncidentReports(db, shop.id, f.trip.id, f.owner.id);
    expect(forOwner?.map((row) => row.reportId)).toContain(started.reportId);
    // The writer reads their own report, but not the departure's list of them,
    // and a refusal is null rather than an empty list, so a log built for them
    // fails closed instead of saying the departure has no reports (auditor
    // review 2026-10-16, item 12).
    expect(await listDepartureLogIncidentReports(db, shop.id, f.trip.id, f.crew.id)).toBeNull();
    expect(await listDepartureLogIncidentReports(db, OTHER_SHOP, f.trip.id, f.owner.id)).toBeNull();
  });

  it("lists the shop's unfiled drafts, oldest first, to owners and managers only", async () => {
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    await db.delete(incidentReports).where(eq(incidentReports.shopId, shop.id));
    const input = { shopId: shop.id, tripId: f.trip.id, actorPersonId: f.crew.id };
    const filed = await startIncidentReport(db, input);
    if (!filed.ok) throw new Error("expected a draft");
    await saveIncidentDraft(db, { ...input, reportId: filed.reportId, fields: complete });
    await fileIncidentReport(db, { ...input, reportId: filed.reportId });
    const crews = await startIncidentReport(db, input);
    const owners = await startIncidentReport(db, { ...input, actorPersonId: f.owner.id });
    if (!crews.ok || !owners.ok) throw new Error("expected drafts");
    // The clock is frozen, so age the owner's draft by hand: it is the oldest.
    await db
      .update(incidentReports)
      .set({ createdAt: new Date(nowMs() - 60 * 60 * 1000) })
      .where(eq(incidentReports.id, owners.reportId));

    const listed = await listUnfiledIncidentDrafts(db, shop.id, f.owner.id);
    // A filed report is not waiting on anyone; both drafts are, whoever wrote them.
    expect(listed.map((row) => row.id)).toEqual([owners.reportId, crews.reportId]);
    expect(listed[1]).toMatchObject({ tripId: f.trip.id, createdByName: f.crew.fullName });
    // The writer of a draft still may not see the shop's list of them.
    expect(await listUnfiledIncidentDrafts(db, shop.id, f.crew.id)).toEqual([]);
    expect(await listUnfiledIncidentDrafts(db, shop.id, f.ashore.id)).toEqual([]);
    expect(await listUnfiledIncidentDrafts(db, OTHER_SHOP, f.owner.id)).toEqual([]);
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
    const base = {
      shopId: shop.id,
      reportId: started.reportId,
      tripId: f.trip.id,
      actorPersonId: f.crew.id,
    };
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
        tripId: f.trip.id,
        actorPersonId: f.crew.id,
        subject: { kind: "booking", bookingId: otherSeat.booking.id },
        involvement: "affected",
      }),
    ).toEqual({ ok: false, reason: "subject_not_found" });
  });
});

describe("erasing a diver named in a report", () => {
  it("keeps the report and unlinks the diver, leaving the words staff wrote", async () => {
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    const name = f.seat.person.fullName;
    const started = await startIncidentReport(db, {
      shopId: shop.id,
      tripId: f.trip.id,
      actorPersonId: f.crew.id,
    });
    if (!started.ok) throw new Error("expected a draft");
    const base = {
      shopId: shop.id,
      reportId: started.reportId,
      tripId: f.trip.id,
      actorPersonId: f.crew.id,
    };
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
    expect(view?.fields.whatHappened).toBe(`${name} surfaced coughing. Oxygen started at once.`);
    expect(view?.fields.oxygenMinutes).toBe(25);
    expect(view?.addenda[0]?.body).toBe(`Called ${name.toUpperCase()} the next day.`);
    // The seat link stays, under the erased name.
    expect(view?.people.map((person) => [person.kind, person.involvement])).toEqual([
      ["booking", "affected"],
      ["outsider", "witness"],
    ]);
    expect(JSON.stringify(view?.people)).not.toContain(name);
  });
});

describe("erasing a diver named in a report under a legal hold", () => {
  /** Erasure wins over the hold on personal fields; the hold keeps the report itself (#2391). */
  it("unlinks the diver and still keeps the report", async () => {
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    const name = f.seat.person.fullName;
    const started = await startIncidentReport(db, {
      shopId: shop.id,
      tripId: f.trip.id,
      actorPersonId: f.crew.id,
    });
    if (!started.ok) throw new Error("expected a draft");
    const base = {
      shopId: shop.id,
      reportId: started.reportId,
      tripId: f.trip.id,
      actorPersonId: f.crew.id,
    };
    await saveIncidentDraft(db, {
      ...base,
      fields: { ...complete, whatHappened: `${name} surfaced coughing.` },
    });
    await fileIncidentReport(db, base);
    expect(
      await setIncidentLegalHold(db, { ...base, actorPersonId: f.owner.id, held: true }),
    ).toEqual({ ok: true });

    expect(
      await anonymizeDiver(db, {
        shopId: shop.id,
        personId: f.seat.person.id,
        actorPersonId: f.owner.id,
      }),
    ).toMatchObject({ ok: true });

    const view = await getIncidentReport(db, shop.id, started.reportId, f.owner.id);
    expect(view?.status).toBe("filed");
    expect(view?.fields.whatHappened).toBe(`${name} surfaced coughing.`);
    const [row] = await db
      .select({ heldAt: incidentReports.legalHoldAt, deletedAt: incidentReports.deletedAt })
      .from(incidentReports)
      .where(eq(incidentReports.id, started.reportId));
    expect(row?.heldAt).not.toBeNull();
    expect(row?.deletedAt).toBeNull();
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
    const base = {
      shopId: shop.id,
      reportId: started.reportId,
      tripId: f.trip.id,
      actorPersonId: f.crew.id,
    };
    await saveIncidentDraft(db, { ...base, fields: complete });
    await addIncidentPerson(db, {
      ...base,
      subject: { kind: "outsider", name: "Harbor master" },
      involvement: "witness",
    });
    await fileIncidentReport(db, base);
    await addIncidentAddendum(db, { ...base, body: "Closed." });

    const justInside = new Date(OCCURRED_AT.getTime() + 2554 * 86_400_000);
    await pruneExpiredRecords(db, { now: justInside });
    expect(
      await db.select().from(incidentReports).where(eq(incidentReports.id, started.reportId)),
    ).toHaveLength(1);

    const past = new Date(OCCURRED_AT.getTime() + 2556 * 86_400_000);
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

describe("a held seat in a report", () => {
  it("is named as booked, never as the person it was matched to", async () => {
    // Domain re-review 2026-10-16, item 5 (issue #2128): a held seat's matched
    // person may be somebody else entirely, so their name is not this diver's.
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    await db
      .update(bookings)
      .set({
        identityUnconfirmedAt: new Date("2026-07-01T12:00:00Z"),
        identityBookedAs: " Jo Smith ",
      })
      .where(eq(bookings.id, f.seat.booking.id));
    const matchedName = f.seat.person.fullName;
    expect(matchedName).not.toBe("Jo Smith");

    const choices = await listIncidentSeatChoices(db, shop.id, f.trip.id);
    expect(choices).toContainEqual({ bookingId: f.seat.booking.id, name: "Jo Smith" });
    expect(choices.some((choice) => choice.name === matchedName)).toBe(false);

    const started = await startIncidentReport(db, {
      shopId: shop.id,
      tripId: f.trip.id,
      actorPersonId: f.owner.id,
    });
    if (!started.ok) throw new Error("expected a draft");
    expect(
      await addIncidentPerson(db, {
        shopId: shop.id,
        tripId: f.trip.id,
        reportId: started.reportId,
        actorPersonId: f.owner.id,
        subject: { kind: "booking", bookingId: f.seat.booking.id },
        involvement: "affected",
      }),
    ).toEqual({ ok: true });
    const view = await getIncidentReport(db, shop.id, started.reportId, f.owner.id);
    expect(view?.people.map((person) => person.name)).toEqual(["Jo Smith"]);
    expect(JSON.stringify(view)).not.toContain(matchedName);
  });
});

describe("discarding a draft", () => {
  async function draftBy(personId: string) {
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    const started = await startIncidentReport(db, {
      shopId: shop.id,
      tripId: f.trip.id,
      actorPersonId: personId,
    });
    if (!started.ok) throw new Error("expected a draft");
    const target = (actor: string) => ({
      shopId: shop.id,
      reportId: started.reportId,
      tripId: f.trip.id,
      actorPersonId: actor,
    });
    const row = async () =>
      (await db.select().from(incidentReports).where(eq(incidentReports.id, started.reportId)))[0];
    return { db, shop, f, started, target, row };
  }

  it("lets an owner delete a mistaken draft: the row stays, no screen shows it, the trail says who", async () => {
    const d = await draftBy((await fixture(ctx.db, ctx.shop.id)).crew.id);
    expect(await discardIncidentDraft(d.db, d.target(d.f.owner.id))).toEqual({ ok: true });
    expect((await d.row())?.deletedAt).not.toBeNull();
    // Gone to the departure's list, the shop's list, the page, and every write.
    const list = await listTripIncidentReports(d.db, d.shop.id, d.f.trip.id, d.f.owner.id);
    expect(list.reports).toHaveLength(0);
    const from = new Date("2000-01-01T00:00:00Z");
    const to = new Date("2100-01-01T00:00:00Z");
    expect(await listShopIncidentReports(d.db, d.shop.id, d.f.owner.id, from, to)).toHaveLength(0);
    expect(await getIncidentReport(d.db, d.shop.id, d.started.reportId, d.f.owner.id)).toBeNull();
    expect(await saveIncidentDraft(d.db, { ...d.target(d.f.crew.id), fields: complete })).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await fileIncidentReport(d.db, d.target(d.f.owner.id))).toEqual({
      ok: false,
      reason: "not_found",
    });
    const trail = await d.db
      .select()
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.tripId, d.f.trip.id),
          eq(activityEvents.code, "incident_draft_discarded"),
        ),
      );
    expect(trail).toHaveLength(1);
    expect(JSON.stringify(trail[0])).not.toContain("coughing");
  });

  it("refuses a filed report by every route, and the database refuses it too", async () => {
    const d = await draftBy((await fixture(ctx.db, ctx.shop.id)).crew.id);
    await saveIncidentDraft(d.db, { ...d.target(d.f.crew.id), fields: complete });
    expect(await fileIncidentReport(d.db, d.target(d.f.crew.id))).toEqual({ ok: true });
    expect(await discardIncidentDraft(d.db, d.target(d.f.owner.id))).toEqual({
      ok: false,
      reason: "filed",
    });
    expect((await d.row())?.deletedAt).toBeNull();
    // A hand-written update cannot do what the function refuses.
    await expect(
      d.db.transaction(async (tx) => {
        await tx
          .update(incidentReports)
          .set({ deletedAt: nowDate() })
          .where(eq(incidentReports.id, d.started.reportId));
      }),
    ).rejects.toThrow();
  });

  it("is an owner's call alone: not the draft's author, not a manager, not other crew", async () => {
    const d = await draftBy((await fixture(ctx.db, ctx.shop.id)).crew.id);
    // The author is on the crew and may edit the draft, but may not delete it.
    expect(await discardIncidentDraft(d.db, d.target(d.f.crew.id))).toEqual({
      ok: false,
      reason: "not_allowed",
    });
    // Staff ashore cannot even tell it exists.
    expect(await discardIncidentDraft(d.db, d.target(d.f.ashore.id))).toEqual({
      ok: false,
      reason: "not_found",
    });
    await demoteOwnerToManager(d.db, d.f.owner.id);
    expect(await discardIncidentDraft(d.db, d.target(d.f.owner.id))).toEqual({
      ok: false,
      reason: "not_allowed",
    });
    expect((await d.row())?.deletedAt).toBeNull();
  });

  it("refuses another shop and another departure's address as if the draft did not exist", async () => {
    const d = await draftBy((await fixture(ctx.db, ctx.shop.id)).crew.id);
    expect(
      await discardIncidentDraft(d.db, { ...d.target(d.f.owner.id), shopId: OTHER_SHOP }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(
      await discardIncidentDraft(d.db, { ...d.target(d.f.owner.id), tripId: OTHER_TRIP }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect((await d.row())?.deletedAt).toBeNull();
  });

  it("refuses a draft under a legal hold until the hold is released", async () => {
    const d = await draftBy((await fixture(ctx.db, ctx.shop.id)).crew.id);
    expect(await setIncidentLegalHold(d.db, { ...d.target(d.f.owner.id), held: true })).toEqual({
      ok: true,
    });
    expect(await discardIncidentDraft(d.db, d.target(d.f.owner.id))).toEqual({
      ok: false,
      reason: "held",
    });
    await setIncidentLegalHold(d.db, { ...d.target(d.f.owner.id), held: false });
    expect(await discardIncidentDraft(d.db, d.target(d.f.owner.id))).toEqual({ ok: true });
  });

  it("lets a discarded draft's departure keep reading as a trip with no report", async () => {
    const d = await draftBy((await fixture(ctx.db, ctx.shop.id)).crew.id);
    await discardIncidentDraft(d.db, d.target(d.f.owner.id));
    const [trip] = await d.db.select({ id: trips.id }).from(trips).where(eq(trips.id, d.f.trip.id));
    expect(trip?.id).toBe(d.f.trip.id);
  });
});

describe("a legal hold", () => {
  async function filedReport() {
    const { db, shop } = ctx;
    const f = await fixture(db, shop.id);
    const started = await startIncidentReport(db, {
      shopId: shop.id,
      tripId: f.trip.id,
      actorPersonId: f.crew.id,
    });
    if (!started.ok) throw new Error("expected a draft");
    const base = (actor: string) => ({
      shopId: shop.id,
      reportId: started.reportId,
      tripId: f.trip.id,
      actorPersonId: actor,
    });
    await saveIncidentDraft(db, { ...base(f.crew.id), fields: complete });
    await fileIncidentReport(db, base(f.crew.id));
    return { db, shop, f, started, base };
  }

  it("is the owner's to set and release, and says so on the trail once each", async () => {
    const r = await filedReport();
    expect(await setIncidentLegalHold(r.db, { ...r.base(r.f.owner.id), held: true })).toEqual({
      ok: true,
    });
    // Setting it again changes nothing and writes no second line.
    await setIncidentLegalHold(r.db, { ...r.base(r.f.owner.id), held: true });
    expect(
      (await getIncidentReport(r.db, r.shop.id, r.started.reportId, r.f.owner.id))?.legalHold,
    ).toBe(true);
    await setIncidentLegalHold(r.db, { ...r.base(r.f.owner.id), held: false });
    const codes = (
      await r.db.select().from(activityEvents).where(eq(activityEvents.tripId, r.f.trip.id))
    ).map((event) => event.code);
    expect(codes.filter((code) => code === "incident_legal_hold_set")).toHaveLength(1);
    expect(codes.filter((code) => code === "incident_legal_hold_released")).toHaveLength(1);
  });

  it("is refused to the crew who filed the report, to a manager, and to another shop", async () => {
    const r = await filedReport();
    expect(await setIncidentLegalHold(r.db, { ...r.base(r.f.crew.id), held: true })).toEqual({
      ok: false,
      reason: "not_allowed",
    });
    await demoteOwnerToManager(r.db, r.f.owner.id);
    expect(await setIncidentLegalHold(r.db, { ...r.base(r.f.owner.id), held: true })).toEqual({
      ok: false,
      reason: "not_allowed",
    });
    expect(
      await setIncidentLegalHold(r.db, {
        ...r.base(r.f.owner.id),
        shopId: OTHER_SHOP,
        held: true,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    const [row] = await r.db
      .select()
      .from(incidentReports)
      .where(eq(incidentReports.id, r.started.reportId));
    expect(row?.legalHoldAt).toBeNull();
  });

  it("keeps a held report past seven years, and lets it go when released", async () => {
    const r = await filedReport();
    await setIncidentLegalHold(r.db, { ...r.base(r.f.owner.id), held: true });
    const past = new Date(OCCURRED_AT.getTime() + 2556 * 86_400_000);
    await pruneExpiredRecords(r.db, { now: past });
    expect(
      await r.db.select().from(incidentReports).where(eq(incidentReports.id, r.started.reportId)),
    ).toHaveLength(1);
    await setIncidentLegalHold(r.db, { ...r.base(r.f.owner.id), held: false });
    await pruneExpiredRecords(r.db, { now: past });
    expect(
      await r.db.select().from(incidentReports).where(eq(incidentReports.id, r.started.reportId)),
    ).toHaveLength(0);
  });
});
