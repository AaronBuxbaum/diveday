import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DAY_MS, nowDate } from "@/lib/clock";
import { INVITE_SUGGESTIONS_SHOWN } from "@/lib/invite-suggestions";
import { fileScopedShopContext } from "@/test/db";
import { tripAdmissionFor } from "./bookings";
import {
  admittedToTrip,
  createInvitationUnderCooldown,
  invitedWithinCooldown,
  listInviteSuggestions,
  recentInviteDates,
} from "./invite-suggestions";
import {
  bookings,
  certifications,
  courses,
  diveSites,
  interests,
  nitroxCertifications,
  people,
  personRoles,
  specialtyCertifications,
  tripRequirements,
  trips,
  waiverRecords,
  waiverTemplates,
} from "./schema";

const ctx = fileScopedShopContext();

describe("recent invite dates for the manual picker", () => {
  it("returns the latest shop invitation only for the requested people and shop", async () => {
    const { db, shop, now, target, march, july, diver } = await fixture();
    const person = await diver("Manual Invite");
    const notRequested = await diver("Not Requested");
    if (!person || !notRequested || !target || !march || !july) throw new Error("setup failed");
    const latest = new Date(now.getTime() - 2 * DAY_MS);
    await db.insert(interests).values([
      {
        shopId: shop.id,
        tripId: target.id,
        scope: "departure",
        askedBy: "shop",
        personId: person.id,
        partySize: 1,
        askedAt: new Date(now.getTime() - 9 * DAY_MS),
        offeredAt: new Date(now.getTime() - 6 * DAY_MS),
      },
      {
        shopId: shop.id,
        tripId: march.id,
        scope: "departure",
        askedBy: "shop",
        personId: person.id,
        partySize: 1,
        askedAt: latest,
      },
      {
        shopId: shop.id,
        tripId: july.id,
        scope: "departure",
        askedBy: "diver",
        personId: person.id,
        partySize: 1,
        askedAt: now,
      },
      {
        shopId: shop.id,
        tripId: target.id,
        scope: "departure",
        askedBy: "shop",
        personId: notRequested.id,
        partySize: 1,
        askedAt: now,
      },
    ]);
    expect(await recentInviteDates(db, shop.id, [person.id], now)).toEqual(
      new Map([[person.id, latest]]),
    );
    expect(
      await recentInviteDates(db, "00000000-0000-4000-8000-000000000000", [person.id], now),
    ).toEqual(new Map());
    expect(await recentInviteDates(db, shop.id, [], now)).toEqual(new Map());
  });
});

async function fixture() {
  const { db, shop } = ctx;
  const now = nowDate();
  const [site] = await db
    .insert(diveSites)
    .values({ shopId: shop.id, name: "Invite Test Wall", slug: "invite-test-wall" })
    .returning();
  const trip = async (title: string, startsAt: Date, isRehearsal = false) => {
    const [row] = await db
      .insert(trips)
      .values({
        shopId: shop.id,
        title,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
        capacity: 12,
        diveSiteId: site.id,
        isRehearsal,
        isPrivate: isRehearsal,
      })
      .returning();
    return row;
  };
  const target = await trip("Next wall dive", new Date(now.getTime() + 10 * DAY_MS));
  const march = await trip("Wall in March", new Date(now.getTime() - 200 * DAY_MS));
  const july = await trip("Wall in July", new Date(now.getTime() - 90 * DAY_MS));
  const rehearsal = await trip("Wall rehearsal", new Date(now.getTime() - 30 * DAY_MS), true);

  const diver = async (fullName: string, extra: Partial<typeof people.$inferInsert> = {}) => {
    const [row] = await db
      .insert(people)
      .values({
        shopId: shop.id,
        fullName,
        email: `${fullName.toLowerCase().replaceAll(" ", ".")}@invite-test.example`,
        ...extra,
      })
      .returning();
    await db.insert(personRoles).values({ personId: row.id, role: "diver" });
    return row;
  };
  const seat = (
    tripId: string,
    personId: string,
    status: "booked" | "cancelled" | "no_show" = "booked",
    participantType: "diver" | "snorkeler" | "rider" = "diver",
  ) =>
    db.insert(bookings).values({
      bookedAs: participantType,
      participantType,
      shopId: shop.id,
      tripId,
      personId,
      status,
    });
  const card = (personId: string, level: "open_water" | "advanced_open_water") =>
    db.insert(certifications).values({
      shopId: shop.id,
      personId,
      agency: "padi",
      level,
      status: "verified",
      identifier: `C-${personId.slice(0, 8)}`,
    });

  // A signed release whose medical answers referred the diver to a physician.
  const referral = async (
    personId: string,
    extra: Partial<typeof waiverRecords.$inferInsert> = {},
  ) => {
    const [template] = await db
      .select()
      .from(waiverTemplates)
      .where(eq(waiverTemplates.shopId, shop.id))
      .limit(1);
    if (!template) throw new Error("expected a seeded waiver template");
    await db.insert(waiverRecords).values({
      shopId: shop.id,
      personId,
      templateId: template.id,
      templateTitle: template.title,
      templateVersion: template.version,
      templateBody: template.body,
      status: "medical_review",
      medicalReviewRequired: true,
      signedName: "Referred Diver",
      signatureMethod: "typed",
      tokenHash: `hash-${crypto.randomUUID()}`,
      expiresAt: now,
      consentedAt: now,
      signedAt: now,
      medicalAnswers: { questionnaireId: "rstc", questionnaireVersion: 1, responses: { q1: true } },
      ...extra,
    });
  };

  return {
    db,
    shop,
    now,
    site,
    target,
    march,
    july,
    rehearsal,
    diver,
    seat,
    card,
    trip,
    referral,
  };
}

describe("listInviteSuggestions", () => {
  it("lists past divers of the site, most recent first, with when they last came", async () => {
    const { db, shop, now, target, march, july, diver, seat } = await fixture();
    const nadia = await diver("Nadia Petrov");
    const ines = await diver("Ines Costa");
    await seat(march.id, nadia.id);
    await seat(july.id, ines.id);

    const got = await listInviteSuggestions(db, { shopId: shop.id, tripId: target.id, now });
    expect(got?.siteName).toBe("Invite Test Wall");
    expect(got?.shown.map((p) => p.fullName)).toEqual(["Ines Costa", "Nadia Petrov"]);
    expect(got?.shown[0].lastDivedAt).toEqual(july.startsAt);
    expect(got?.total).toBe(2);
  });

  it("leaves out anyone aboard, already invited here, or invited anywhere in the last 30 days", async () => {
    const { db, shop, now, target, march, diver, seat } = await fixture();
    const aboard = await diver("Already Aboard");
    const invitedHere = await diver("Invited Here");
    const invitedRecently = await diver("Invited Recently");
    const invitedLongAgo = await diver("Invited Long Ago");
    for (const p of [aboard, invitedHere, invitedRecently, invitedLongAgo])
      await seat(march.id, p.id);
    await seat(target.id, aboard.id);
    await db.insert(interests).values([
      {
        shopId: shop.id,
        tripId: target.id,
        scope: "departure",
        askedBy: "shop",
        partySize: 1,
        personId: invitedHere.id,
        createdByPersonId: aboard.id,
      },
      {
        shopId: shop.id,
        tripId: march.id,
        scope: "departure",
        askedBy: "shop",
        partySize: 1,
        personId: invitedRecently.id,
        createdByPersonId: aboard.id,
        offeredAt: new Date(now.getTime() - 29 * DAY_MS),
        askedAt: new Date(now.getTime() - 29 * DAY_MS),
      },
      {
        shopId: shop.id,
        tripId: march.id,
        scope: "departure",
        askedBy: "shop",
        partySize: 1,
        personId: invitedLongAgo.id,
        createdByPersonId: aboard.id,
        offeredAt: new Date(now.getTime() - 31 * DAY_MS),
        askedAt: new Date(now.getTime() - 31 * DAY_MS),
      },
    ]);

    const got = await listInviteSuggestions(db, { shopId: shop.id, tripId: target.id, now });
    expect(got?.shown.map((p) => p.fullName)).toEqual(["Invited Long Ago"]);
    expect(await invitedWithinCooldown(db, shop.id, invitedRecently.id, now)).toBe(true);
    expect(await invitedWithinCooldown(db, shop.id, invitedLongAgo.id, now)).toBe(false);
  });

  it("leaves out the erased, the opted out, the addressless, no-shows and rehearsals", async () => {
    const { db, shop, now, target, march, rehearsal, diver, seat } = await fixture();
    const erased = await diver("Erased Diver", { anonymizedAt: now, deletedAt: now });
    const optedOut = await diver("Opted Out", { courtesyEmailOptOutAt: now });
    const noEmail = await diver("No Email", { email: null });
    const noShow = await diver("No Show");
    const cancelled = await diver("Cancelled Seat");
    const rehearsed = await diver("Only Rehearsed");
    for (const p of [erased, optedOut, noEmail]) await seat(march.id, p.id);
    await seat(march.id, noShow.id, "no_show");
    await seat(march.id, cancelled.id, "cancelled");
    await seat(rehearsal.id, rehearsed.id);

    expect(await listInviteSuggestions(db, { shopId: shop.id, tripId: target.id, now })).toBeNull();
  });

  it("never suggests a diver whose release waits on a physician's referral, cleared or not", async () => {
    // The second-pass review's X3: readiness stops them at the dock, but the
    // shop must not send "come dive" to someone a doctor has not cleared. The
    // departure demands no card, so the booking gate's shortcut admits all.
    const { db, shop, now, target, march, diver, seat, referral } = await fixture();
    const open = await diver("Referral Open");
    const declined = await diver("Referral Declined");
    const cleared = await diver("Referral Cleared");
    const superseded = await diver("Referral Superseded");
    const [owner] = await db.select({ id: people.id }).from(people).limit(1);
    for (const p of [open, declined, cleared, superseded]) await seat(march.id, p.id);
    await referral(open.id);
    // A physician said no: still parked, still never invited.
    await referral(declined.id, {
      medicalClearanceDeclinedAt: now,
      medicalClearanceDeclinedByPersonId: owner.id,
      medicalClearanceEvaluatedOn: "2026-07-20",
      medicalClearancePhysicianName: "Dr. Imani Hale",
    });
    await referral(cleared.id, {
      status: "completed",
      completedAt: now,
      medicalClearedAt: now,
      medicalClearedByPersonId: owner.id,
      medicalClearanceEvaluatedOn: "2026-07-20",
      medicalClearancePhysicianName: "Dr. Imani Hale",
    });
    await referral(superseded.id, { supersededAt: now });

    const got = await listInviteSuggestions(db, { shopId: shop.id, tripId: target.id, now });
    expect(got?.shown.map((p) => p.fullName).sort()).toEqual([
      "Referral Cleared",
      "Referral Superseded",
    ]);
  });

  it("leaves out an open referral on a boat that checks cards too", async () => {
    const { db, shop, now, target, march, diver, seat, card, referral } = await fixture();
    const referred = await diver("Carded But Referred");
    const clear = await diver("Carded And Clear");
    for (const p of [referred, clear]) {
      await seat(march.id, p.id);
      await card(p.id, "advanced_open_water");
    }
    await db.insert(tripRequirements).values({
      shopId: shop.id,
      tripId: target.id,
      minimumCertificationLevel: "advanced_open_water",
    });
    await referral(referred.id);
    const got = await listInviteSuggestions(db, { shopId: shop.id, tripId: target.id, now });
    expect(got?.shown.map((p) => p.fullName)).toEqual(["Carded And Clear"]);
  });

  it("shows a handful and counts the rest", async () => {
    const { db, shop, now, target, march, diver, seat } = await fixture();
    for (let i = 0; i < INVITE_SUGGESTIONS_SHOWN + 3; i++) {
      await seat(march.id, (await diver(`Past Diver ${String(i).padStart(2, "0")}`)).id);
    }
    const got = await listInviteSuggestions(db, { shopId: shop.id, tripId: target.id, now });
    expect(got?.shown).toHaveLength(INVITE_SUGGESTIONS_SHOWN);
    expect(got?.total).toBe(INVITE_SUGGESTIONS_SHOWN + 3);
  });

  it("never suggests a rider, a snorkeler, or someone who only did a try-dive", async () => {
    const { db, shop, now, site, target, march, diver, seat } = await fixture();
    const rider = await diver("Rider Only");
    const snorkeler = await diver("Snorkel Only");
    const taster = await diver("Try Dive Only");
    const real = await diver("Real Diver");
    await seat(march.id, rider.id, "booked", "rider");
    await seat(march.id, snorkeler.id, "booked", "snorkeler");
    await seat(march.id, real.id);
    const [dsd] = await db
      .insert(courses)
      .values({
        shopId: shop.id,
        title: "Discover Scuba",
        slug: `invite-dsd-${now.getTime()}`,
        agency: "PADI",
        isIntroCourse: true,
      })
      .returning();
    const startsAt = new Date(now.getTime() - 40 * DAY_MS);
    const [dsdSession] = await db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "DSD at the wall",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
        capacity: 4,
        diveSiteId: site.id,
        courseId: dsd.id,
      })
      .returning();
    await seat(dsdSession.id, taster.id);

    const got = await listInviteSuggestions(db, { shopId: shop.id, tripId: target.id, now });
    expect(got?.shown.map((p) => p.fullName)).toEqual(["Real Diver"]);
  });

  it("leaves out a diver below the boat's level, or missing the Deep card a deep boat demands", async () => {
    const { db, shop, now, target, march, diver, seat, card } = await fixture();
    const underLevel = await diver("Under Level");
    const advanced = await diver("Advanced Diver");
    const noDeep = await diver("No Deep Card");
    const deep = await diver("Deep Diver");
    for (const p of [underLevel, advanced, noDeep, deep]) await seat(march.id, p.id);
    await card(underLevel.id, "open_water");
    for (const p of [advanced, noDeep, deep]) await card(p.id, "advanced_open_water");
    await db.insert(specialtyCertifications).values({
      shopId: shop.id,
      personId: deep.id,
      agency: "padi",
      specialty: "deep",
      status: "verified",
      identifier: "DEEP-1",
    });
    await db.insert(tripRequirements).values({
      shopId: shop.id,
      tripId: target.id,
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
    });

    const got = await listInviteSuggestions(db, { shopId: shop.id, tripId: target.id, now });
    expect(got?.shown.map((p) => p.fullName)).toEqual(["Deep Diver"]);
  });

  it("suggests nobody on a course session", async () => {
    const { db, shop, now, site, march, diver, seat } = await fixture();
    await seat(march.id, (await diver("Certified Regular")).id);
    const [ow] = await db
      .insert(courses)
      .values({
        shopId: shop.id,
        title: "Open Water",
        slug: `invite-ow-${now.getTime()}`,
        agency: "PADI",
        certifiesLevel: "open_water",
      })
      .returning();
    const startsAt = new Date(now.getTime() + 9 * DAY_MS);
    const [session] = await db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "OW at the wall",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
        capacity: 6,
        diveSiteId: site.id,
        courseId: ow.id,
      })
      .returning();
    expect(
      await listInviteSuggestions(db, { shopId: shop.id, tripId: session.id, now }),
    ).toBeNull();
  });
});

describe("admittedToTrip", () => {
  it("agrees with the booking's own gate for every candidate, read in one pass, less an open referral", async () => {
    const { db, shop, now, target, diver, card, trip, referral } = await fixture();
    const underLevel = await diver("Gate Under Level");
    const advanced = await diver("Gate Advanced");
    const deletedCard = await diver("Gate Deleted Card");
    const trainee = await diver("Gate Trainee");
    const stranger = await diver("Gate No Cards");
    await card(underLevel.id, "open_water");
    await card(advanced.id, "advanced_open_water");
    await db.insert(certifications).values({
      shopId: shop.id,
      personId: deletedCard.id,
      agency: "padi",
      level: "advanced_open_water",
      status: "verified",
      identifier: "C-DELETED",
      deletedAt: now,
    });
    // An Advanced course that finishes before the target sails: admission
    // sells the seat on it (readiness still waits for the card).
    const [course] = await db
      .insert(courses)
      .values({
        shopId: shop.id,
        title: "Gate Advanced Course",
        slug: `gate-advanced-${now.getTime()}`,
        certifiesLevel: "advanced_open_water",
      })
      .returning();
    const session = await trip("Gate Advanced session", new Date(now.getTime() + 3 * DAY_MS));
    await db.update(trips).set({ courseId: course.id }).where(eq(trips.id, session.id));
    await db.insert(bookings).values({
      bookedAs: "diver",
      participantType: "diver",
      shopId: shop.id,
      tripId: session.id,
      personId: trainee.id,
      status: "booked",
    });
    await db.insert(tripRequirements).values({
      shopId: shop.id,
      tripId: target.id,
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
    });
    await db.insert(specialtyCertifications).values({
      shopId: shop.id,
      personId: advanced.id,
      agency: "padi",
      specialty: "deep",
      status: "verified",
      identifier: "DEEP-GATE",
    });

    // Admitted by the booking gate, but parked on a physician's referral (X3):
    // the one place the batch is stricter than the one-diver gate.
    const referred = await diver("Gate Advanced Referred");
    await card(referred.id, "advanced_open_water");
    await db.insert(specialtyCertifications).values({
      shopId: shop.id,
      personId: referred.id,
      agency: "padi",
      specialty: "deep",
      status: "verified",
      identifier: "DEEP-REFERRED",
    });
    await referral(referred.id);

    const candidates = [underLevel, advanced, deletedCard, trainee, stranger, referred].map(
      (p) => ({ personId: p.id }),
    );
    const one = async (personId: string) =>
      (await tripAdmissionFor(db, shop.id, target.id, { id: personId }, false, false)).admitted;
    const expected = [];
    for (const c of candidates) if (await one(c.personId)) expected.push(c);
    expect(expected.map((c) => c.personId)).toContain(referred.id);

    const got = await admittedToTrip(db, shop.id, target.id, candidates);
    expect(got).toEqual(expected.filter((c) => c.personId !== referred.id));
    expect(got.map((c) => c.personId)).toContain(advanced.id);
    expect(got.map((c) => c.personId)).not.toContain(underLevel.id);
  });
});

describe("admittedToTrip, the branches the booking gate takes", () => {
  // Review N2: every candidate below goes through the same expected-vs-got
  // comparison against `tripAdmissionFor`, one departure shape at a time.
  async function parity(
    db: Awaited<ReturnType<typeof fixture>>["db"],
    shopId: string,
    tripId: string,
    people: readonly { id: string }[],
  ) {
    const candidates = people.map((p) => ({ personId: p.id }));
    const expected = [];
    for (const c of candidates) {
      if ((await tripAdmissionFor(db, shopId, tripId, { id: c.personId }, false, false)).admitted) {
        expected.push(c);
      }
    }
    const got = await admittedToTrip(db, shopId, tripId, candidates);
    expect(got).toEqual(expected);
    return got.map((c) => c.personId);
  }

  it("agrees on a departure that requires Enriched Air", async () => {
    const { db, shop, target, diver } = await fixture();
    const verified = await diver("Nitrox Verified");
    const pending = await diver("Nitrox Pending");
    const none = await diver("Nitrox None");
    await db.insert(nitroxCertifications).values([
      {
        shopId: shop.id,
        personId: verified.id,
        agency: "padi",
        status: "verified",
        identifier: "EAN-V",
      },
      {
        shopId: shop.id,
        personId: pending.id,
        agency: "padi",
        status: "pending",
        identifier: "EAN-P",
      },
    ]);
    await db.insert(tripRequirements).values({
      shopId: shop.id,
      tripId: target.id,
      requiresNitrox: true,
    });
    // Admission is the weaker gate (the fill is checked at the dock), so the
    // pin is parity, whatever the gate decides for each.
    const admitted = await parity(db, shop.id, target.id, [verified, pending, none]);
    expect(admitted).toContain(verified.id);
  });

  it("agrees on a requirement that comes from the site alone", async () => {
    const { db, shop, now, diver, card } = await fixture();
    const [deepSite] = await db
      .insert(diveSites)
      .values({
        shopId: shop.id,
        name: "Parity Deep Wall",
        slug: `parity-deep-wall-${now.getTime()}`,
        minimumCertificationLevel: "advanced_open_water",
      })
      .returning();
    const startsAt = new Date(now.getTime() + 9 * DAY_MS);
    const [siteTrip] = await db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Parity deep wall",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
        capacity: 12,
        diveSiteId: deepSite.id,
      })
      .returning();
    const aow = await diver("Site AOW");
    const ow = await diver("Site OW");
    const pendingAow = await diver("Site Pending AOW");
    await card(aow.id, "advanced_open_water");
    await card(ow.id, "open_water");
    await db.insert(certifications).values({
      shopId: shop.id,
      personId: pendingAow.id,
      agency: "padi",
      level: "advanced_open_water",
      status: "pending",
      identifier: "C-PENDING-SITE",
    });
    const admitted = await parity(db, shop.id, siteTrip.id, [aow, ow, pendingAow]);
    expect(admitted).toContain(aow.id);
    expect(admitted).not.toContain(ow.id);
  });

  it("agrees on a pending card and on courses that end after the departure or already ended", async () => {
    const { db, shop, now, target, diver, card, trip } = await fixture();
    const pending = await diver("Level Pending");
    const lateTrainee = await diver("Course After Departure");
    const pastTrainee = await diver("Course Ended No Card");
    await db.insert(certifications).values({
      shopId: shop.id,
      personId: pending.id,
      agency: "padi",
      level: "advanced_open_water",
      status: "pending",
      identifier: "C-PENDING-LEVEL",
    });
    await card(lateTrainee.id, "open_water");
    await card(pastTrainee.id, "open_water");
    const [course] = await db
      .insert(courses)
      .values({
        shopId: shop.id,
        title: "Parity Advanced Course",
        slug: `parity-advanced-${now.getTime()}`,
        certifiesLevel: "advanced_open_water",
      })
      .returning();
    const after = await trip("Advanced after the wall", new Date(now.getTime() + 11 * DAY_MS));
    const ended = await trip("Advanced last week", new Date(now.getTime() - 5 * DAY_MS));
    await db
      .update(trips)
      .set({ courseId: course.id })
      .where(inArray(trips.id, [after.id, ended.id]));
    await db.insert(bookings).values([
      {
        bookedAs: "diver",
        participantType: "diver",
        shopId: shop.id,
        tripId: after.id,
        personId: lateTrainee.id,
        status: "booked",
      },
      {
        bookedAs: "diver",
        participantType: "diver",
        shopId: shop.id,
        tripId: ended.id,
        personId: pastTrainee.id,
        status: "booked",
      },
    ]);
    await db.insert(tripRequirements).values({
      shopId: shop.id,
      tripId: target.id,
      minimumCertificationLevel: "advanced_open_water",
    });
    const admitted = await parity(db, shop.id, target.id, [pending, lateTrainee, pastTrainee]);
    expect(admitted).not.toContain(lateTrainee.id);
    expect(admitted).not.toContain(pastTrainee.id);
  });
});

describe("createInvitationUnderCooldown", () => {
  it("records one invite, then refuses a second inside the cooldown, even to another departure, before any mail went", async () => {
    const { db, shop, now, target, trip, diver } = await fixture();
    const author = await diver("Desk Author");
    const nadia = await diver("Cooldown Nadia");
    const other = await trip("Another wall dive", new Date(now.getTime() + 12 * DAY_MS));
    const input = { shopId: shop.id, personId: nadia.id, createdByPersonId: author.id, now };
    expect(await createInvitationUnderCooldown(db, { ...input, tripId: target.id })).toMatchObject({
      status: "created",
    });
    // Nothing was sent yet (no `invited_at`), and the recorded row still holds the cooldown.
    expect(await createInvitationUnderCooldown(db, { ...input, tripId: other.id })).toEqual({
      status: "cooldown",
    });
  });

  it("refuses a departure this diver could not book (below its level), recording nothing", async () => {
    const { db, shop, now, target, diver, card } = await fixture();
    const author = await diver("Desk Author Two");
    const ow = await diver("Open Water Only");
    await card(ow.id, "open_water");
    await db.insert(tripRequirements).values({
      shopId: shop.id,
      tripId: target.id,
      minimumCertificationLevel: "advanced_open_water",
    });
    expect(
      await createInvitationUnderCooldown(db, {
        shopId: shop.id,
        tripId: target.id,
        personId: ow.id,
        createdByPersonId: author.id,
        now,
      }),
    ).toEqual({ status: "unavailable" });
    expect(await invitedWithinCooldown(db, shop.id, ow.id, now)).toBe(false);
  });

  it("refuses someone referred to a physician since the page was drawn, recording nothing", async () => {
    const { db, shop, now, target, diver, referral } = await fixture();
    const author = await diver("Desk Author Three");
    const referred = await diver("Referred After Render");
    await referral(referred.id);
    expect(
      await createInvitationUnderCooldown(db, {
        shopId: shop.id,
        tripId: target.id,
        personId: referred.id,
        createdByPersonId: author.id,
        now,
      }),
    ).toEqual({ status: "unavailable" });
    expect(await invitedWithinCooldown(db, shop.id, referred.id, now)).toBe(false);
  });
});
