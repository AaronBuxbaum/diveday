import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { certificationForAgencyCheck, listAgencyCheckableCards } from "./agency-check";
import type { AppDb } from "./client";
import { certifications, people } from "./schema";
import { recordSelfDeclaredCards } from "./self-declared-cards";
import { withAgencyChecks } from "./today";

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
  values: Partial<typeof certifications.$inferInsert> = {},
) {
  const [row] = await db
    .insert(certifications)
    .values({
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
 * **The cards a departure or the Today list offers to check** (H-105). The
 * list must never offer a card the action would refuse, so each case here is
 * checked against `certificationForAgencyCheck` too.
 */
describe("listAgencyCheckableCards", () => {
  it("offers a pending level card the extension can look up, with its lookup", async () => {
    const { db, shop } = ctx;
    const personId = await diver(db, shop.id, "Lena Ortiz");
    const pending = await card(db, shop.id, personId, { identifier: "SSI-4471" });

    const byPerson = await listAgencyCheckableCards(db, { shopId: shop.id, personIds: [personId] });

    expect(byPerson.get(personId)).toEqual([
      {
        certificationId: pending.id,
        personId,
        fullName: "Lena Ortiz",
        agency: "ssi",
        query: {
          agency: "ssi",
          firstName: "Lena",
          lastName: "Ortiz",
          birthDate: "1990-04-12",
          cardNumber: "SSI-4471",
        },
      },
    ]);
  });

  it("offers nothing the action would refuse", async () => {
    const { db, shop } = ctx;
    const personId = await diver(db, shop.id, "Mara Quinn");
    const refused = [
      // Already certified.
      await card(db, shop.id, personId, {
        status: "verified",
        reviewedAt: new Date("2026-10-01T00:00:00Z"),
      }),
      // An agency the extension does not check (PADI comes later).
      await card(db, shop.id, personId, { agency: "padi", identifier: "P-1" }),
      // Deleted.
      await card(db, shop.id, personId, { deletedAt: new Date("2026-10-01T00:00:00Z") }),
    ];
    await recordSelfDeclaredCards(db, { shopId: shop.id, personId, level: "advanced_open_water" });
    const [claim] = await db
      .select()
      .from(certifications)
      .where(eq(certifications.personId, personId));

    // A one-word name has no last name to type into the agency's form.
    const oneName = await diver(db, shop.id, "Cher");
    const oneNameCard = await card(db, shop.id, oneName);

    const byPerson = await listAgencyCheckableCards(db, {
      shopId: shop.id,
      personIds: [personId, oneName],
    });

    expect(byPerson.size).toBe(0);
    for (const [owner, row] of [
      ...[...refused, claim].map((row) => [personId, row] as const),
      [oneName, oneNameCard] as const,
    ]) {
      if (!row) continue;
      expect(
        await certificationForAgencyCheck(db, {
          shopId: shop.id,
          personId: owner,
          certificationId: row.id,
        }),
      ).toBeNull();
    }
  });

  it("offers an imported card still waiting for its confirm", async () => {
    const { db, shop } = ctx;
    const personId = await diver(db, shop.id, "Iris Kahale");
    const imported = await card(db, shop.id, personId, {
      status: "verified",
      importedAt: new Date("2026-10-01T00:00:00Z"),
    });

    const byPerson = await listAgencyCheckableCards(db, { shopId: shop.id, personIds: [personId] });

    expect(byPerson.get(personId)?.map((row) => row.certificationId)).toEqual([imported.id]);
  });

  it("keeps to the divers it was asked about, at this shop", async () => {
    const { db, shop } = ctx;
    const asked = await diver(db, shop.id, "Asked About");
    const other = await diver(db, shop.id, "Not Asked");
    await card(db, shop.id, asked);
    await card(db, shop.id, other);

    const byPerson = await listAgencyCheckableCards(db, { shopId: shop.id, personIds: [asked] });
    expect([...byPerson.keys()]).toEqual([asked]);

    const elsewhere = await listAgencyCheckableCards(db, {
      shopId: "00000000-0000-4000-8000-000000000000",
      personIds: [asked],
    });
    expect(elsewhere.size).toBe(0);
  });

  it("answers an empty list without a read", async () => {
    const { db, shop } = ctx;
    expect((await listAgencyCheckableCards(db, { shopId: shop.id, personIds: [] })).size).toBe(0);
  });
});

/**
 * **Today's "certification pending" row and its check** (H-105): the queue
 * names the diver, the read fills in the cards, and a row with nothing the
 * extension can check carries no offer at all.
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
    const padiOnly = await diver(db, shop.id, "Tomas Reyes");
    await card(db, shop.id, padiOnly, { agency: "padi", identifier: "P-9" });

    const [withCards, withNone, untouched] = await withAgencyChecks(db, shop.id, [
      row(checkable, "a"),
      row(padiOnly, "b"),
      row(null, "c"),
    ]);

    expect(withCards?.agencyCheck?.cards.map((c) => c.certificationId)).toEqual([pending.id]);
    expect(withNone).not.toHaveProperty("agencyCheck");
    expect(untouched).toEqual(row(null, "c"));
  });
});
