import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import {
  addBuddyTeamMember,
  dissolveBuddyTeam,
  formBuddyTeam,
  listTripBuddyTeamEvents,
  listTripBuddyTeams,
  removeBuddyTeamMember,
} from "./buddy-pairs";
import { getTripManifest, getTripManifests, recordCrewRollCall, recordRollCall } from "./manifests";
import { bookings, buddyPairMembers, tripAssignments, trips } from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

/**
 * The Benwood reef trip: three booked divers and — unlike today's Molasses
 * boat — no seeded buddy teams, so every test starts from an unteamed roster
 * with an odd count (odd counts are normal, never an error).
 */
async function buddyContext() {
  const { db, shop } = await seededShopContext();
  const tripRows = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const trip = tripRows.find((row) => row.title.startsWith("Two-Tank Reef — Benwood"));
  if (!trip) throw new Error("demo Benwood trip missing");
  const roster = await getTripRoster(db, shop.id, trip.id);
  const [a, b, c] = roster;
  if (!a || !b || !c) throw new Error("expected three Benwood bookings");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("demo staff missing");
  return { db, shop, trip, a, b, c, staff: staff.person };
}

/** Put a named staff member on this trip's crew list, so they can join a team. */
async function assignCrew(
  db: Awaited<ReturnType<typeof buddyContext>>["db"],
  tripId: string,
  personId: string,
) {
  const existing = await db
    .select({ personId: tripAssignments.personId })
    .from(tripAssignments)
    .where(and(eq(tripAssignments.tripId, tripId), eq(tripAssignments.personId, personId)))
    .limit(1);
  if (existing.length === 0) {
    await db.insert(tripAssignments).values({ tripId, personId });
  }
}

const diver = (bookingId: string) => ({ kind: "diver" as const, bookingId });
const crew = (personId: string) => ({ kind: "crew" as const, personId });

describe("buddy teams (in-memory PGlite)", () => {
  it("forms a team of two and reads it back on every member's row", async () => {
    const { db, shop, trip, a, b, c, staff } = await buddyContext();
    const outcome = await formBuddyTeam(db, {
      shopId: shop.id,
      tripId: trip.id,
      members: [diver(a.booking.id), diver(b.booking.id)],
      recordedByPersonId: staff.id,
    });
    expect(outcome).toMatchObject({ ok: true });

    const teams = await listTripBuddyTeams(db, shop.id, trip.id);
    expect(teams).toHaveLength(1);
    expect(
      teams[0]?.members.flatMap((member) => (member.kind === "diver" ? [member.bookingId] : [])),
    ).toEqual(expect.arrayContaining([a.booking.id, b.booking.id]));
    expect(teams[0]?.recordedByName).toBe(staff.fullName);

    // The manifest carries the team symmetrically — each row sees the *others*
    // — and the odd diver out is simply unteamed, never an error.
    const manifest = await getTripManifest(db, shop.id, trip.id);
    const byBooking = new Map(manifest?.divers.map((entry) => [entry.bookingId, entry]));
    expect(byBooking.get(a.booking.id)?.buddyTeam?.others).toEqual([
      { kind: "diver", bookingId: b.booking.id, fullName: b.person.fullName },
    ]);
    expect(byBooking.get(b.booking.id)?.buddyTeam?.others).toEqual([
      { kind: "diver", bookingId: a.booking.id, fullName: a.person.fullName },
    ]);
    expect(byBooking.get(c.booking.id)?.buddyTeam).toBeNull();
  });

  it("forms a team of three — the case the old two-body model could not express", async () => {
    const { db, shop, trip, a, b, c, staff } = await buddyContext();
    expect(
      await formBuddyTeam(db, {
        shopId: shop.id,
        tripId: trip.id,
        members: [diver(a.booking.id), diver(b.booking.id), diver(c.booking.id)],
        recordedByPersonId: staff.id,
      }),
    ).toMatchObject({ ok: true });

    const manifest = await getTripManifest(db, shop.id, trip.id);
    const first = manifest?.divers.find((entry) => entry.bookingId === a.booking.id);
    expect(first?.buddyTeam?.others.map((other) => other.fullName).sort()).toEqual(
      [b.person.fullName, c.person.fullName].sort(),
    );
  });

  it("takes a crew member as a member, and puts the team on their row too", async () => {
    const { db, shop, trip, a, b, staff } = await buddyContext();
    await assignCrew(db, trip.id, staff.id);
    expect(
      await formBuddyTeam(db, {
        shopId: shop.id,
        tripId: trip.id,
        members: [diver(a.booking.id), diver(b.booking.id), crew(staff.id)],
        recordedByPersonId: staff.id,
      }),
    ).toMatchObject({ ok: true });

    const manifest = await getTripManifest(db, shop.id, trip.id);
    const led = manifest?.divers.find((entry) => entry.bookingId === a.booking.id);
    expect(led?.buddyTeam?.others).toEqual(
      expect.arrayContaining([{ kind: "crew", personId: staff.id, fullName: staff.fullName }]),
    );
    const dm = manifest?.crew.find((member) => member.id === staff.id);
    expect(dm?.buddyTeams).toHaveLength(1);
    expect(dm?.buddyTeams?.[0]?.others.map((other) => other.fullName).sort()).toEqual(
      [a.person.fullName, b.person.fullName].sort(),
    );
  });

  it("lets one crew member lead several teams, where a diver may join only one", async () => {
    const { db, shop, trip, a, b, c, staff } = await buddyContext();
    await assignCrew(db, trip.id, staff.id);
    const base = { shopId: shop.id, tripId: trip.id, recordedByPersonId: staff.id };
    expect(
      await formBuddyTeam(db, { ...base, members: [diver(a.booking.id), crew(staff.id)] }),
    ).toMatchObject({ ok: true });
    // The same divemaster on a second team is allowed — this is how guided
    // diving actually runs.
    expect(
      await formBuddyTeam(db, {
        ...base,
        members: [diver(b.booking.id), diver(c.booking.id), crew(staff.id)],
      }),
    ).toMatchObject({ ok: true });

    const manifest = await getTripManifest(db, shop.id, trip.id);
    expect(manifest?.crew.find((member) => member.id === staff.id)?.buddyTeams).toHaveLength(2);
  });

  it("refuses a crew member who is not assigned to this trip", async () => {
    const { db, shop, trip, a, staff } = await buddyContext();
    const assigned = new Set(
      (
        await db
          .select({ personId: tripAssignments.personId })
          .from(tripAssignments)
          .where(eq(tripAssignments.tripId, trip.id))
      ).map((row) => row.personId),
    );
    const unassigned = (await listStaff(db, shop.id)).find((row) => !assigned.has(row.person.id));
    if (!unassigned) throw new Error("expected a staff member off this trip's crew list");
    expect(
      await formBuddyTeam(db, {
        shopId: shop.id,
        tripId: trip.id,
        members: [diver(a.booking.id), crew(unassigned.person.id)],
        recordedByPersonId: staff.id,
      }),
    ).toEqual({ ok: false, reason: "crew_unavailable" });
  });

  it("never lets a team touch checkpoint completeness", async () => {
    const { db, shop, trip, a, b, staff } = await buddyContext();
    const before = await getTripManifests(db, shop.id, trip.id);
    await formBuddyTeam(db, {
      shopId: shop.id,
      tripId: trip.id,
      members: [diver(a.booking.id), diver(b.booking.id)],
      recordedByPersonId: staff.id,
    });
    const after = await getTripManifests(db, shop.id, trip.id);
    expect(after?.map((manifest) => manifest.completeness)).toEqual(
      before?.map((manifest) => manifest.completeness),
    );
  });

  it("refuses a team of one, and a diver listed twice", async () => {
    const { db, shop, trip, a, staff } = await buddyContext();
    const base = { shopId: shop.id, tripId: trip.id, recordedByPersonId: staff.id };
    expect(await formBuddyTeam(db, { ...base, members: [diver(a.booking.id)] })).toEqual({
      ok: false,
      reason: "too_few_members",
    });
    expect(
      await formBuddyTeam(db, { ...base, members: [diver(a.booking.id), diver(a.booking.id)] }),
    ).toEqual({ ok: false, reason: "duplicate_member" });
    expect(await listTripBuddyTeams(db, shop.id, trip.id)).toEqual([]);
  });

  it("refuses a booking from a different trip", async () => {
    const { db, shop, trip, a, staff } = await buddyContext();
    const tripRows = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const other = tripRows.find((row) => row.title.startsWith("Afternoon Two-Tank"));
    if (!other) throw new Error("demo afternoon trip missing");
    const [foreign] = await getTripRoster(db, shop.id, other.id);
    if (!foreign) throw new Error("expected an afternoon booking");
    expect(
      await formBuddyTeam(db, {
        shopId: shop.id,
        tripId: trip.id,
        members: [diver(a.booking.id), diver(foreign.booking.id)],
        recordedByPersonId: staff.id,
      }),
    ).toEqual({ ok: false, reason: "booking_unavailable" });
  });

  it("refuses a cancelled booking", async () => {
    const { db, shop, trip, a, b, staff } = await buddyContext();
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, b.booking.id));
    expect(
      await formBuddyTeam(db, {
        shopId: shop.id,
        tripId: trip.id,
        members: [diver(a.booking.id), diver(b.booking.id)],
        recordedByPersonId: staff.id,
      }),
    ).toEqual({ ok: false, reason: "booking_unavailable" });
  });

  it("refuses an already-teamed diver — dissolve first, never a silent re-team", async () => {
    const { db, shop, trip, a, b, c, staff } = await buddyContext();
    const base = { shopId: shop.id, tripId: trip.id, recordedByPersonId: staff.id };
    const formed = await formBuddyTeam(db, {
      ...base,
      members: [diver(a.booking.id), diver(b.booking.id)],
    });
    if (!formed.ok) throw new Error("expected the first team to form");
    expect(
      await formBuddyTeam(db, { ...base, members: [diver(a.booking.id), diver(c.booking.id)] }),
    ).toEqual({ ok: false, reason: "already_teamed" });

    // The explicit path: dissolve, then the new team is allowed.
    expect(await dissolveBuddyTeam(db, { ...base, teamId: formed.teamId })).toEqual({ ok: true });
    expect(await listTripBuddyTeams(db, shop.id, trip.id)).toEqual([]);
    expect(
      await formBuddyTeam(db, { ...base, members: [diver(a.booking.id), diver(c.booking.id)] }),
    ).toMatchObject({ ok: true });
  });

  it("enforces one-team-per-booking at the database, not just in the pre-check", async () => {
    const { db, shop, trip, a, staff } = await buddyContext();
    const row = {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: a.booking.id,
      pairedByPersonId: staff.id,
    };
    await db.insert(buddyPairMembers).values({ ...row, pairId: crypto.randomUUID() });
    // A second membership for the same booking — what a lost race would
    // insert — must be a unique violation, whatever the application checked.
    await expect(
      db.insert(buddyPairMembers).values({ ...row, pairId: crypto.randomUUID() }),
    ).rejects.toThrow();
  });

  it("refuses a recorder who is not staff in the shop", async () => {
    const { db, shop, trip, a, b } = await buddyContext();
    expect(
      await formBuddyTeam(db, {
        shopId: shop.id,
        tripId: trip.id,
        members: [diver(a.booking.id), diver(b.booking.id)],
        // A customer is a person in the shop but holds no staff role.
        recordedByPersonId: a.person.id,
      }),
    ).toEqual({ ok: false, reason: "staff_not_found" });
  });

  it("refuses a trip that is not scheduled, and a trip id from nowhere", async () => {
    const { db, shop, trip, a, b, staff } = await buddyContext();
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, trip.id));
    const members = [diver(a.booking.id), diver(b.booking.id)];
    expect(
      await formBuddyTeam(db, {
        shopId: shop.id,
        tripId: trip.id,
        members,
        recordedByPersonId: staff.id,
      }),
    ).toEqual({ ok: false, reason: "trip_unavailable" });
    expect(
      await formBuddyTeam(db, {
        shopId: shop.id,
        tripId: crypto.randomUUID(),
        members,
        recordedByPersonId: staff.id,
      }),
    ).toEqual({ ok: false, reason: "trip_unavailable" });
  });

  it("dissolving nothing is a worded refusal, and dissolving is tenant-scoped", async () => {
    const { db, shop, trip, a, b, staff } = await buddyContext();
    expect(
      await dissolveBuddyTeam(db, {
        shopId: shop.id,
        tripId: trip.id,
        teamId: crypto.randomUUID(),
        recordedByPersonId: staff.id,
      }),
    ).toEqual({ ok: false, reason: "team_not_found" });

    const formed = await formBuddyTeam(db, {
      shopId: shop.id,
      tripId: trip.id,
      members: [diver(a.booking.id), diver(b.booking.id)],
      recordedByPersonId: staff.id,
    });
    if (!formed.ok) throw new Error("expected a team");
    // A bare team UUID under the wrong shop or trip dissolves nothing.
    expect(
      await dissolveBuddyTeam(db, {
        shopId: crypto.randomUUID(),
        tripId: trip.id,
        teamId: formed.teamId,
        recordedByPersonId: staff.id,
      }),
    ).toEqual({ ok: false, reason: "staff_not_found" });
    expect(
      await dissolveBuddyTeam(db, {
        shopId: shop.id,
        tripId: crypto.randomUUID(),
        teamId: formed.teamId,
        recordedByPersonId: staff.id,
      }),
    ).toEqual({ ok: false, reason: "team_not_found" });
    expect(await listTripBuddyTeams(db, shop.id, trip.id)).toHaveLength(1);
  });

  it("adds and removes members, and refuses a removal that would leave a team of one", async () => {
    const { db, shop, trip, a, b, c, staff } = await buddyContext();
    const base = { shopId: shop.id, tripId: trip.id, recordedByPersonId: staff.id };
    const formed = await formBuddyTeam(db, {
      ...base,
      members: [diver(a.booking.id), diver(b.booking.id)],
    });
    if (!formed.ok) throw new Error("expected a team");

    // At two, a removal is refused: dissolving is its own act.
    expect(
      await removeBuddyTeamMember(db, {
        ...base,
        teamId: formed.teamId,
        member: diver(b.booking.id),
      }),
    ).toEqual({ ok: false, reason: "too_few_members" });

    expect(
      await addBuddyTeamMember(db, { ...base, teamId: formed.teamId, member: diver(c.booking.id) }),
    ).toEqual({ ok: true });
    expect((await listTripBuddyTeams(db, shop.id, trip.id))[0]?.members).toHaveLength(3);

    // A diver already on this team, and one already on another, are both refused.
    expect(
      await addBuddyTeamMember(db, { ...base, teamId: formed.teamId, member: diver(c.booking.id) }),
    ).toEqual({ ok: false, reason: "duplicate_member" });

    expect(
      await removeBuddyTeamMember(db, {
        ...base,
        teamId: formed.teamId,
        member: diver(c.booking.id),
      }),
    ).toEqual({ ok: true });
    expect((await listTripBuddyTeams(db, shop.id, trip.id))[0]?.members).toHaveLength(2);
    // …and the removed diver is free to join a new team.
    expect(
      await removeBuddyTeamMember(db, {
        ...base,
        teamId: formed.teamId,
        member: diver(c.booking.id),
      }),
    ).toEqual({ ok: false, reason: "not_a_member" });
  });

  it("records every act on the append-only trail, and the trail outlives the team", async () => {
    const { db, shop, trip, a, b, c, staff } = await buddyContext();
    const base = { shopId: shop.id, tripId: trip.id, recordedByPersonId: staff.id };
    const formed = await formBuddyTeam(db, {
      ...base,
      members: [diver(a.booking.id), diver(b.booking.id)],
    });
    if (!formed.ok) throw new Error("expected a team");
    await addBuddyTeamMember(db, { ...base, teamId: formed.teamId, member: diver(c.booking.id) });
    await removeBuddyTeamMember(db, {
      ...base,
      teamId: formed.teamId,
      member: diver(c.booking.id),
    });
    await dissolveBuddyTeam(db, { ...base, teamId: formed.teamId });

    // The membership rows are gone…
    expect(await listTripBuddyTeams(db, shop.id, trip.id)).toEqual([]);
    // …and the trail still says exactly who was paired with whom, and when.
    const trail = await listTripBuddyTeamEvents(db, shop.id, trip.id);
    expect(trail.map((event) => event.action)).toEqual([
      "formed",
      "member_added",
      "member_removed",
      "dissolved",
    ]);
    expect(trail.every((event) => event.recordedByName === staff.fullName)).toBe(true);
    expect(trail[0]?.memberNames.sort()).toEqual([a.person.fullName, b.person.fullName].sort());
    // The fuller side of each change: the addition names three, and so does the
    // removal, so the person who left is never lost from the record.
    expect(trail[1]?.memberNames).toHaveLength(3);
    expect(trail[2]?.memberNames).toHaveLength(3);
    expect(trail[3]?.memberNames.sort()).toEqual([a.person.fullName, b.person.fullName].sort());
  });

  it("keeps a half-cancelled team visible and dissolvable, but off the manifest", async () => {
    const { db, shop, trip, a, b, c, staff } = await buddyContext();
    const base = { shopId: shop.id, tripId: trip.id, recordedByPersonId: staff.id };
    const formed = await formBuddyTeam(db, {
      ...base,
      members: [diver(a.booking.id), diver(b.booking.id)],
    });
    if (!formed.ok) throw new Error("expected a team");
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, b.booking.id));

    // The teams list still shows it, marked, so staff can dissolve it.
    const teams = await listTripBuddyTeams(db, shop.id, trip.id);
    expect(teams).toHaveLength(1);
    expect(
      teams[0]?.members.find(
        (member) => member.kind === "diver" && member.bookingId === b.booking.id,
      ),
    ).toMatchObject({ cancelled: true });

    // The manifest shows no team for the survivor — a cancelled seat is
    // nobody — and boarding the survivor after a dive raises no alert about
    // a person who is not on the boat.
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: a.booking.id,
      recordedByPersonId: staff.id,
      status: "boarded",
      checkpoint: "after_dive_1",
    });
    const manifest = await getTripManifest(db, shop.id, trip.id, "after_dive_1");
    const survivor = manifest?.divers.find((entry) => entry.bookingId === a.booking.id);
    expect(survivor?.buddyTeam).toBeNull();
    expect(survivor?.buddyAlert).toBeNull();

    // The survivor cannot be silently re-teamed past the stale membership…
    expect(
      await formBuddyTeam(db, { ...base, members: [diver(a.booking.id), diver(c.booking.id)] }),
    ).toEqual({ ok: false, reason: "already_teamed" });
    // …until the team is explicitly dissolved.
    expect(await dissolveBuddyTeam(db, { ...base, teamId: formed.teamId })).toEqual({ ok: true });
    expect(
      await formBuddyTeam(db, { ...base, members: [diver(a.booking.id), diver(c.booking.id)] }),
    ).toMatchObject({ ok: true });
  });

  it("derives the split-team alert on whoever is back, and settles it when the last member boards", async () => {
    const { db, shop, trip, a, b, c, staff } = await buddyContext();
    await formBuddyTeam(db, {
      shopId: shop.id,
      tripId: trip.id,
      members: [diver(a.booking.id), diver(b.booking.id), diver(c.booking.id)],
      recordedByPersonId: staff.id,
    });
    const board = (bookingId: string, status: "boarded" | "not_boarded" = "boarded") =>
      recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId,
        recordedByPersonId: staff.id,
        status,
        checkpoint: "after_dive_1",
      });

    // Two of three back: both loud, because one teammate is unaccounted for.
    await board(a.booking.id);
    await board(b.booking.id);
    let manifest = await getTripManifest(db, shop.id, trip.id, "after_dive_1");
    expect(manifest?.divers.find((e) => e.bookingId === a.booking.id)?.buddyAlert).toBe(
      "separated_after_dive",
    );
    expect(manifest?.divers.find((e) => e.bookingId === b.booking.id)?.buddyAlert).toBe(
      "separated_after_dive",
    );
    // The unaccounted member's own row carries their own state; the team alert
    // renders on whoever is back, where the deck looks.
    expect(manifest?.divers.find((e) => e.bookingId === c.booking.id)?.buddyAlert).toBeNull();

    // The last member boards, and the whole team settles.
    await board(c.booking.id);
    manifest = await getTripManifest(db, shop.id, trip.id, "after_dive_1");
    expect(manifest?.divers.map((entry) => entry.buddyAlert)).toEqual([null, null, null]);
  });

  it("stays loud when a teammate was explicitly recorded not back aboard", async () => {
    const { db, shop, trip, a, b, staff } = await buddyContext();
    await formBuddyTeam(db, {
      shopId: shop.id,
      tripId: trip.id,
      members: [diver(a.booking.id), diver(b.booking.id)],
      recordedByPersonId: staff.id,
    });
    for (const [bookingId, status] of [
      [a.booking.id, "boarded"],
      [b.booking.id, "not_boarded"],
    ] as const) {
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId,
        recordedByPersonId: staff.id,
        status,
        checkpoint: "after_dive_1",
      });
    }
    const manifest = await getTripManifest(db, shop.id, trip.id, "after_dive_1");
    expect(manifest?.divers.find((e) => e.bookingId === a.booking.id)?.buddyAlert).toBe(
      "separated_after_dive",
    );
  });

  it("raises the split on a diver whose divemaster has not come back", async () => {
    const { db, shop, trip, a, staff } = await buddyContext();
    await assignCrew(db, trip.id, staff.id);
    await formBuddyTeam(db, {
      shopId: shop.id,
      tripId: trip.id,
      members: [diver(a.booking.id), crew(staff.id)],
      recordedByPersonId: staff.id,
    });
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: a.booking.id,
      recordedByPersonId: staff.id,
      status: "boarded",
      checkpoint: "after_dive_1",
    });
    // The DM has no result at this checkpoint: unaccounted for, so the diver
    // who is back reads as separated. This is the case the old model could not
    // express at all — a diver placed with a DM looked identical to a diver
    // nobody paired.
    let manifest = await getTripManifest(db, shop.id, trip.id, "after_dive_1");
    expect(manifest?.divers.find((e) => e.bookingId === a.booking.id)?.buddyAlert).toBe(
      "separated_after_dive",
    );

    await recordCrewRollCall(db, {
      shopId: shop.id,
      tripId: trip.id,
      personId: staff.id,
      recordedByPersonId: staff.id,
      status: "boarded",
      checkpoint: "after_dive_1",
    });
    manifest = await getTripManifest(db, shop.id, trip.id, "after_dive_1");
    expect(manifest?.divers.find((e) => e.bookingId === a.booking.id)?.buddyAlert).toBeNull();
  });
});
