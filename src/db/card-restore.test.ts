import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { restoreCard } from "./card-restore";
import type { AppDb } from "./client";
import {
  createCertification,
  createSpecialtyCertification,
  deleteCertification,
  deleteSpecialtyCertification,
} from "./readiness";
import { readinessFixturesFor } from "./readiness-test-fixtures";
import { cards } from "./schema";

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
});
