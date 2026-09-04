import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { STAFF_ROLES } from "@/lib/authz";
import { seededShopContext } from "@/test/db";
import { people, personRoles, shops, tripAssignments } from "./schema";
import {
  listShopStaff,
  setCrewPublicConsent,
  setStaffAccountStatus,
  setStaffLanguages,
} from "./staff-accounts";
import {
  listStaff,
  setTripCrew,
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
        actorPersonId: first.personId,
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
        actorPersonId: member.personId,
        consented: false,
      });
    }

    expect(await tripPublicCrew(db, shop.id, tripId)).toEqual([]);
    expect(await tripCrewSpokenLanguages(db, shop.id, tripId)).toEqual(before);
  });

  /**
   * **The surname bug this column exists to close** (issue #1351).
   *
   * The published name used to be `full_name.trim().split(/\s+/)[0]`, which is
   * not a first name — it is a bet that the shop typed the given name first. A
   * row entered surname-first, or comma-style off a spreadsheet, published the
   * *surname* to an anonymous, indexed page. Each case below writes a name
   * shape the split gets wrong and asserts on both halves: the chosen name is
   * what publishes, and the surname appears nowhere in the row at all.
   */
  it.each([
    { fullName: "Tanaka Keiko", chosen: "Keiko", surname: "Tanaka" },
    { fullName: "Smith, John", chosen: "John", surname: "Smith" },
    { fullName: "Okonkwo, Talia", chosen: "Talia", surname: "Okonkwo" },
  ])("publishes $chosen, not $surname, for a row typed $fullName", async (shape) => {
    const { db, shop, tripId, crew } = await aCrewedDeparture();
    const [member] = crew;
    if (!member) throw new Error("expected a consented crew member on the seeded departure");

    await db.update(people).set({ fullName: shape.fullName }).where(eq(people.id, member.personId));
    expect(
      await setCrewPublicConsent(db, {
        shopId: shop.id,
        personId: member.personId,
        actorPersonId: member.personId,
        consented: true,
        publicName: shape.chosen,
      }),
    ).toBe(true);

    const after = await tripPublicCrew(db, shop.id, tripId);
    const republished = after.find((row) => row.personId === member.personId);
    expect(republished?.firstName).toBe(shape.chosen);
    expect(JSON.stringify(after)).not.toContain(shape.surname);
  });

  /**
   * A single-token name is published whole. It may itself be a surname, and
   * that is the person's own call to make in the box — what the reader must
   * never do is silently cut it.
   */
  it("keeps a one-word name whole", async () => {
    const { db, shop, tripId, crew } = await aCrewedDeparture();
    const [member] = crew;
    if (!member) throw new Error("expected a consented crew member on the seeded departure");
    await db.update(people).set({ fullName: "Prince" }).where(eq(people.id, member.personId));
    await setCrewPublicConsent(db, {
      shopId: shop.id,
      personId: member.personId,
      actorPersonId: member.personId,
      consented: true,
    });

    const after = await tripPublicCrew(db, shop.id, tripId);
    expect(after.find((row) => row.personId === member.personId)?.firstName).toBe("Prince");
  });

  /**
   * **The state that would ship silently.** `tripPublicCrew` reads the stored
   * column, so a row carrying the consent stamp with no name renders one fewer
   * person — no error, no failing test. It cannot happen, and this is why: the
   * two columns are paired by a check constraint, so the database refuses the
   * row rather than the page rendering it short.
   */
  it.each([null, "", "   "])("refuses to hold a consent whose name is %o", async (name) => {
    const { db, crew } = await aCrewedDeparture();
    const [member] = crew;
    if (!member) throw new Error("expected a consented crew member on the seeded departure");
    // The empty string is the one that would have slipped through a bare null
    // pairing, and it is the worse of the two: it renders a bullet with the
    // role and languages after it and no name in front of them.
    await expect(
      db.update(people).set({ crewPublicName: name }).where(eq(people.id, member.personId)),
    ).rejects.toThrow();
  });

  /**
   * **A one-tap save is the path this feature is actually used on**, so it is
   * the one worth asserting on. The box is prefilled from the shop's record and
   * a person who agrees without editing it stores whatever was offered — which
   * is why the comma case had to be read rather than guessed at: "Smith, John"
   * defaulted to `"Smith,"`, the surname with punctuation, one tap from an
   * indexed page.
   */
  it("does not publish a surname when a comma-style record is accepted unedited", async () => {
    const { db, shop, tripId, crew } = await aCrewedDeparture();
    const [member] = crew;
    if (!member) throw new Error("expected a consented crew member on the seeded departure");
    await db
      .update(people)
      .set({ fullName: "Okonkwo, Talia" })
      .where(eq(people.id, member.personId));
    // No `publicName`: exactly what the form posts when the box is untouched.
    await setCrewPublicConsent(db, {
      shopId: shop.id,
      personId: member.personId,
      actorPersonId: member.personId,
      consented: true,
    });

    const after = await tripPublicCrew(db, shop.id, tripId);
    expect(after.find((row) => row.personId === member.personId)?.firstName).toBe("Talia");
    expect(JSON.stringify(after)).not.toContain("Okonkwo");
  });

  /**
   * **The rule that makes this a consent at all**, stated in the writer rather
   * than only in the one action that calls it. Unlike the blackout beside it on
   * the same page, there is no case where a manager may record this for
   * somebody else, so there is no privileged variant to reach.
   */
  it("refuses a consent recorded on somebody else's behalf", async () => {
    const { db, shop, tripId, crew } = await aCrewedDeparture();
    const [member] = crew;
    if (!member) throw new Error("expected a consented crew member on the seeded departure");
    const silent = await listStaff(db, shop.id).then((rows) =>
      rows.find((row) => row.person.crewPublicConsentAt === null),
    );
    if (!silent) throw new Error("seed has nobody who declined");

    expect(
      await setCrewPublicConsent(db, {
        shopId: shop.id,
        personId: silent.person.id,
        actorPersonId: member.personId,
        consented: true,
        publicName: "Whoever",
      }),
    ).toBe(false);

    const [row] = await db
      .select({ name: people.crewPublicName, at: people.crewPublicConsentAt })
      .from(people)
      .where(eq(people.id, silent.person.id));
    expect(row).toEqual({ name: null, at: null });
    expect(await tripPublicCrew(db, shop.id, tripId)).not.toContainEqual(
      expect.objectContaining({ personId: silent.person.id }),
    );
  });

  /**
   * Withdrawing takes the string away too. Leaving it on the row would let a
   * re-invite, an undo, or a plain re-tick republish the name somebody had
   * already taken down — the same hazard the security pass found in
   * `removeStaffMember`, one field over.
   */
  it("clears the stored name when somebody withdraws", async () => {
    const { db, shop, crew } = await aCrewedDeparture();
    const [member] = crew;
    if (!member) throw new Error("expected a consented crew member on the seeded departure");
    await setCrewPublicConsent(db, {
      shopId: shop.id,
      personId: member.personId,
      actorPersonId: member.personId,
      consented: false,
    });
    const [row] = await db
      .select({ name: people.crewPublicName, at: people.crewPublicConsentAt })
      .from(people)
      .where(eq(people.id, member.personId));
    expect(row).toEqual({ name: null, at: null });
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
      await setCrewPublicConsent(db, {
        shopId: shop.id,
        personId: diver.id,
        actorPersonId: diver.id,
        consented: true,
      }),
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
        actorPersonId: staff.person.id,
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
      actorPersonId: staff.id,
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

    await setCrewPublicConsent(db, {
      shopId: shop.id,
      personId: staff.id,
      actorPersonId: staff.id,
      consented: false,
    });
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

/**
 * **The other half of the arrangement** (issue #1357).
 *
 * The consent is the person's, and `crew_public_name` is typed by them for
 * themselves — so it is the one string on a public page that nobody at the shop
 * chose. The shop is still accountable for what its own pages say, and until
 * this reader carried the column an owner could only learn what was published
 * under their name by opening `/s/<slug>/trips/<id>` departure by departure.
 */
describe("listShopStaff and the name a diver reads", () => {
  it("carries the stored name for somebody who consented", async () => {
    const { db, shop } = await seededShopContext();
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("seeded shop has no staff");

    expect(
      await setCrewPublicConsent(db, {
        shopId: shop.id,
        personId: staff.person.id,
        actorPersonId: staff.person.id,
        consented: true,
        publicName: "Mar",
      }),
    ).toBe(true);

    const roster = await listShopStaff(db, shop.id);
    const row = roster.find((member) => member.personId === staff.person.id);
    // The string itself, not a derivation of `full_name` — the roster and the
    // public page have to be able to disagree with the record, because that is
    // the whole point of the person typing it (issue #1351).
    expect(row?.crewPublicName).toBe("Mar");
  });

  /**
   * **The roster makes a claim about a page it is not, so it has to check that
   * page's conditions** — found by a security pass on the commit that added
   * this row.
   *
   * `tripPublicCrew` requires the consent stamp, a live person **and** an
   * `active` account. Disabling somebody deliberately leaves their consent
   * standing (a temporary disable should not destroy a standing answer), so a
   * disabled divemaster is gone from every public page while the roster went
   * on telling the owner "Divers see “Mar”" — a false statement on the one
   * page built to let them check exactly that.
   */
  it("stops naming a disabled person, who no public page shows any more", async () => {
    const { db, shop } = await seededShopContext();
    // Not the owner: disabling the last one is refused, and that refusal would
    // make this test pass for the wrong reason.
    const member = (await listShopStaff(db, shop.id)).find(
      (row) => !row.roles.includes("owner") && row.accountStatus === "active",
    );
    if (!member) throw new Error("seeded shop has no non-owner staff account");
    await setCrewPublicConsent(db, {
      shopId: shop.id,
      personId: member.personId,
      actorPersonId: member.personId,
      consented: true,
      publicName: "Mar",
    });

    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("seed has no upcoming departure");
    await setTripCrew(db, shop.id, trip.id, [
      { personId: member.personId, tripRole: "divemaster" },
    ]);
    const named = async () =>
      (await tripPublicCrew(db, shop.id, trip.id)).map((crew) => crew.firstName);
    expect(await named()).toContain("Mar");

    const disabled = await setStaffAccountStatus(db, {
      shopId: shop.id,
      personId: member.personId,
      userAccountId: member.userAccountId,
      status: "disabled",
    });
    expect(disabled.ok, "the disable itself was refused, so this proves nothing").toBe(true);

    // Gone from the public page — and the consent is deliberately still on the
    // row, which is the whole reason the roster cannot read the name alone.
    expect(await named()).not.toContain("Mar");
    const [stored] = await db
      .select({ name: people.crewPublicName, at: people.crewPublicConsentAt })
      .from(people)
      .where(eq(people.id, member.personId));
    expect(stored?.name).toBe("Mar");
    expect(stored?.at).not.toBeNull();

    // So the roster row carries both facts, and the surface reads both.
    const row = (await listShopStaff(db, shop.id)).find((r) => r.personId === member.personId);
    expect(row?.crewPublicName).toBe("Mar");
    expect(row?.accountStatus).toBe("disabled");
  });

  /**
   * **The boundary the feature rests on.** Somebody who declined and somebody
   * who was never asked have to look identical here, or the roster becomes a
   * list of who said no — which is a different thing from a shop reading its
   * own public pages.
   *
   * Read against the seeded shop rather than a fabricated one, so the two
   * answers are told apart by a row that really does publish: null here has to
   * mean "not consented" and not "the column is never selected", and only a
   * roster carrying both shapes at once can say which.
   */
  it("shows nothing for somebody who declined, exactly as for somebody never asked", async () => {
    const { db, shop } = await seededShopContext();
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("seeded shop has no staff");

    await setCrewPublicConsent(db, {
      shopId: shop.id,
      personId: staff.person.id,
      actorPersonId: staff.person.id,
      consented: true,
      publicName: "Mar",
    });
    await setCrewPublicConsent(db, {
      shopId: shop.id,
      personId: staff.person.id,
      actorPersonId: staff.person.id,
      consented: false,
    });

    const roster = await listShopStaff(db, shop.id);
    expect(roster.find((member) => member.personId === staff.person.id)?.crewPublicName).toBeNull();
    // The seed's own consenting crew member, untouched by this test, is what
    // makes the null above mean something.
    expect(roster.filter((member) => member.crewPublicName !== null).length).toBeGreaterThan(0);
  });
});
