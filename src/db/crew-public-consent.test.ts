import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { STAFF_ROLES } from "@/lib/authz";
import { seededShopContext } from "@/test/db";
import { people, personRoles, shops, tripAssignments } from "./schema";
import { setCrewPublicConsent, setStaffLanguages } from "./staff-accounts";
import {
  listStaff,
  tripCrewSpokenLanguages,
  tripPublicCrew,
  upcomingTripsWithCounts,
} from "./trips";

/**
 * **Naming a person to divers is that person's own decision** (issue #1181,
 * delight report D21).
 *
 * The two readers below are siblings and the difference between them is the
 * whole feature: `tripCrewSpokenLanguages` answers "what can this shop say to
 * me?" and names nobody, which is a claim a shop may make about its own staff.
 * `tripPublicCrew` answers "who am I diving with?", which is a fact about a
 * person on a page anyone on the internet can read.
 */
async function aCrewedDeparture() {
  const { db, shop } = await seededShopContext();
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("seed has no upcoming departure");
  const crew = await tripPublicCrew(db, shop.id, trip.id);
  return { db, shop, tripId: trip.id, crew };
}

describe("tripPublicCrew", () => {
  it("names only the crew who said yes, and never their surname", async () => {
    const { db, tripId, crew } = await aCrewedDeparture();
    expect(crew.length).toBeGreaterThan(0);
    for (const member of crew) {
      // First names only: the surname is not part of what anybody consented to,
      // and a "who you're diving with" line does not need one.
      expect(member.firstName).not.toContain(" ");
    }

    // The assertions above pass unchanged with the consent filter deleted — a
    // shop's whole assigned roster is also non-empty and also has first names.
    // So state the filter as an equality against the roster: everybody assigned
    // to this departure who said yes is named, and everybody assigned who did
    // not is absent. The seed deliberately leaves some of the cast silent
    // (`staffDefs.namedToDivers`), so both halves have members.
    const assigned = await db
      .select({ personId: tripAssignments.personId, consentAt: people.crewPublicConsentAt })
      .from(tripAssignments)
      .innerJoin(people, eq(people.id, tripAssignments.personId))
      .where(eq(tripAssignments.tripId, tripId));
    const consented = assigned.filter((row) => row.consentAt !== null).map((row) => row.personId);
    const silent = assigned.filter((row) => row.consentAt === null).map((row) => row.personId);
    expect(consented.length).toBeGreaterThan(0);
    expect(silent.length).toBeGreaterThan(0);
    expect([...crew.map((member) => member.personId)].sort()).toEqual([...consented].sort());
  });

  it("stops naming somebody the moment they withdraw", async () => {
    const { db, shop, tripId, crew } = await aCrewedDeparture();
    const [first] = crew;
    if (!first) throw new Error("expected a consented crew member on the seeded departure");

    expect(
      await setCrewPublicConsent(db, {
        shopId: shop.id,
        personId: first.personId,
        consented: false,
      }),
    ).toBe(true);

    const after = await tripPublicCrew(db, shop.id, tripId);
    expect(after.map((member) => member.personId)).not.toContain(first.personId);
  });

  /**
   * The sibling reader is deliberately untouched by any of this. A shop whose
   * staff have consented to nothing still tells divers what languages are
   * aboard — that claim names nobody and was never anyone's to withhold.
   */
  it("leaves the anonymous languages line alone when everybody withdraws", async () => {
    const { db, shop, tripId, crew } = await aCrewedDeparture();
    // The seed deliberately records no staff languages — three
    // `listShopSpokenLanguages` cases read the demo as a shop that has recorded
    // none, and `crew-languages.spec.ts` records them through the UI as its own
    // subject — so this test states its own.
    for (const member of crew) {
      await setStaffLanguages(db, {
        shopId: shop.id,
        personId: member.personId,
        languages: ["en", "es"],
      });
    }
    const before = await tripCrewSpokenLanguages(db, shop.id, tripId);
    expect(before.length).toBeGreaterThan(0);

    for (const member of crew) {
      await setCrewPublicConsent(db, {
        shopId: shop.id,
        personId: member.personId,
        consented: false,
      });
    }

    expect(await tripPublicCrew(db, shop.id, tripId)).toEqual([]);
    expect(await tripCrewSpokenLanguages(db, shop.id, tripId)).toEqual(before);
  });

  it("never reaches another shop's roster on the trip id alone", async () => {
    // `trip_assignments` carries no shop_id of its own (CR-007), so the read
    // proves membership through `trips` on one side and `people` on the other.
    const { db, tripId } = await aCrewedDeparture();
    const [other] = await db
      .insert(shops)
      .values({ name: "Rival Reef", slug: "rival-crew-consent", timezone: "America/New_York" })
      .returning();
    if (!other) throw new Error("second shop insert failed");
    expect(await tripPublicCrew(db, other.id, tripId)).toEqual([]);
  });
});

describe("setCrewPublicConsent", () => {
  it("refuses a person who is not this shop's staff", async () => {
    const { db, shop } = await seededShopContext();
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Priya Raman" })
      .returning();
    if (!diver) throw new Error("diver insert failed");

    // No staff role: the same subject guard `setStaffLanguages` keeps, so this
    // cannot be pointed at an arbitrary `people` row.
    expect(
      await setCrewPublicConsent(db, { shopId: shop.id, personId: diver.id, consented: true }),
    ).toBe(false);
  });

  it("refuses a staff member of another shop", async () => {
    const { db, shop } = await seededShopContext();
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("seeded shop has no staff");
    const [other] = await db
      .insert(shops)
      .values({ name: "Rival Reef", slug: "rival-crew-consent-2", timezone: "UTC" })
      .returning();
    if (!other) throw new Error("second shop insert failed");

    expect(
      await setCrewPublicConsent(db, {
        shopId: other.id,
        personId: staff.person.id,
        consented: true,
      }),
    ).toBe(false);
  });

  it("records when they agreed, and clears it rather than dating a withdrawal", async () => {
    const { db, shop } = await seededShopContext();
    const [staff] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, STAFF_ROLES[0])))
      .limit(1);
    if (!staff) throw new Error("seeded shop has no staff");
    const at = new Date("2030-08-05T13:00:00Z");

    await setCrewPublicConsent(db, {
      shopId: shop.id,
      personId: staff.id,
      consented: true,
      now: at,
    });
    const [agreed] = await db
      .select({ consentAt: people.crewPublicConsentAt })
      .from(people)
      .where(eq(people.id, staff.id));
    // A timestamp rather than a boolean: for a consent, *when* is half of what
    // makes it a record.
    expect(agreed?.consentAt).toEqual(at);

    await setCrewPublicConsent(db, { shopId: shop.id, personId: staff.id, consented: false });
    const [withdrawn] = await db
      .select({ consentAt: people.crewPublicConsentAt })
      .from(people)
      .where(eq(people.id, staff.id));
    // Null, not a second timestamp: the standing answer is the fact worth
    // keeping, and a shop holding a former employee's revoked consent date
    // serves nobody.
    expect(withdrawn?.consentAt).toBeNull();
  });
});
