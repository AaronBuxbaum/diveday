import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import {
  getDiverMergePreview,
  listDiverMergeCandidates,
  listDiverMergeDuplicateIds,
  mergeDiverRecords,
} from "./diver-merge";
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
    })
    .returning({ id: waiverRecords.id });
  if (!row) throw new Error("release insert failed");
  return row.id;
}

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
  it("offers one mailbox written two ways", async () => {
    const f = await fixtures();
    const candidates = await listDiverMergeCandidates(f.db, f.shop.id, f.source.id);
    expect(candidates.find((c) => c.id === f.survivor.id)?.reasons).toEqual(["same_email"]);
    expect(await listDiverMergeDuplicateIds(f.db, f.shop.id)).toEqual(
      expect.arrayContaining([f.source.id, f.survivor.id]),
    );
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

  it("names every departure both records sit on, and refuses on it", async () => {
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
    expect(preview?.warnings).toEqual(["different_birth_dates", "releases_under_different_names"]);
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

    expect((await merge(f, { acknowledgeDifferentPeople: true })).ok).toBe(true);
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
