import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { hashBearerToken } from "@/lib/bearer-tokens";
import { CAPABILITY_POLICY, CAPABILITY_PURPOSES, type CapabilityPurpose } from "@/lib/capabilities";
import { fileScopedShopContext } from "@/test/db";
import { issueCapability, verifyCapability } from "./capabilities";
import { askAnytime } from "./interests";
import { findOrCreatePerson } from "./people";
import { capabilities } from "./schema";

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
