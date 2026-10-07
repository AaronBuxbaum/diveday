import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import {
  guardianEmailRedacted,
  verifyWaiverIntegrity,
  WAIVER_INTEGRITY_VERSION_ERASED,
  WAIVER_INTEGRITY_VERSION_GUARDIAN_REDACTED,
} from "@/lib/waiver-integrity";
import { seededShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import type { AppDb } from "./client";
import { eraseGuardianEmail, listGuardianEmails } from "./guardian-erasure";
import { people, personRoles, shops, waiverRecords } from "./schema";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";
import { refileWaiverRecords } from "./waiver-refile";
import { completeWaiver, getSignedWaiverForDiver, issueWaiverRequest } from "./waivers";

/**
 * **A guardian's address, erased on its own** (H-101, issue #1673). The
 * guardian is a third party who co-signed a minor's release; they may ask for
 * their address to go without the child's record going with it, and the
 * release has to go on verifying — as redacted, never as tampered.
 */

const now = new Date("2026-07-18T12:00:00.000Z");
const MINOR_DOB = "2014-05-01";
const clearAnswers = emptyMedicalAnswers(RSTC_QUESTIONNAIRE);

afterEach(() => {
  vi.unstubAllEnvs();
});

async function staffWithRole(db: AppDb, shopId: string, role: "owner" | "instructor") {
  const [row] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shopId), eq(personRoles.role, role)))
    .limit(1);
  if (!row) throw new Error(`expected a seeded ${role}`);
  return row.id;
}

async function fixtures() {
  vi.stubEnv("WAIVER_INTEGRITY_SECRET", "test-secret");
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const trip = trips.find((row) => row.title === "Two-Tank Reef — Molasses & French");
  if (!trip) throw new Error("demo trip missing");
  const roster = await getTripRoster(db, shop.id, trip.id);
  if (roster.length < 2) throw new Error("expected two seats on the demo trip");
  return {
    db,
    shop,
    roster,
    owner: await staffWithRole(db, shop.id, "owner"),
    instructor: await staffWithRole(db, shop.id, "instructor"),
  };
}

/** A minor's release on this seat, co-signed by `email` and sealed v1. */
async function coSignedRelease(
  db: AppDb,
  shopId: string,
  seat: { booking: { id: string }; person: { id: string; fullName: string } },
  email: string,
) {
  await db.update(people).set({ dateOfBirth: MINOR_DOB }).where(eq(people.id, seat.person.id));
  const issued = await issueWaiverRequest(db, { shopId, bookingId: seat.booking.id, now });
  if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
  const completed = await completeWaiver(db, issued.token, {
    signerName: seat.person.fullName,
    agreed: true,
    medicalAnswers: clearAnswers,
    guardian: { name: "Jonas Fischer", relationship: "parent", email, agreed: true },
    now,
  });
  if (!completed.ok) throw new Error("completion failed");
  return issued.recordId;
}

async function readRecord(db: AppDb, id: string) {
  const [row] = await db.select().from(waiverRecords).where(eq(waiverRecords.id, id));
  if (!row) throw new Error("record missing");
  return row;
}

describe("eraseGuardianEmail", () => {
  it("takes the address off and leaves a release that verifies as redacted", async () => {
    const { db, shop, roster, owner } = await fixtures();
    const [seat] = roster;
    if (!seat) throw new Error("seat missing");
    const id = await coSignedRelease(db, shop.id, seat, "jonas@example.com");
    const before = await readRecord(db, id);
    expect(verifyWaiverIntegrity(before)).toBe("valid");

    expect(
      await eraseGuardianEmail(db, {
        shopId: shop.id,
        personId: seat.person.id,
        email: " Jonas@Example.com",
        actorPersonId: owner,
        now,
      }),
    ).toEqual({ ok: true, erased: 1 });

    const after = await readRecord(db, id);
    expect(after.guardianEmail).toBeNull();
    expect(after.guardianEmailErasedAt?.toISOString()).toBe(now.toISOString());
    expect(after.guardianEmailErasedByPersonId).toBe(owner);
    expect(after.integrityVersion).toBe(WAIVER_INTEGRITY_VERSION_GUARDIAN_REDACTED);
    expect(verifyWaiverIntegrity(after)).toBe("valid");
    expect(guardianEmailRedacted(after)).toBe(true);
    // Everything that was not the guardian's address is exactly as signed.
    expect(after).toMatchObject({
      signedName: before.signedName,
      medicalAnswers: before.medicalAnswers,
      guardianName: "Jonas Fischer",
      guardianRelationship: "parent",
      guardianSignedAt: before.guardianSignedAt,
    });
    expect(await listGuardianEmails(db, shop.id, seat.person.id)).toEqual([]);
    // The staff view of the release carries the note, beside a seal that holds.
    const view = await getSignedWaiverForDiver(db, {
      shopId: shop.id,
      personId: seat.person.id,
      recordId: id,
      readsMedicalAnswers: false,
    });
    expect(view?.integrity).toBe("valid");
    expect(view?.guardianEmailErasedAt?.toISOString()).toBe(now.toISOString());
  });

  it("answers for the guardian across every child they co-signed for at this shop", async () => {
    const { db, shop, roster, owner } = await fixtures();
    const [first, second] = roster;
    if (!first || !second) throw new Error("seats missing");
    const one = await coSignedRelease(db, shop.id, first, "jonas@example.com");
    const two = await coSignedRelease(db, shop.id, second, "jonas@example.com");
    const result = await eraseGuardianEmail(db, {
      shopId: shop.id,
      personId: first.person.id,
      email: "jonas@example.com",
      actorPersonId: owner,
      now,
    });
    expect(result).toEqual({ ok: true, erased: 2 });
    for (const id of [one, two]) {
      const row = await readRecord(db, id);
      expect(row.guardianEmail).toBeNull();
      expect(verifyWaiverIntegrity(row)).toBe("valid");
    }
  });

  it("refuses a staffer without the erasure permission and writes nothing", async () => {
    const { db, shop, roster, instructor } = await fixtures();
    const [seat] = roster;
    if (!seat) throw new Error("seat missing");
    const id = await coSignedRelease(db, shop.id, seat, "jonas@example.com");
    expect(
      await eraseGuardianEmail(db, {
        shopId: shop.id,
        personId: seat.person.id,
        email: "jonas@example.com",
        actorPersonId: instructor,
      }),
    ).toEqual({ ok: false, reason: "not_authorized" });
    expect((await readRecord(db, id)).guardianEmail).toBe("jonas@example.com");
  });

  it("refuses an address that is not on this diver's releases", async () => {
    const { db, shop, roster, owner } = await fixtures();
    const [first, second] = roster;
    if (!first || !second) throw new Error("seats missing");
    const id = await coSignedRelease(db, shop.id, second, "jonas@example.com");
    // Named through a child whose release does not carry it.
    expect(
      await eraseGuardianEmail(db, {
        shopId: shop.id,
        personId: first.person.id,
        email: "jonas@example.com",
        actorPersonId: owner,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(
      await eraseGuardianEmail(db, {
        shopId: shop.id,
        personId: second.person.id,
        email: "   ",
        actorPersonId: owner,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect((await readRecord(db, id)).guardianEmail).toBe("jonas@example.com");
  });

  it("cannot reach another shop's releases, whatever person id or address it is handed", async () => {
    const { db, shop, roster } = await fixtures();
    const [seat] = roster;
    if (!seat) throw new Error("seat missing");
    const id = await coSignedRelease(db, shop.id, seat, "jonas@example.com");
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Reef", slug: "guardian-erasure-other", timezone: "UTC" })
      .returning();
    if (!other) throw new Error("shop insert failed");
    const [otherOwner] = await db
      .insert(people)
      .values({ shopId: other.id, fullName: "Other Owner", email: "owner@other.example" })
      .returning();
    if (!otherOwner) throw new Error("person insert failed");
    await db.insert(personRoles).values({ personId: otherOwner.id, role: "owner" });

    expect(
      await eraseGuardianEmail(db, {
        shopId: other.id,
        personId: seat.person.id,
        email: "jonas@example.com",
        actorPersonId: otherOwner.id,
      }),
    ).toMatchObject({ ok: false });
    // Nor by claiming the first shop while acting as the other shop's owner.
    expect(
      await eraseGuardianEmail(db, {
        shopId: shop.id,
        personId: seat.person.id,
        email: "jonas@example.com",
        actorPersonId: otherOwner.id,
      }),
    ).toEqual({ ok: false, reason: "not_authorized" });
    const row = await readRecord(db, id);
    expect(row.guardianEmail).toBe("jonas@example.com");
    expect(verifyWaiverIntegrity(row)).toBe("valid");
  });

  it("never launders a release whose seal already failed", async () => {
    const { db, shop, roster, owner } = await fixtures();
    const [seat] = roster;
    if (!seat) throw new Error("seat missing");
    const id = await coSignedRelease(db, shop.id, seat, "jonas@example.com");
    await db.update(waiverRecords).set({ templateBody: "edited" }).where(eq(waiverRecords.id, id));
    await eraseGuardianEmail(db, {
      shopId: shop.id,
      personId: seat.person.id,
      email: "jonas@example.com",
      actorPersonId: owner,
    });
    const row = await readRecord(db, id);
    expect(row.guardianEmail).toBeNull();
    expect(row.integrityVersion).toBe(1);
    expect(verifyWaiverIntegrity(row)).toBe("invalid");
  });

  it("refuses to put an erased address back", async () => {
    const { db, shop, roster, owner } = await fixtures();
    const [seat] = roster;
    if (!seat) throw new Error("seat missing");
    const id = await coSignedRelease(db, shop.id, seat, "jonas@example.com");
    await eraseGuardianEmail(db, {
      shopId: shop.id,
      personId: seat.person.id,
      email: "jonas@example.com",
      actorPersonId: owner,
    });
    await expect(
      db
        .update(waiverRecords)
        .set({ guardianEmail: "jonas@example.com" })
        .where(eq(waiverRecords.id, id)),
    ).rejects.toThrow();
  });

  it("keeps the redaction through a refile, and erasing the diver still seals as erased", async () => {
    const { db, shop, roster, owner } = await fixtures();
    const [first, second] = roster;
    if (!first || !second) throw new Error("seats missing");
    const id = await coSignedRelease(db, shop.id, first, "jonas@example.com");
    await eraseGuardianEmail(db, {
      shopId: shop.id,
      personId: first.person.id,
      email: "jonas@example.com",
      actorPersonId: owner,
    });

    await db.transaction((tx) =>
      refileWaiverRecords(tx, {
        shopId: shop.id,
        fromPersonId: first.person.id,
        toPersonId: second.person.id,
        actorPersonId: owner,
        now,
      }),
    );
    const moved = await readRecord(db, id);
    expect(moved.personId).toBe(second.person.id);
    expect(moved.integrityVersion).toBe(WAIVER_INTEGRITY_VERSION_GUARDIAN_REDACTED);
    expect(verifyWaiverIntegrity(moved)).toBe("valid");

    await db.update(people).set({ deletedAt: now }).where(eq(people.id, second.person.id));
    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: second.person.id,
      actorPersonId: owner,
    });
    expect(erased.ok).toBe(true);
    const after = await readRecord(db, id);
    expect(after.integrityVersion).toBe(WAIVER_INTEGRITY_VERSION_ERASED);
    expect(verifyWaiverIntegrity(after)).toBe("valid");
  });
});
