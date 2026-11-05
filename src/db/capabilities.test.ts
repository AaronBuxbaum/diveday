import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { hashBearerToken } from "@/lib/bearer-tokens";
import { CAPABILITY_POLICY, CAPABILITY_PURPOSES, type CapabilityPurpose } from "@/lib/capabilities";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { issueCapability, verifyCapability } from "./capabilities";
import { mergeDiverRecords } from "./diver-merge";
import { askAnytime } from "./interests";
import { findOrCreatePerson } from "./people";
import { capabilities, people, personRoles, shops } from "./schema";

/**
 * Issue #2710, security-sensitive (bearer tokens): one table, one verify, the
 * purpose in its predicate. The rows below are adversarial on purpose: a token
 * never crosses purposes, the table refuses a row naming the wrong subject, and
 * the database never holds a usable token.
 */
const ctx = fileScopedShopContext();

async function subjects() {
  const { db, shop } = ctx;
  const { person } = await findOrCreatePerson(db, {
    shopId: shop.id,
    fullName: "Nora Quinn",
    email: "nora-capability@example.com",
    origin: "counter",
  });
  const joined = await askAnytime(db, {
    shopId: shop.id,
    fullName: "Ines Mora",
    email: "ines-capability@example.com",
  } as never);
  return { personId: person.id, interestId: joined.interestId };
}

function subjectFor(
  purpose: CapabilityPurpose,
  ids: { personId: string; interestId: string },
): string {
  return CAPABILITY_POLICY[purpose].subject === "interest" ? ids.interestId : ids.personId;
}

describe("issueCapability and verifyCapability", () => {
  it.each(CAPABILITY_PURPOSES)(
    "%s: verifies under its own purpose and no other",
    async (purpose) => {
      const { db, shop } = ctx;
      const ids = await subjects();
      const subjectId = subjectFor(purpose, ids);
      const token = await issueCapability(db, { purpose, shopId: shop.id, subjectId });

      expect(await verifyCapability(db, { purpose, token })).toMatchObject({
        shopId: shop.id,
        subjectId,
      });
      for (const other of CAPABILITY_PURPOSES.filter((p) => p !== purpose)) {
        expect(await verifyCapability(db, { purpose: other, token })).toBeNull();
      }
    },
  );

  it.each(CAPABILITY_PURPOSES)(
    "%s: writes the policy's subject column and only that",
    async (purpose) => {
      const { db, shop } = ctx;
      const ids = await subjects();
      const token = await issueCapability(db, {
        purpose,
        shopId: shop.id,
        subjectId: subjectFor(purpose, ids),
      });
      const [row] = await db
        .select()
        .from(capabilities)
        .where(eq(capabilities.tokenHash, hashBearerToken(token)));
      if (CAPABILITY_POLICY[purpose].subject === "interest") {
        expect(row).toMatchObject({ interestId: ids.interestId, personId: null });
      } else {
        expect(row).toMatchObject({ personId: ids.personId, interestId: null });
      }
    },
  );

  it("stores only the digest: the token itself, or its digest presented as a token, verifies nothing", async () => {
    const { db, shop } = ctx;
    const ids = await subjects();
    const token = await issueCapability(db, {
      purpose: "courtesy_email_unsubscribe",
      shopId: shop.id,
      subjectId: ids.personId,
    });
    const rows = await db.select({ tokenHash: capabilities.tokenHash }).from(capabilities);
    expect(rows.map((r) => r.tokenHash)).not.toContain(token);
    const stored = hashBearerToken(token);
    expect(
      await verifyCapability(db, { purpose: "courtesy_email_unsubscribe", token: stored }),
    ).toBeNull();
  });

  it("refuses an unknown token, an empty one and a near miss", async () => {
    const { db, shop } = ctx;
    const ids = await subjects();
    const token = await issueCapability(db, {
      purpose: "interest_unsubscribe",
      shopId: shop.id,
      subjectId: ids.interestId,
    });
    for (const guess of ["", "not-a-token", `${token}x`, token.slice(0, -1)]) {
      expect(
        await verifyCapability(db, { purpose: "interest_unsubscribe", token: guess }),
      ).toBeNull();
    }
  });

  it("mints a new link on every call and keeps the earlier one working", async () => {
    const { db, shop } = ctx;
    const ids = await subjects();
    const input = {
      purpose: "courtesy_email_unsubscribe" as const,
      shopId: shop.id,
      subjectId: ids.personId,
    };
    const first = await issueCapability(db, input);
    const second = await issueCapability(db, input);
    expect(second).not.toBe(first);
    expect(await verifyCapability(db, { purpose: input.purpose, token: first })).not.toBeNull();
    expect(await verifyCapability(db, { purpose: input.purpose, token: second })).not.toBeNull();
  });
});

describe("capabilities_subject_by_purpose", () => {
  it("refuses a row naming the other purpose's subject, both subjects, or none", async () => {
    const { db, shop } = ctx;
    const ids = await subjects();
    const bad: {
      purpose: CapabilityPurpose;
      personId: string | null;
      interestId: string | null;
    }[] = [
      { purpose: "interest_unsubscribe", personId: ids.personId, interestId: null },
      { purpose: "interest_unsubscribe", personId: ids.personId, interestId: ids.interestId },
      { purpose: "interest_unsubscribe", personId: null, interestId: null },
      { purpose: "courtesy_email_unsubscribe", personId: null, interestId: ids.interestId },
      { purpose: "courtesy_email_unsubscribe", personId: ids.personId, interestId: ids.interestId },
      { purpose: "courtesy_email_unsubscribe", personId: null, interestId: null },
    ];
    for (const [index, row] of bad.entries()) {
      await expect(
        db.transaction(async (tx) => {
          await tx
            .insert(capabilities)
            .values({ ...row, shopId: shop.id, tokenHash: `bad-subject-${index}` });
        }),
      ).rejects.toThrow();
    }
  });
});

async function owner() {
  const { db, shop } = ctx;
  const [row] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  if (!row) throw new Error("expected the seeded owner");
  return row.id;
}

describe("a capability and the person it opens", () => {
  /**
   * `person-columns.ts` moves `capabilities.person_id` to the survivor of a
   * merge for every purpose. That is right for an unsubscribe link and would be
   * wrong for one that grants authority (an account token), so a new person
   * purpose has to come through here and decide (security review of #2710, F3).
   */
  it("moves only purposes whose authority may follow a merged person", () => {
    const personPurposes = CAPABILITY_PURPOSES.filter(
      (purpose) => CAPABILITY_POLICY[purpose].subject === "person",
    );
    // Both only stop mail. The Monday email's link names a staffer, and a
    // merge of a staff record is refused before anything moves (issue #3721).
    expect(personPurposes).toEqual(["courtesy_email_unsubscribe", "weekly_digest_unsubscribe"]);
  });

  it("follows a merge: the link mailed to the merged-away record opts the kept one out", async () => {
    const { db, shop } = ctx;
    const [source, survivor] = await db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Tomas Ruiz", email: "tomas-old@example.com" },
        { shopId: shop.id, fullName: "Tomas Ruiz", email: "tomas-new@example.com" },
      ])
      .returning();
    if (!source || !survivor) throw new Error("fixture insert failed");
    await db.insert(personRoles).values([
      { personId: source.id, role: "diver" },
      { personId: survivor.id, role: "diver" },
    ]);
    const token = await issueCapability(db, {
      purpose: "courtesy_email_unsubscribe",
      shopId: shop.id,
      subjectId: source.id,
    });
    const merged = await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: source.id,
      survivorId: survivor.id,
      actorPersonId: await owner(),
    });
    expect(merged.ok).toBe(true);
    expect(
      await verifyCapability(db, { purpose: "courtesy_email_unsubscribe", token }),
    ).toMatchObject({ shopId: shop.id, subjectId: survivor.id });
  });

  it("goes with the person on erasure, even a row whose shop has drifted", async () => {
    const { db, shop } = ctx;
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-capability-erasure", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");
    const { personId } = await subjects();
    await db.insert(personRoles).values({ personId, role: "diver" }).onConflictDoNothing();
    const token = await issueCapability(db, {
      purpose: "courtesy_email_unsubscribe",
      shopId: shop.id,
      subjectId: personId,
    });
    await db
      .update(capabilities)
      .set({ shopId: otherShop.id })
      .where(eq(capabilities.tokenHash, hashBearerToken(token)));

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId,
      actorPersonId: await owner(),
    });
    expect(erased.ok).toBe(true);
    expect(await db.select().from(capabilities).where(eq(capabilities.personId, personId))).toEqual(
      [],
    );
  });
});
