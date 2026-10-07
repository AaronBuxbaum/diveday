import { and, eq, gt } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { guardianSignatureMissing } from "@/lib/guardian";
import { seededShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import {
  getDiverMergePreview,
  listDiverMergeCandidates,
  listDiverMergeDuplicateIds,
  mergeDiverRecords,
} from "./diver-merge";
import { recordInboundMessage } from "./inbound-messages";
import { listTripReadiness } from "./readiness";
import {
  activityEvents,
  bookings,
  people,
  personRoles,
  rentalFitProfiles,
  shops,
  trips,
  waiverRecords,
  waiverTemplates,
} from "./schema";

/**
 * The staffer's half of a merge: the side-by-side they read first, the winner
 * they pick for each field the two records disagree on, and the pause when the
 * two records might be two people. `diver-merge.test.ts` holds the moving half.
 */

async function fixtures() {
  const { db, shop } = await seededShopContext();
  const [owner] = await db
    .select({ id: people.id, fullName: people.fullName })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  const [trip] = await db
    .select({ id: trips.id, title: trips.title })
    .from(trips)
    .where(eq(trips.shopId, shop.id))
    .limit(1);
  if (!owner || !trip) throw new Error("fixture needs the seeded owner and a trip");
  const [source, survivor] = await db
    .insert(people)
    .values([
      {
        shopId: shop.id,
        fullName: "Maya Rivera",
        email: "maya.rivera+dive@gmail.com",
        phone: "+1 305 555 0142",
        emergencyContactName: "Luis Rivera",
        emergencyContactPhone: "+1 305 555 0100",
      },
      {
        shopId: shop.id,
        fullName: "Maya R. Rivera",
        email: "mayarivera@gmail.com",
        phone: "+1 786 555 0199",
        emergencyContactName: "Ana Rivera",
        emergencyContactPhone: "+1 786 555 0111",
      },
    ])
    .returning();
  if (!source || !survivor) throw new Error("fixture people insert failed");
  await db.insert(personRoles).values([
    { personId: source.id, role: "diver" },
    { personId: survivor.id, role: "diver" },
  ]);
  return { db, shop, owner, trip, source, survivor };
}

type Db = Awaited<ReturnType<typeof fixtures>>["db"];

async function signedRelease(
  db: Db,
  shopId: string,
  personId: string,
  signedName: string,
  medical = false,
  extra: Partial<typeof waiverRecords.$inferInsert> = {},
) {
  const [template] = await db
    .select()
    .from(waiverTemplates)
    .where(eq(waiverTemplates.shopId, shopId))
    .limit(1);
  if (!template) throw new Error("expected a seeded waiver template");
  const signedAt = nowDate();
  const [row] = await db
    .insert(waiverRecords)
    .values({
      shopId,
      personId,
      templateId: template.id,
      templateTitle: template.title,
      templateVersion: template.version,
      templateBody: template.body,
      status: "completed",
      signedName,
      signatureMethod: "typed",
      tokenHash: `hash-${crypto.randomUUID()}`,
      expiresAt: signedAt,
      consentedAt: signedAt,
      signedAt,
      completedAt: signedAt,
      medicalAnswers: medical
        ? { questionnaireId: "rstc", questionnaireVersion: 1, responses: { q1: false } }
        : null,
      ...extra,
    })
    .returning({ id: waiverRecords.id });
  if (!row) throw new Error("release insert failed");
  return row.id;
}

/** What the preview's ticked box posts for this pair right now. */
async function acknowledgement(
  f: Awaited<ReturnType<typeof fixtures>>,
  personId = f.source.id,
  survivorId = f.survivor.id,
) {
  const preview = await getDiverMergePreview(f.db, f.shop.id, personId, survivorId);
  if (!preview) throw new Error("expected a preview");
  return preview.acknowledgement;
}

const HOUR = 60 * 60 * 1000;

function merge(
  f: Awaited<ReturnType<typeof fixtures>>,
  extra: Partial<Parameters<typeof mergeDiverRecords>[0]> = {},
) {
  return mergeDiverRecords({
    db: f.db,
    shopId: f.shop.id,
    personId: f.source.id,
    survivorId: f.survivor.id,
    actorPersonId: f.owner.id,
    ...extra,
  });
}

describe("likely duplicates", () => {
  it("never reads plus-tagged addresses as one mailbox, so the seeded roster is not one family", async () => {
    // Every seeded diver is `success+<name>@simulator.amazonses.com`. With the
    // tag folded away every diver was a duplicate of every other (visual
    // triage of #2218): ~140 candidates on one record, every roster row badged.
    const f = await fixtures();
    const [priya] = await f.db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, f.shop.id), eq(people.fullName, "Priya Sharma")))
      .limit(1);
    if (!priya) throw new Error("expected seeded Priya");
    const candidates = await listDiverMergeCandidates(f.db, f.shop.id, priya.id);
    expect(candidates.some((c) => c.reasons.includes("same_email"))).toBe(false);
    expect(candidates.length).toBeLessThan(5);
    expect((await listDiverMergeDuplicateIds(f.db, f.shop.id)).length).toBeLessThan(10);
  });

  it("offers a shared phone, strongest candidates first", async () => {
    const f = await fixtures();
    await f.db.update(people).set({ phone: "+1 305 555 0142" }).where(eq(people.id, f.survivor.id));
    const [namesake] = await f.db
      .insert(people)
      .values({ shopId: f.shop.id, fullName: "Maya Rivera", phone: "+1 305 555 0142" })
      .returning({ id: people.id });
    if (!namesake) throw new Error("insert failed");
    await f.db.insert(personRoles).values({ personId: namesake.id, role: "diver" });
    const candidates = await listDiverMergeCandidates(f.db, f.shop.id, f.source.id);
    // Phone and name outrank phone alone, whatever the alphabet says.
    expect(candidates.slice(0, 2).map((c) => [c.id, c.reasons])).toEqual([
      [namesake.id, ["same_phone", "same_name"]],
      [f.survivor.id, ["same_phone"]],
    ]);
  });

  it("offers the same name and birth date, and never a namesake born on another day", async () => {
    const { db, shop } = await seededShopContext();
    const rows = await db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Tomás Okafor", dateOfBirth: "1988-03-14" },
        { shopId: shop.id, fullName: "tomas okafor", dateOfBirth: "1988-03-14" },
        { shopId: shop.id, fullName: "Tomás Okafor", dateOfBirth: "2014-07-01" },
      ])
      .returning({ id: people.id });
    const [father, again, son] = rows;
    if (!father || !again || !son) throw new Error("insert failed");
    await db
      .insert(personRoles)
      .values(rows.map((row) => ({ personId: row.id, role: "diver" as const })));

    const candidates = await listDiverMergeCandidates(db, shop.id, father.id);
    expect(candidates.find((c) => c.id === again.id)?.reasons).toEqual([
      "same_name_and_birth_date",
    ]);
    expect(candidates.some((c) => c.id === son.id)).toBe(false);
    const flagged = await listDiverMergeDuplicateIds(db, shop.id);
    expect(flagged).toEqual(expect.arrayContaining([father.id, again.id]));
    expect(flagged).not.toContain(son.id);
  });
});

describe("the merge preview", () => {
  it("lays both records side by side with the fields they disagree on", async () => {
    const f = await fixtures();
    await f.db
      .insert(bookings)
      .values({ shopId: f.shop.id, tripId: f.trip.id, personId: f.source.id });
    await signedRelease(f.db, f.shop.id, f.source.id, "Maya Rivera", true);
    await f.db.insert(rentalFitProfiles).values([
      { shopId: f.shop.id, personId: f.source.id, bcdSize: "M", finSize: "M" },
      { shopId: f.shop.id, personId: f.survivor.id, bcdSize: "L", finSize: "M" },
    ]);

    const preview = await getDiverMergePreview(f.db, f.shop.id, f.source.id, f.survivor.id);
    expect(preview).not.toBeNull();
    expect(preview?.refusal).toBeNull();
    expect(preview?.conflicts).toEqual([
      "fullName",
      "email",
      "phone",
      "emergencyContact",
      "rentalFit",
    ]);
    expect(preview?.source.counts.bookings).toBe(1);
    expect(preview?.source.counts.releases).toBe(1);
    expect(preview?.source.medicalAnswers).toBe(1);
    expect(preview?.survivor.counts.bookings).toBe(0);
    expect(preview?.source.rentalFit?.bcdSize).toBe("M");
    // "Maya Rivera" and "Maya R. Rivera" are one name to the signature check.
    expect(preview?.warnings).toEqual([]);
  });

  it("names every departure both records sit on, and refuses even when one seat is cancelled", async () => {
    const f = await fixtures();
    await f.db.insert(bookings).values([
      { shopId: f.shop.id, tripId: f.trip.id, personId: f.source.id },
      { shopId: f.shop.id, tripId: f.trip.id, personId: f.survivor.id, status: "cancelled" },
    ]);
    const preview = await getDiverMergePreview(f.db, f.shop.id, f.source.id, f.survivor.id);
    expect(preview?.refusal).toBe("booking_conflict");
    expect(preview?.sharedDepartures).toEqual([
      expect.objectContaining({ tripId: f.trip.id, title: f.trip.title }),
    ]);
    expect(await merge(f)).toEqual({ ok: false, reason: "booking_conflict" });
  });

  it("warns when the birth dates differ or releases were signed under different names", async () => {
    const f = await fixtures();
    await f.db.update(people).set({ dateOfBirth: "1990-04-02" }).where(eq(people.id, f.source.id));
    await f.db
      .update(people)
      .set({ dateOfBirth: "1992-11-20" })
      .where(eq(people.id, f.survivor.id));
    await signedRelease(f.db, f.shop.id, f.source.id, "Maya Rivera");
    await signedRelease(f.db, f.shop.id, f.survivor.id, "Carmen Diaz", true);

    const preview = await getDiverMergePreview(f.db, f.shop.id, f.source.id, f.survivor.id);
    expect(preview?.warnings).toEqual([
      "different_birth_dates",
      "both_hold_cards_or_releases",
      "releases_under_different_names",
    ]);
    expect(preview?.releaseNames.sort()).toEqual(["Carmen Diaz", "Maya Rivera"]);
  });

  it("warns when one person's release would land on a record under another name", async () => {
    const f = await fixtures();
    await f.db.update(people).set({ fullName: "Carmen Diaz" }).where(eq(people.id, f.survivor.id));
    // One release, on the record merged away; the kept record has none.
    await signedRelease(f.db, f.shop.id, f.source.id, "Maya Rivera", true);
    const preview = await getDiverMergePreview(f.db, f.shop.id, f.source.id, f.survivor.id);
    expect(preview?.warnings).toEqual(["releases_under_different_names"]);
    expect(await merge(f)).toEqual({ ok: false, reason: "different_people_unacknowledged" });
  });

  it("asks nothing when two spellings of a name have no release behind them", async () => {
    const f = await fixtures();
    await f.db.update(people).set({ fullName: "Carmen Diaz" }).where(eq(people.id, f.survivor.id));
    const preview = await getDiverMergePreview(f.db, f.shop.id, f.source.id, f.survivor.id);
    expect(preview?.warnings).toEqual([]);
  });

  it("flags an open medical hold and a declined clearance on the side that holds each", async () => {
    const f = await fixtures();
    await signedRelease(f.db, f.shop.id, f.source.id, "Maya Rivera", true, {
      status: "medical_review",
      medicalReviewRequired: true,
    });
    await signedRelease(f.db, f.shop.id, f.survivor.id, "Maya R. Rivera", true, {
      status: "medical_review",
      medicalReviewRequired: true,
      medicalClearanceDeclinedAt: nowDate(),
      medicalClearanceDeclinedByPersonId: f.owner.id,
      medicalClearanceEvaluatedOn: "2026-07-20",
      medicalClearancePhysicianName: "Dr. Imani Hale",
    });
    const preview = await getDiverMergePreview(f.db, f.shop.id, f.source.id, f.survivor.id);
    expect(preview?.source.medical).toEqual({ openMedicalHold: true, declinedClearance: false });
    expect(preview?.survivor.medical.declinedClearance).toBe(true);
    expect(preview?.warnings).toEqual(
      expect.arrayContaining(["open_medical_hold", "declined_clearance"]),
    );
    expect(await merge(f)).toEqual({ ok: false, reason: "different_people_unacknowledged" });
  });

  it("refuses while either record sits on a departure that is out now, and not once it is back", async () => {
    const f = await fixtures();
    const now = nowDate().getTime();
    await f.db
      .update(trips)
      .set({ startsAt: new Date(now - HOUR), endsAt: new Date(now + 2 * HOUR) })
      .where(eq(trips.id, f.trip.id));
    await f.db
      .insert(bookings)
      .values({ shopId: f.shop.id, tripId: f.trip.id, personId: f.survivor.id });
    const preview = await getDiverMergePreview(f.db, f.shop.id, f.source.id, f.survivor.id);
    expect(preview?.refusal).toBe("departure_underway");
    expect(await merge(f)).toEqual({ ok: false, reason: "departure_underway" });

    await f.db
      .update(trips)
      .set({ startsAt: new Date(now - 6 * HOUR), endsAt: new Date(now - 2 * HOUR) })
      .where(eq(trips.id, f.trip.id));
    expect((await merge(f)).ok).toBe(true);
  });

  it("answers null rather than lay a staff record's details beside a diver's", async () => {
    const f = await fixtures();
    await f.db.insert(personRoles).values({ personId: f.survivor.id, role: "captain" });
    expect(await getDiverMergePreview(f.db, f.shop.id, f.source.id, f.survivor.id)).toBeNull();
    expect(await getDiverMergePreview(f.db, f.shop.id, f.survivor.id, f.source.id)).toBeNull();
    const [roleless] = await f.db
      .insert(people)
      .values({ shopId: f.shop.id, fullName: "Maya Rivera" })
      .returning({ id: people.id });
    if (!roleless) throw new Error("insert failed");
    expect(await getDiverMergePreview(f.db, f.shop.id, f.source.id, roleless.id)).toBeNull();
  });

  it("answers null for one record twice and for a record in another shop", async () => {
    const f = await fixtures();
    expect(await getDiverMergePreview(f.db, f.shop.id, f.source.id, f.source.id)).toBeNull();
    const [otherShop] = await f.db
      .insert(shops)
      .values({ slug: `elsewhere-${f.source.id.slice(0, 8)}`, name: "Elsewhere", timezone: "UTC" })
      .returning({ id: shops.id });
    if (!otherShop) throw new Error("shop insert failed");
    const [stranger] = await f.db
      .insert(people)
      .values({ shopId: otherShop.id, fullName: "Maya Rivera" })
      .returning({ id: people.id });
    if (!stranger) throw new Error("insert failed");
    await f.db.insert(personRoles).values({ personId: stranger.id, role: "diver" });
    expect(await getDiverMergePreview(f.db, f.shop.id, f.source.id, stranger.id)).toBeNull();
    // Nor from the other shop's side, naming this shop's diver.
    expect(await getDiverMergePreview(f.db, otherShop.id, stranger.id, f.source.id)).toBeNull();
  });
});

describe("choosing which value wins", () => {
  it("keeps the kept record's values when the staffer chose nothing", async () => {
    const f = await fixtures();
    expect((await merge(f)).ok).toBe(true);
    const [kept] = await f.db.select().from(people).where(eq(people.id, f.survivor.id));
    expect(kept).toMatchObject({
      fullName: "Maya R. Rivera",
      email: "mayarivera@gmail.com",
      phone: "+1 786 555 0199",
      emergencyContactName: "Ana Rivera",
      emergencyContactPhone: "+1 786 555 0111",
    });
  });

  it("takes each chosen field from the record merged away, the contact as one pair", async () => {
    const f = await fixtures();
    await f.db.update(people).set({ dateOfBirth: "1990-04-02" }).where(eq(people.id, f.source.id));
    const result = await merge(f, {
      choices: {
        fullName: "source",
        email: "source",
        phone: "source",
        dateOfBirth: "source",
        emergencyContact: "source",
      },
    });
    expect(result.ok).toBe(true);
    const [kept] = await f.db.select().from(people).where(eq(people.id, f.survivor.id));
    expect(kept).toMatchObject({
      fullName: "Maya Rivera",
      // The merged-away record's address, taken over although that record
      // still holds it: it left the live unique index the moment it merged.
      email: "maya.rivera+dive@gmail.com",
      phone: "+1 305 555 0142",
      dateOfBirth: "1990-04-02",
      emergencyContactName: "Luis Rivera",
      emergencyContactPhone: "+1 305 555 0100",
    });
  });

  it("keeps the chosen sizes and drops the other profile", async () => {
    const f = await fixtures();
    await f.db.insert(rentalFitProfiles).values([
      { shopId: f.shop.id, personId: f.source.id, bcdSize: "M", bootSize: "9" },
      { shopId: f.shop.id, personId: f.survivor.id, bcdSize: "L", bootSize: "11" },
    ]);
    expect((await merge(f, { choices: { rentalFit: "source" } })).ok).toBe(true);
    const fits = await f.db
      .select()
      .from(rentalFitProfiles)
      .where(eq(rentalFitProfiles.personId, f.survivor.id));
    expect(fits.map((fit) => [fit.bcdSize, fit.bootSize])).toEqual([["M", "9"]]);
    expect(
      await f.db
        .select()
        .from(rentalFitProfiles)
        .where(eq(rentalFitProfiles.personId, f.source.id)),
    ).toEqual([]);
  });

  it("writes one line on the kept record naming both", async () => {
    const f = await fixtures();
    await merge(f, { choices: { fullName: "source" } });
    const lines = await f.db
      .select()
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.subjectPersonId, f.survivor.id),
          eq(activityEvents.code, "diver_merged"),
        ),
      );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.params).toEqual({
      actor: f.owner.fullName,
      diver: "Maya Rivera",
      merged: "Maya Rivera",
    });
  });
});

describe("two people's legal records", () => {
  it("refuses until the staffer says they are one person, then keeps every release and answer", async () => {
    const f = await fixtures();
    const mine = await signedRelease(f.db, f.shop.id, f.source.id, "Maya Rivera", true);
    const theirs = await signedRelease(f.db, f.shop.id, f.survivor.id, "Carmen Diaz", true);

    expect(await merge(f)).toEqual({ ok: false, reason: "different_people_unacknowledged" });
    const [untouched] = await f.db.select().from(people).where(eq(people.id, f.source.id));
    expect(untouched?.mergedIntoPersonId).toBeNull();

    expect((await merge(f, { acknowledged: await acknowledgement(f) })).ok).toBe(true);
    const releases = await f.db
      .select({ id: waiverRecords.id, answers: waiverRecords.medicalAnswers })
      .from(waiverRecords)
      .where(eq(waiverRecords.personId, f.survivor.id));
    expect(releases.map((r) => r.id).sort()).toEqual([mine, theirs].sort());
    expect(releases.every((r) => r.answers !== null)).toBe(true);
  });

  it("refuses two different birth dates without the acknowledgement", async () => {
    const f = await fixtures();
    await f.db.update(people).set({ dateOfBirth: "1990-04-02" }).where(eq(people.id, f.source.id));
    await f.db
      .update(people)
      .set({ dateOfBirth: "1992-11-20" })
      .where(eq(people.id, f.survivor.id));
    expect(await merge(f)).toEqual({ ok: false, reason: "different_people_unacknowledged" });
  });

  it("asks before merging a namesake with no date of birth, and the child's medical hold stands", async () => {
    const f = await fixtures();
    // A parent and a child under one name, nothing else in common, and only
    // the parent's record carries a date: the case B1 of the domain review.
    const [parent, child] = await f.db
      .insert(people)
      .values([
        {
          shopId: f.shop.id,
          fullName: "Ana Sol",
          email: "ana.sol@example.com",
          dateOfBirth: "1980-02-02",
        },
        { shopId: f.shop.id, fullName: "Ana Sol", email: "anasol.kid@example.com" },
      ])
      .returning();
    if (!parent || !child) throw new Error("insert failed");
    await f.db.insert(personRoles).values([
      { personId: parent.id, role: "diver" },
      { personId: child.id, role: "diver" },
    ]);
    const now = nowDate().getTime();
    await f.db
      .update(trips)
      .set({ startsAt: new Date(now + 48 * HOUR), endsAt: new Date(now + 52 * HOUR) })
      .where(eq(trips.id, f.trip.id));
    const [seat] = await f.db
      .insert(bookings)
      .values({ shopId: f.shop.id, tripId: f.trip.id, personId: child.id })
      .returning({ id: bookings.id });
    if (!seat) throw new Error("booking insert failed");
    const yesterday = new Date(nowDate().getTime() - 24 * HOUR);
    const hold = await signedRelease(f.db, f.shop.id, child.id, "Ana Sol", true, {
      status: "medical_review",
      medicalReviewRequired: true,
      bookingId: seat.id,
      signedAt: yesterday,
      completedAt: yesterday,
      consentedAt: yesterday,
    });
    await signedRelease(f.db, f.shop.id, parent.id, "Ana Sol");

    const pair = { personId: child.id, survivorId: parent.id };
    const preview = await getDiverMergePreview(f.db, f.shop.id, child.id, parent.id);
    expect(preview?.warnings).toEqual(
      expect.arrayContaining([
        "birth_date_unknown_on_one_record",
        "both_hold_cards_or_releases",
        "open_medical_hold",
      ]),
    );
    expect(await merge(f, pair)).toEqual({ ok: false, reason: "different_people_unacknowledged" });

    const governing = async () =>
      (await listTripReadiness(f.db, f.shop.id, f.trip.id)).find(
        (row) => row.booking.id === seat.id,
      )?.waiver?.id;
    expect(await governing()).toBe(hold);
    // Acknowledged, the hold on the seat it was signed for still governs it:
    // the parent's newer clean release does not stand in for the child's.
    expect(
      (await merge(f, { ...pair, acknowledged: await acknowledgement(f, child.id, parent.id) })).ok,
    ).toBe(true);
    expect(await governing()).toBe(hold);
  });

  it("refuses an acknowledgement given for a different set of warnings", async () => {
    const f = await fixtures();
    await f.db.update(people).set({ dateOfBirth: "1990-04-02" }).where(eq(people.id, f.source.id));
    await f.db
      .update(people)
      .set({ dateOfBirth: "1992-11-20" })
      .where(eq(people.id, f.survivor.id));
    const read = await acknowledgement(f);
    // A release lands on each record after the staffer read the comparison.
    await signedRelease(f.db, f.shop.id, f.source.id, "Maya Rivera");
    await signedRelease(f.db, f.shop.id, f.survivor.id, "Carmen Diaz");
    expect(await merge(f, { acknowledged: read })).toEqual({
      ok: false,
      reason: "assessment_changed",
    });
    expect(await merge(f, { acknowledged: "yes" })).toEqual({
      ok: false,
      reason: "assessment_changed",
    });
    const [untouched] = await f.db.select().from(people).where(eq(people.id, f.source.id));
    expect(untouched?.mergedIntoPersonId).toBeNull();
  });

  it("lets the date kept decide whether a minor's release still needs a guardian", async () => {
    for (const [choice, missing] of [
      ["source", true],
      ["survivor", false],
    ] as const) {
      const f = await fixtures();
      await f.db
        .update(people)
        .set({ dateOfBirth: "2012-05-01" })
        .where(eq(people.id, f.source.id));
      await f.db
        .update(people)
        .set({ dateOfBirth: "1985-01-01" })
        .where(eq(people.id, f.survivor.id));
      const release = await signedRelease(f.db, f.shop.id, f.source.id, "Maya Rivera");
      const result = await merge(f, {
        choices: { dateOfBirth: choice },
        acknowledged: await acknowledgement(f),
      });
      expect(result.ok).toBe(true);
      const [kept] = await f.db.select().from(people).where(eq(people.id, f.survivor.id));
      const [record] = await f.db.select().from(waiverRecords).where(eq(waiverRecords.id, release));
      if (!kept || !record) throw new Error("expected the kept record and its release");
      expect(
        guardianSignatureMissing(record, {
          dateOfBirth: kept.dateOfBirth,
          timezone: f.shop.timezone,
        }),
        choice,
      ).toBe(missing);
    }
  });

  it("leaves an erased release on the record it was erased under", async () => {
    const f = await fixtures();
    const erased = await signedRelease(f.db, f.shop.id, f.source.id, "Maya Rivera");
    await f.db
      .update(waiverRecords)
      .set({ anonymizedAt: nowDate() })
      .where(eq(waiverRecords.id, erased));
    expect((await merge(f)).ok).toBe(true);
    const [row] = await f.db.select().from(waiverRecords).where(eq(waiverRecords.id, erased));
    expect(row?.personId).toBe(f.source.id);
  });
});

describe("adversarial merges", () => {
  it("refuses a record merged into itself", async () => {
    const f = await fixtures();
    expect(await merge(f, { survivorId: f.source.id })).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a record already merged, from either side", async () => {
    const f = await fixtures();
    expect((await merge(f)).ok).toBe(true);
    const [third] = await f.db
      .insert(people)
      .values({ shopId: f.shop.id, fullName: "Maya Rivera" })
      .returning({ id: people.id });
    if (!third) throw new Error("insert failed");
    await f.db.insert(personRoles).values({ personId: third.id, role: "diver" });
    // Merging the merged-away record again, into anyone.
    expect(await merge(f, { survivorId: third.id })).toEqual({
      ok: false,
      reason: "already_merged",
    });
    // Or merging somebody into it.
    expect(await merge(f, { personId: third.id, survivorId: f.source.id })).toEqual({
      ok: false,
      reason: "already_merged",
    });
    // A replay of the same merge.
    expect(await merge(f)).toEqual({ ok: false, reason: "already_merged" });
  });

  it("lets exactly one of two opposite merges started together win", async () => {
    const f = await fixtures();
    const outcomes = await Promise.all([
      merge(f),
      merge(f, { personId: f.survivor.id, survivorId: f.source.id }),
    ]);
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(outcomes.filter((o) => !o.ok)).toEqual([{ ok: false, reason: "already_merged" }]);
    const both = await f.db
      .select({ id: people.id, into: people.mergedIntoPersonId })
      .from(people)
      .where(eq(people.shopId, f.shop.id));
    const pointers = both.filter((row) => row.id === f.source.id || row.id === f.survivor.id);
    // Never a cycle: exactly one of the two points at the other.
    expect(pointers.filter((row) => row.into !== null)).toHaveLength(1);
  });

  it("refuses a staffer from another shop with a valid owner of their own", async () => {
    const f = await fixtures();
    expect(await merge(f, { shopId: crypto.randomUUID() })).toEqual({
      ok: false,
      reason: "not_authorized",
    });
  });
});

describe("writes aimed at a record merged away", () => {
  it("refuses a booking for the merged-away id", async () => {
    const f = await fixtures();
    expect((await merge(f)).ok).toBe(true);
    const [future] = await f.db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.shopId, f.shop.id), gt(trips.startsAt, nowDate())))
      .limit(1);
    if (!future) throw new Error("expected a seeded future departure");
    const result = await createBooking(f.db, {
      actor: "staff",
      shopId: f.shop.id,
      tripId: future.id,
      personId: f.source.id,
    });
    expect(result).toMatchObject({ ok: false, reason: "person_not_found" });
    expect(await f.db.select().from(bookings).where(eq(bookings.personId, f.source.id))).toEqual(
      [],
    );
  });

  it("files a message from the merged-away record's address on the kept record", async () => {
    const f = await fixtures();
    // The kept record takes the address, and the deleted row still holds it too.
    expect((await merge(f, { choices: { email: "source" } })).ok).toBe(true);
    const result = await recordInboundMessage(f.db, {
      shopId: f.shop.id,
      channel: "email",
      fromAddress: "maya.rivera+dive@gmail.com",
      subject: "Saturday",
      body: "Running late",
      receivedAt: nowDate(),
      providerMessageId: `merge-${f.source.id}`,
    });
    expect(result).toMatchObject({ status: "recorded", personId: f.survivor.id });
  });
});
