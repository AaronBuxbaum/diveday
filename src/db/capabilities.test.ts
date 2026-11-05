import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { hashBearerToken } from "@/lib/bearer-tokens";
import {
  CAPABILITY_POLICY,
  CAPABILITY_PURPOSES,
  type CapabilityPurpose,
  capabilityExpiry,
} from "@/lib/capabilities";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import {
  issueCapability,
  mintCapability,
  openCapability,
  spendCapability,
  verifyCapability,
} from "./capabilities";
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

const ADDRESS = "books@example.com";

function subjectFor(
  purpose: CapabilityPurpose,
  ids: { personId: string; interestId: string },
): string {
  switch (CAPABILITY_POLICY[purpose].subject) {
    case "interest":
      return ids.interestId;
    case "person":
      return ids.personId;
    case "shop_address":
      return ADDRESS;
  }
}

describe("issueCapability and verifyCapability", () => {
  it.each(CAPABILITY_PURPOSES)(
    "%s: verifies under its own purpose and no other",
    async (purpose) => {
      const { db, shop } = ctx;
      const ids = await subjects();
      const subjectId = subjectFor(purpose, ids);
      const token = await issueCapability(db, {
        purpose,
        shopId: shop.id,
        subjectId,
      });

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
      const expected = {
        interest: { interestId: ids.interestId, personId: null, sentTo: null },
        person: { personId: ids.personId, interestId: null, sentTo: null },
        shop_address: { sentTo: ADDRESS, personId: null, interestId: null },
      }[CAPABILITY_POLICY[purpose].subject];
      expect(row).toMatchObject({ ...expected, usedAt: null });
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

describe("spendCapability", () => {
  it("spends a link once: the second use finds nothing", async () => {
    const { db, shop } = ctx;
    const token = await issueCapability(db, {
      purpose: "shore_alert_stop",
      shopId: shop.id,
      subjectId: "Shore@Example.com",
    });
    const at = new Date("2026-10-15T12:00:00Z");
    expect(
      await spendCapability(db, { purpose: "shore_alert_stop", token, now: at }),
    ).toMatchObject({ shopId: shop.id, subjectId: "shore@example.com", usedAt: at });
    expect(await spendCapability(db, { purpose: "shore_alert_stop", token, now: at })).toBeNull();
    // A spent link still verifies, and says when it was spent.
    expect(await verifyCapability(db, { purpose: "shore_alert_stop", token })).toMatchObject({
      usedAt: at,
    });
  });

  it("refuses to spend a purpose that is not spent by a use", async () => {
    const { db, shop } = ctx;
    const ids = await subjects();
    const token = await issueCapability(db, {
      purpose: "courtesy_email_unsubscribe",
      shopId: shop.id,
      subjectId: ids.personId,
    });
    await expect(
      spendCapability(db, { purpose: "courtesy_email_unsubscribe", token }),
    ).rejects.toThrow(/not spent/);
  });
});

/**
 * **The first expiring purpose** (issue #3721): the shore contact's confirm
 * link. Adversarial: an expired, superseded or spent link opens nothing and
 * cannot be spent, and the table refuses a deadline on the wrong purpose.
 */
describe("a purpose that expires and supersedes", () => {
  const purpose = "shore_alert_confirm" as const;
  const at = new Date("2026-10-15T12:00:00Z");
  const later = new Date(at.getTime() + CAPABILITY_POLICY.shore_alert_confirm.ttlMs);

  it("sets the deadline from the policy's ttl, and none on a purpose that never expires", async () => {
    const { db, shop } = ctx;
    const minted = await mintCapability(db, {
      purpose,
      shopId: shop.id,
      subjectId: ADDRESS,
      now: at,
    });
    expect(minted.expiresAt).toEqual(later);
    const stop = await mintCapability(db, {
      purpose: "shore_alert_stop",
      shopId: shop.id,
      subjectId: ADDRESS,
      now: at,
    });
    expect(stop.expiresAt).toBeNull();
    expect(capabilityExpiry("shore_alert_stop", at)).toBeNull();
    expect(capabilityExpiry(purpose, at)).toEqual(later);
  });

  it("opens and spends before its deadline, and neither at or after it", async () => {
    const { db, shop } = ctx;
    const token = await issueCapability(db, {
      purpose,
      shopId: shop.id,
      subjectId: ADDRESS,
      now: at,
    });
    expect(await openCapability(db, { purpose, token, now: at })).toMatchObject({
      subjectId: ADDRESS,
      expiresAt: later,
    });
    expect(await openCapability(db, { purpose, token, now: later })).toBeNull();
    expect(await spendCapability(db, { purpose, token, now: later })).toBeNull();
    // Still known, so the page can say the link is no longer available.
    expect(await verifyCapability(db, { purpose, token })).toMatchObject({ usedAt: null });
    expect(await spendCapability(db, { purpose, token, now: at })).toMatchObject({ usedAt: at });
    expect(await openCapability(db, { purpose, token, now: at })).toBeNull();
  });

  it("a fresh mint revokes the outstanding one, in this shop only", async () => {
    const { db, shop } = ctx;
    const [other] = await db
      .insert(shops)
      .values({
        name: "Other Shop",
        slug: `other-${crypto.randomUUID().slice(0, 8)}`,
        timezone: "UTC",
      })
      .returning({ id: shops.id });
    if (!other) throw new Error("second shop missing");
    const input = { purpose, subjectId: ADDRESS, now: at };
    const elsewhere = await issueCapability(db, { ...input, shopId: other.id });
    const first = await issueCapability(db, { ...input, shopId: shop.id });
    const second = await issueCapability(db, { ...input, shopId: shop.id });

    expect(await openCapability(db, { purpose, token: first, now: at })).toBeNull();
    expect(await spendCapability(db, { purpose, token: first, now: at })).toBeNull();
    expect(await verifyCapability(db, { purpose, token: first })).toMatchObject({
      revokedAt: at,
    });
    expect(await openCapability(db, { purpose, token: second, now: at })).not.toBeNull();
    expect(await openCapability(db, { purpose, token: elsewhere, now: at })).not.toBeNull();
  });

  it("the table refuses an expiring purpose with no deadline, and a deadline on any other", async () => {
    const { db, shop } = ctx;
    await expect(
      db.insert(capabilities).values({
        purpose,
        shopId: shop.id,
        sentTo: ADDRESS,
        tokenHash: hashBearerToken("no-deadline"),
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(capabilities).values({
        purpose: "bookkeeper_stop",
        shopId: shop.id,
        sentTo: ADDRESS,
        tokenHash: hashBearerToken("stray-deadline"),
        expiresAt: later,
      }),
    ).rejects.toThrow();
  });
});

describe("capabilities_subject_by_purpose", () => {
  it("refuses a row naming the other purpose's subject, both subjects, or none", async () => {
    const { db, shop } = ctx;
    const ids = await subjects();
    const none = { personId: null, interestId: null, sentTo: null };
    const bad: {
      purpose: CapabilityPurpose;
      personId: string | null;
      interestId: string | null;
      sentTo: string | null;
      usedAt?: Date;
    }[] = [
      { purpose: "interest_unsubscribe", ...none, personId: ids.personId },
      {
        purpose: "interest_unsubscribe",
        ...none,
        personId: ids.personId,
        interestId: ids.interestId,
      },
      { purpose: "interest_unsubscribe", ...none },
      { purpose: "interest_unsubscribe", ...none, interestId: ids.interestId, sentTo: ADDRESS },
      { purpose: "courtesy_email_unsubscribe", ...none, interestId: ids.interestId },
      {
        purpose: "courtesy_email_unsubscribe",
        ...none,
        personId: ids.personId,
        interestId: ids.interestId,
      },
      { purpose: "courtesy_email_unsubscribe", ...none },
      { purpose: "courtesy_email_unsubscribe", ...none, personId: ids.personId, sentTo: ADDRESS },
      { purpose: "shore_alert_stop", ...none },
      { purpose: "shore_alert_stop", ...none, personId: ids.personId },
      { purpose: "shore_alert_stop", ...none, sentTo: ADDRESS, personId: ids.personId },
      // The address is stored lower-cased, the handle an erasure sweeps by.
      { purpose: "shore_alert_stop", ...none, sentTo: "Books@Example.com" },
      // Only a purpose a use spends is ever marked used.
      {
        purpose: "courtesy_email_unsubscribe",
        ...none,
        personId: ids.personId,
        usedAt: new Date("2026-10-15T12:00:00Z"),
      },
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
