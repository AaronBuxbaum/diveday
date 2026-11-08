import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { AppDb } from "../../db/client";
import { mergeDiverRecords } from "../../db/diver-merge";
import {
  createCertification,
  createSpecialtyCertification,
  deleteCertification,
  deleteSpecialtyCertification,
} from "../../db/readiness";
import { cards, people, personRoles, shops } from "../../db/schema/index";
import { fileScopedShopContext } from "../../test/db";
import { readinessFixturesFor } from "../../test/substrate-fixtures/db/readiness-test-fixtures";
import { restoreCard } from "./store";

/**
 * **A card's Undo against the number index** (moved from `readiness.test.ts`
 * with issue #3701): the same archived card comes back, and a number re-used
 * since, in any case, refuses the restore rather than being clobbered. The
 * window and who archived it are `undo.action.test.ts`'s.
 */
const ctx = fileScopedShopContext();
const { readinessContext } = readinessFixturesFor(ctx);

/** Ids of the shop's live cards of one kind, read straight off the table. */
async function liveCardIds(db: AppDb, shopId: string, kind: "level" | "specialty") {
  const rows = await db
    .select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.kind, kind), eq(cards.shopId, shopId), isNull(cards.deletedAt)));
  return rows.map((row) => row.id);
}

describe("restoreCard", () => {
  it("restores an archived level card, but refuses once its number is re-used", async () => {
    const { db, shop, rosterEntry, staffId } = await readinessContext();
    const card = await createCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "padi",
      level: "rescue",
      identifier: "PADI-RESTORE-1",
    });
    if (!card) throw new Error("expected certification to insert");
    expect(
      await deleteCertification(db, {
        shopId: shop.id,
        certificationId: card.id,
        deletedByPersonId: staffId,
      }),
    ).toBe(true);

    // The undo path: the same archived card comes back into the shop list.
    expect(
      await restoreCard(db, {
        shopId: shop.id,
        kind: "level",
        certificationId: card.id,
        restoredByPersonId: staffId,
      }),
    ).toBe("restored");
    expect(await liveCardIds(db, shop.id, "level")).toContain(card.id);

    // Archive it again, then re-capture the same number as a fresh card. Restoring
    // the old one now would collide on the partial unique index, so it's refused.
    expect(
      await deleteCertification(db, {
        shopId: shop.id,
        certificationId: card.id,
        deletedByPersonId: staffId,
      }),
    ).toBe(true);
    const recaptured = await createCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "padi",
      level: "rescue",
      identifier: "PADI-RESTORE-1",
    });
    if (!recaptured) throw new Error("expected recapture to insert");
    expect(
      await restoreCard(db, {
        shopId: shop.id,
        kind: "level",
        certificationId: card.id,
        restoredByPersonId: staffId,
      }),
    ).toBe("conflict");
    // A restore through another shop's id is likewise refused.
    expect(
      await restoreCard(db, {
        shopId: "00000000-0000-0000-0000-000000000000",
        kind: "level",
        certificationId: recaptured.id,
        restoredByPersonId: staffId,
      }),
    ).toBe("not_found");
  });

  it("restores an archived level card even when the live conflict differs only by case", async () => {
    const { db, shop, rosterEntry, staffId } = await readinessContext();
    const card = await createCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "padi",
      level: "rescue",
      identifier: "cd5678",
    });
    if (!card) throw new Error("expected certification to insert");
    expect(
      await deleteCertification(db, {
        shopId: shop.id,
        certificationId: card.id,
        deletedByPersonId: staffId,
      }),
    ).toBe(true);
    const recaptured = await createCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "padi",
      level: "rescue",
      identifier: "CD5678",
    });
    expect(recaptured).not.toBeNull();
    // The archived card's number is live again under a different case — restoring
    // it would collide on the case-insensitive index, so it's refused.
    expect(
      await restoreCard(db, {
        shopId: shop.id,
        kind: "level",
        certificationId: card.id,
        restoredByPersonId: staffId,
      }),
    ).toBe("conflict");
  });

  it("restores an archived specialty card", async () => {
    const { db, shop, rosterEntry, staffId } = await readinessContext();
    const card = await createSpecialtyCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "padi",
      specialty: "wreck",
      identifier: "PADI-WRECK-RESTORE",
    });
    if (!card) throw new Error("expected specialty to insert");
    expect(
      await deleteSpecialtyCertification(db, {
        shopId: shop.id,
        certificationId: card.id,
        deletedByPersonId: staffId,
      }),
    ).toBe(true);
    expect(
      await restoreCard(db, {
        shopId: shop.id,
        kind: "specialty",
        certificationId: card.id,
        restoredByPersonId: staffId,
      }),
    ).toBe("restored");
    expect(await liveCardIds(db, shop.id, "specialty")).toContain(card.id);
    // Restoring a card that was never archived is a no-op false.
    expect(
      await restoreCard(db, {
        shopId: shop.id,
        kind: "specialty",
        certificationId: card.id,
        restoredByPersonId: staffId,
      }),
    ).toBe("not_found");
  });

  it("refuses a card a merge moved onto another record since its delete", async () => {
    const { db, shop, staffId } = await readinessContext();
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    if (!owner) throw new Error("expected the seeded owner");
    const [source, survivor] = await db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Merge Source", phone: "+1 305 555 0199" },
        { shopId: shop.id, fullName: "Merge Source", email: "merge-survivor@example.com" },
      ])
      .returning();
    if (!source || !survivor) throw new Error("expected two people");
    await db.insert(personRoles).values([
      { personId: source.id, role: "diver" },
      { personId: survivor.id, role: "diver" },
    ]);
    const card = await createCertification(db, {
      shopId: shop.id,
      personId: source.id,
      agency: "padi",
      level: "rescue",
      identifier: "PADI-MERGED-1",
    });
    if (!card) throw new Error("expected certification to insert");
    // Deleted by hand, so the merge sees no live card to warn about.
    expect(
      await deleteCertification(db, {
        shopId: shop.id,
        certificationId: card.id,
        deletedByPersonId: staffId,
      }),
    ).toBe(true);
    const merged = await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: source.id,
      survivorId: survivor.id,
      actorPersonId: owner.id,
    });
    expect(merged.ok).toBe(true);

    expect(
      await restoreCard(db, {
        shopId: shop.id,
        kind: "level",
        certificationId: card.id,
        restoredByPersonId: staffId,
      }),
    ).toBe("system_archived");
    expect(await liveCardIds(db, shop.id, "level")).not.toContain(card.id);
  });

  it("never restores another shop's card, and a non-uuid id is not found", async () => {
    const { db, shop, rosterEntry, staffId } = await readinessContext();
    const card = await createCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "padi",
      level: "rescue",
      identifier: "PADI-CROSS-SHOP-1",
    });
    if (!card) throw new Error("expected certification to insert");
    await deleteCertification(db, {
      shopId: shop.id,
      certificationId: card.id,
      deletedByPersonId: staffId,
    });
    const [other] = await db
      .insert(shops)
      .values({
        name: "Elsewhere",
        slug: `elsewhere-${crypto.randomUUID().slice(0, 8)}`,
        timezone: "UTC",
      })
      .returning();
    if (!other) throw new Error("expected a second shop");

    expect(
      await restoreCard(db, {
        shopId: other.id,
        kind: "level",
        certificationId: card.id,
        restoredByPersonId: staffId,
      }),
    ).toBe("not_found");
    expect(await liveCardIds(db, shop.id, "level")).not.toContain(card.id);
    expect(
      await restoreCard(db, {
        shopId: shop.id,
        kind: "level",
        certificationId: "not-a-uuid",
        restoredByPersonId: staffId,
      }),
    ).toBe("not_found");
  });
});
