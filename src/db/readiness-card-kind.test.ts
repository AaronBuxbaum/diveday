import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { restoreCard } from "../features/card-restore/store";
import type { AppDb } from "./client";
import {
  deleteCertification,
  deleteSpecialtyCertification,
  reverseCertificationReview,
  reverseSpecialtyReview,
  reviewCertification,
  reviewSpecialtyCertification,
} from "./readiness";
import { cards } from "./schema";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();

/**
 * **An id from a form is not proof of which kind of card it names** (issue
 * #2722). Every card lives in one `cards` ledger, so a level action handed a
 * nitrox card's id, or a specialty action handed a level card's, must match no
 * row: a level review must never verify the card that authorizes an
 * enriched-air fill, and a delete keyed on the wrong kind must leave the
 * diver's evidence where it was.
 */
describe("card actions keyed on an id refuse a card of another kind", () => {
  async function person() {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const [entry] = await getTripRoster(db, shop.id, reef.id);
    if (!entry) throw new Error("demo booking missing");
    return { db, shopId: shop.id, personId: entry.person.id };
  }

  async function insertCard(
    db: AppDb,
    values: { shopId: string; personId: string } & (
      | { kind: "nitrox"; status: "pending" | "verified" }
      | { kind: "level"; status: "pending" | "verified" }
      | { kind: "specialty"; status: "pending" | "verified" }
    ),
  ) {
    const identifier = `KIND-${values.kind}-${values.status}-${crypto.randomUUID().slice(0, 8)}`;
    const [row] = await db
      .insert(cards)
      .values({
        ...values,
        agency: "padi",
        identifier,
        ...(values.kind === "level" ? { level: "rescue" as const } : {}),
        ...(values.kind === "specialty" ? { specialty: "deep" as const } : {}),
        ...(values.status === "verified" ? { reviewedAt: nowDate() } : {}),
      })
      .returning();
    if (!row) throw new Error("card did not insert");
    return row;
  }

  async function reread(db: AppDb, card: { id: string; kind: "level" | "specialty" | "nitrox" }) {
    const [row] = await db
      .select()
      .from(cards)
      .where(and(eq(cards.kind, card.kind), eq(cards.id, card.id)));
    if (!row) throw new Error("card vanished");
    return row;
  }

  it("a level review cannot verify a pending nitrox card", async () => {
    const { db, shopId, personId } = await person();
    const nitrox = await insertCard(db, { shopId, personId, kind: "nitrox", status: "pending" });

    const outcome = await reviewCertification(db, {
      shopId,
      certificationId: nitrox.id,
      status: "verified",
    });

    expect(outcome).toEqual({ ok: false, reason: "not_found" });
    expect((await reread(db, nitrox)).status).toBe("pending");
  });

  it("a specialty review cannot verify a pending level card", async () => {
    const { db, shopId, personId } = await person();
    const level = await insertCard(db, { shopId, personId, kind: "level", status: "pending" });

    const outcome = await reviewSpecialtyCertification(db, {
      shopId,
      certificationId: level.id,
      status: "verified",
    });

    expect(outcome).toEqual({ ok: false, reason: "not_found" });
    expect((await reread(db, level)).status).toBe("pending");
  });

  it("an Undo of a level review cannot take back a verified nitrox card's", async () => {
    const { db, shopId, personId } = await person();
    const nitrox = await insertCard(db, { shopId, personId, kind: "nitrox", status: "verified" });
    const reviewedAt = nitrox.reviewedAt ?? new Date(0);

    expect(
      await reverseCertificationReview(db, { shopId, certificationId: nitrox.id, reviewedAt }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(
      await reverseSpecialtyReview(db, { shopId, certificationId: nitrox.id, reviewedAt }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect((await reread(db, nitrox)).status).toBe("verified");
  });

  it("a level or specialty delete cannot remove a verified nitrox card", async () => {
    const { db, shopId, personId } = await person();
    const nitrox = await insertCard(db, { shopId, personId, kind: "nitrox", status: "verified" });

    const by = { shopId, certificationId: nitrox.id, deletedByPersonId: personId };
    expect(await deleteCertification(db, by)).toBe(false);
    expect(await deleteSpecialtyCertification(db, by)).toBe(false);
    expect((await reread(db, nitrox)).deletedAt).toBeNull();
  });

  it("a specialty restore cannot bring back a deleted level card, nor a level restore a specialty", async () => {
    const { db, shopId, personId } = await person();
    const level = await insertCard(db, { shopId, personId, kind: "level", status: "verified" });
    const specialty = await insertCard(db, {
      shopId,
      personId,
      kind: "specialty",
      status: "verified",
    });
    const at = nowDate();
    for (const card of [level, specialty]) {
      await db
        .update(cards)
        .set({ deletedAt: at, deletedByPersonId: personId, deletionKind: "staff" })
        .where(and(eq(cards.kind, card.kind), eq(cards.id, card.id), eq(cards.shopId, shopId)));
    }

    const restore = (kind: "level" | "specialty", certificationId: string) =>
      restoreCard(db, { shopId, kind, certificationId, restoredByPersonId: personId });
    expect(await restore("specialty", level.id)).toBe("not_found");
    expect(await restore("level", specialty.id)).toBe("not_found");
    expect((await reread(db, level)).deletedAt).not.toBeNull();
    expect((await reread(db, specialty)).deletedAt).not.toBeNull();

    // The right kind still restores: the refusal above is the kind, not the row.
    expect(await restore("level", level.id)).toBe("restored");
  });
});
