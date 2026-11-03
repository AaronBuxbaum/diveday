import { describe, expect, it } from "vitest";
import type { AppDb } from "@/db/client";
import { cards, people } from "@/db/schema";
import { fileScopedShopContext } from "@/test/db";
import { withAgencyChecks } from "./index";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

async function diver(db: AppDb, shopId: string, fullName: string, dateOfBirth = "1990-04-12") {
  const [person] = await db.insert(people).values({ shopId, fullName, dateOfBirth }).returning();
  if (!person) throw new Error("failed to insert a diver");
  return person.id;
}

async function card(
  db: AppDb,
  shopId: string,
  personId: string,
  values: Partial<typeof cards.$inferInsert> = {},
) {
  const [row] = await db
    .insert(cards)
    .values({
      kind: "level",
      shopId,
      personId,
      agency: "ssi",
      level: "open_water",
      identifier: `SSI-${personId.slice(0, 8)}`,
      status: "pending",
      ...values,
    })
    .returning();
  if (!row) throw new Error("failed to insert a card");
  return row;
}

/**
 * **The cards a departure or the Today list offers to check** (H-20261008-cert-check-extension). The
 * The list and action share a read, but an SSI row can offer the manual
 * handoff with incomplete identity even though the judge cannot certify it.
 */

describe("withAgencyChecks", () => {
  function row(personId: string | null, id: string) {
    return {
      id,
      kind: "certification" as const,
      urgency: "soon" as const,
      subject: "Somebody",
      context: null,
      detail: "Certification pending",
      actionLabel: "Open their record",
      href: "/shop/blue-mantis/divers/x",
      dueAt: null,
      ...(personId ? { agencyCheck: { personId, cards: [] } } : {}),
    };
  }

  it("fills in the cards, drops the offer where there are none, and leaves other rows alone", async () => {
    const { db, shop } = ctx;
    const checkable = await diver(db, shop.id, "Noa Peleke");
    const pending = await card(db, shop.id, checkable);
    const tdiOnly = await diver(db, shop.id, "Tomas Reyes");
    await card(db, shop.id, tdiOnly, { agency: "tdi", identifier: "T-9" });

    const [withCards, withNone, untouched] = await withAgencyChecks(db, shop.id, [
      row(checkable, "a"),
      row(tdiOnly, "b"),
      row(null, "c"),
    ]);

    expect(withCards?.agencyCheck?.cards.map((c) => c.certificationId)).toEqual([pending.id]);
    expect(withNone).not.toHaveProperty("agencyCheck");
    expect(untouched).toEqual(row(null, "c"));
  });
});
