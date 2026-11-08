import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyWaiverIntegrity } from "@/lib/waiver-integrity";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "../features/anonymize/store";
import {
  clearAnswers,
  issueCounterLink,
  now,
  openOnDevice,
  waiverContextFor,
} from "../test/substrate-fixtures/db/waivers-test-fixtures";
import { people, personRoles, waiverRecords } from "./schema";
import { listStaff } from "./trips";
import { issueAndDeliverPersonWaiver } from "./waiver-issue";
import { completeWaiver, threadWaiverKey } from "./waivers-completion";
import { recordInPersonWaiver } from "./waivers-in-person";
import { issueWaiverRequest } from "./waivers-requests";

/**
 * **Which door signed a release** (issue #4045). A counter code and a link
 * mailed to the contact on file can both sign one release (#4008), and an
 * erasure deletes the link rows, so the release itself says which kind of
 * door its signature came through, inside its seal.
 */
const fileCtx = fileScopedShopContext();
const waiverContext = waiverContextFor(fileCtx);

afterEach(() => vi.unstubAllEnvs());

async function signedRecord(db: typeof fileCtx.db, recordId: string) {
  const [record] = await db.select().from(waiverRecords).where(eq(waiverRecords.id, recordId));
  if (!record) throw new Error("record missing");
  return record;
}

describe("the door a release was signed through", () => {
  it("records a counter code, sealed", async () => {
    const { db, shop, booking, person } = await waiverContext();
    const link = await issueCounterLink(db, { shopId: shop.id, bookingId: booking.id, now });
    const door = await openOnDevice(db, link.token, now);
    if (door?.door !== "counter") throw new Error("counter door expected");
    expect(
      await completeWaiver(db, door.key, {
        signerName: person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        now,
      }),
    ).toMatchObject({ ok: true });
    const record = await signedRecord(db, link.recordId);
    expect(record.signedVia).toBe("counter");
    expect(verifyWaiverIntegrity(record)).toBe("valid");
    expect(verifyWaiverIntegrity({ ...record, signedVia: "release_link" })).toBe("invalid");
  });

  it("records a release link mailed to the contact on file, sealed", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const { db, shop } = await waiverContext();
    const [person] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Mailed Diver", email: "mailed@dive.day" })
      .returning();
    if (!person) throw new Error("person insert failed");
    const issued = await issueWaiverRequest(db, { shopId: shop.id, personId: person.id, now });
    if (!issued.ok) throw new Error("release link refused");
    expect(issued.key.kind).toBe("release");
    expect(
      await completeWaiver(db, issued.key, {
        signerName: person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        now,
      }),
    ).toMatchObject({ ok: true });
    const record = await signedRecord(db, issued.recordId);
    expect(record.signedVia).toBe("release_link");
    expect(verifyWaiverIntegrity(record)).toBe("valid");
  });

  it("records the diver's own thread, and a party lead's door on it", async () => {
    const { db, shop, booking, person } = await waiverContext();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("thread release refused");
    const signature = {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      now,
    };
    expect(await completeWaiver(db, issued.key, signature)).toMatchObject({ ok: true });
    expect((await signedRecord(db, issued.recordId)).signedVia).toBe("thread");

    // A fresh release on the same seat, signed through a party lead's door.
    await db
      .update(waiverRecords)
      .set({ supersededAt: now })
      .where(eq(waiverRecords.id, issued.recordId));
    const reopened = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!reopened.ok) throw new Error("second release refused");
    const party = await threadWaiverKey(
      db,
      { shopId: shop.id, bookingId: booking.id },
      "party_door",
    );
    if (!party) throw new Error("party key refused");
    expect(await completeWaiver(db, party, signature)).toMatchObject({ ok: true });
    const record = await signedRecord(db, reopened.recordId);
    expect(record.signedVia).toBe("party_door");
    expect(verifyWaiverIntegrity(record)).toBe("valid");
  });

  it("records a paper release the desk attested, sealed", async () => {
    const { db, shop, booking } = await waiverContext();
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("demo staff missing");
    const outcome = await recordInPersonWaiver(db, {
      shopId: shop.id,
      subject: { bookingId: booking.id },
      recordedByPersonId: staff.person.id,
      medicalAttested: true,
      now,
    });
    if (!outcome.ok) throw new Error("paper release refused");
    const record = await signedRecord(db, outcome.recordId);
    expect(record.signedVia).toBe("desk");
    expect(verifyWaiverIntegrity(record)).toBe("valid");
  });

  it("survives an erasure inside the erased seal, with no link left to chase", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const { db, shop } = await waiverContext();
    const [owner] = await db
      .select({ personId: personRoles.personId })
      .from(personRoles)
      .innerJoin(people, eq(people.id, personRoles.personId))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    if (!owner) throw new Error("owner missing");
    const [person] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Erased Diver", email: "erased@dive.day" })
      .returning();
    if (!person) throw new Error("person insert failed");
    const copied = await issueAndDeliverPersonWaiver(db, shop.id, person.id, {
      channel: "link",
      actorPersonId: owner.personId,
      now,
    });
    if (!copied.ok || !copied.token) throw new Error("copy link refused");
    const door = await openOnDevice(db, copied.token, now);
    if (door?.door !== "counter") throw new Error("counter door expected");
    await completeWaiver(db, door.key, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      now,
    });
    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: person.id,
      actorPersonId: owner.personId,
    });
    expect(erased).toMatchObject({ ok: true });
    const record = await signedRecord(db, door.key.recordId);
    expect(record.anonymizedAt).not.toBeNull();
    expect(record.signedVia).toBe("counter");
    expect(verifyWaiverIntegrity(record)).toBe("valid");
  });
});
