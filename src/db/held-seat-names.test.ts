import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { rollCallRowState } from "@/lib/manifests";
import { serializeManifests } from "@/lib/offline-manifests";
import { seededShopContext } from "@/test/db";
import { formBuddyTeam, listTripBuddyTeams } from "./buddy-pairs";
import { getIncidentExport } from "./incident-export";
import { getTripManifests, recordRollCall } from "./manifests";
import { bookings } from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

/**
 * **A held seat is named as booked, everywhere the boat reads it** (issue
 * #1690, security re-review B1). The name is settled where the booking is
 * joined to its person — the manifest assembly and every buddy-team read — so
 * this asserts the readers that used to bypass the row-level withholding: the
 * not-back-aboard alarm (the summary panel's input), a teammate's label, the
 * offline copy and the incident document, including the frozen trail.
 */
describe("a held seat's name on the boat (in-memory PGlite)", () => {
  it("names a held seat that did not come back as booked, never as the matched diver", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const staffRows = await listStaff(db, shop.id);
    const owner = staffRows.find((row) => row.roles.includes("owner"));
    if (!owner) throw new Error("demo owner missing");
    const roster = await getTripRoster(db, shop.id, reef.id);
    // Two divers the demo has not already teamed, so the only trail entry
    // naming the held seat is the one written below, after the hold.
    const teamed = new Set(
      (await listTripBuddyTeams(db, shop.id, reef.id)).flatMap((team) =>
        team.members.flatMap((member) => (member.kind === "diver" ? [member.bookingId] : [])),
      ),
    );
    const [held, mate] = roster.filter((entry) => !teamed.has(entry.booking.id));
    if (!held || !mate) throw new Error("demo roster needs two unteamed divers");
    const matchedName = held.person.fullName;
    const bookedAs = "Kai Quillfeather";

    // Everyone back after dive one except the held seat.
    for (const entry of roster) {
      const outcome = await recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: entry.booking.id,
        recordedByPersonId: owner.person.id,
        status: entry.booking.id === held.booking.id ? "not_boarded" : "boarded",
        checkpoint: "after_dive_1",
      });
      if (!outcome.ok) throw new Error(`roll call refused: ${outcome.reason}`);
    }
    await db
      .update(bookings)
      .set({
        identityUnconfirmedAt: nowDate(),
        identityBookedAs: bookedAs,
        identityMatchedBy: "shared_email",
      })
      .where(eq(bookings.id, held.booking.id));
    // Teamed after the hold, so the trail's frozen `memberNames` is written now.
    const formed = await formBuddyTeam(db, {
      shopId: shop.id,
      tripId: reef.id,
      members: [
        { kind: "diver", bookingId: held.booking.id },
        { kind: "diver", bookingId: mate.booking.id },
      ],
      recordedByPersonId: owner.person.id,
    });
    expect(formed).toMatchObject({ ok: true });

    const manifests = await getTripManifests(db, shop.id, reef.id);
    const afterDive = manifests?.find((entry) => entry.checkpoint === "after_dive_1");
    if (!manifests || !afterDive) throw new Error("manifests missing");

    const notBackAboard = afterDive.divers.filter(
      (diver) => rollCallRowState("after_dive_1", diver.rollCall).notBackAboard,
    );
    expect(notBackAboard.map((diver) => diver.fullName)).toEqual([bookedAs]);
    const mateRow = afterDive.divers.find((diver) => diver.bookingId === mate.booking.id);
    expect(mateRow?.buddyTeam?.others.map((other) => other.fullName)).toEqual([bookedAs]);

    const payload = JSON.stringify(
      serializeManifests(
        manifests,
        {
          slug: shop.slug,
          name: shop.name,
          timezone: shop.timezone,
          emergencyReference: shop.emergencyReference,
        },
        (blocker) => blocker.code,
      ),
    );
    expect(payload).toContain(bookedAs);
    expect(payload).not.toContain(matchedName);

    const doc = await getIncidentExport(db, shop.id, reef.id, owner.person.id);
    if (!doc) throw new Error("incident export missing");
    const document = JSON.stringify(doc);
    expect(document).toContain(bookedAs);
    expect(document).not.toContain(matchedName);
  });
});
