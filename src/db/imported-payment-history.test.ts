import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { listImportedPaymentHistory } from "./imported-payment-history";
import { importedPaymentHistory, people, shops } from "./schema";

let sequence = 0;

async function makePerson(db: AppDb, shopId: string, fullName: string): Promise<string> {
  const [person] = await db
    .insert(people)
    .values({ shopId, fullName })
    .returning({ id: people.id });
  if (!person) throw new Error("failed to insert person");
  return person.id;
}

async function addHistory(
  db: AppDb,
  input: {
    shopId: string;
    personId: string;
    occurredOn: string;
    title?: string;
    amountCents?: number;
  },
) {
  sequence += 1;
  const [row] = await db
    .insert(importedPaymentHistory)
    .values({
      shopId: input.shopId,
      personId: input.personId,
      occurredOn: input.occurredOn,
      direction: "payment",
      title: input.title ?? `Source ${sequence}`,
      statusLabel: "Settled",
      amountLabel: "$165.00",
      amountCents: input.amountCents ?? 16_500,
      currency: "usd",
      sourceLabel: "Prior shop",
      dedupeKey: `source-${sequence}`,
      importedAt: new Date(`2026-06-${String(sequence).padStart(2, "0")}T00:00:00Z`),
    })
    .returning({ id: importedPaymentHistory.id });
  if (!row) throw new Error("failed to insert imported history");
  return row;
}

describe("listImportedPaymentHistory", () => {
  it("is tenant-scoped and keeps source evidence attached to the correct diver", async () => {
    const { db, shop } = await seededShopContext();
    const firstPerson = await makePerson(db, shop.id, "Rosa Receipt");
    await addHistory(db, { shopId: shop.id, personId: firstPerson, occurredOn: "2024-05-11" });

    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: `other-imports-${crypto.randomUUID()}`, timezone: "UTC" })
      .returning({ id: shops.id });
    if (!otherShop) throw new Error("failed to insert other shop");
    const otherPerson = await makePerson(db, otherShop.id, "Rosa Other");
    await addHistory(db, { shopId: otherShop.id, personId: otherPerson, occurredOn: "2024-05-12" });
    // A direct SQL row could satisfy each individual foreign key while joining
    // this shop's source evidence to another shop's person. The reader must
    // fail closed even though normal import writers never construct that row.
    await addHistory(db, { shopId: shop.id, personId: otherPerson, occurredOn: "2024-05-13" });

    const page = await listImportedPaymentHistory(db, shop.id, { personId: firstPerson });
    expect(page.total).toBe(1);
    expect(page.rows[0]).toMatchObject({
      history: { shopId: shop.id, personId: firstPerson },
      person: { id: firstPerson, fullName: "Rosa Receipt" },
    });
    const otherRows = await db
      .select()
      .from(importedPaymentHistory)
      .where(
        and(
          eq(importedPaymentHistory.shopId, otherShop.id),
          eq(importedPaymentHistory.personId, otherPerson),
        ),
      );
    expect(otherRows).toHaveLength(1);
    const malformedReference = await listImportedPaymentHistory(db, shop.id, {
      personId: otherPerson,
    });
    expect(malformedReference.total).toBe(0);
    expect(malformedReference.rows).toEqual([]);
  });

  it("filters a source-history page by diver query and inclusive calendar-date bounds", async () => {
    const { db, shop } = await seededShopContext();
    const rosa = await makePerson(db, shop.id, "Rosa Receipt");
    const dan = await makePerson(db, shop.id, "Dan Diver");
    await addHistory(db, {
      shopId: shop.id,
      personId: rosa,
      occurredOn: "2024-05-01",
      title: "Old",
    });
    await addHistory(db, {
      shopId: shop.id,
      personId: rosa,
      occurredOn: "2024-05-11",
      title: "In range",
    });
    await addHistory(db, {
      shopId: shop.id,
      personId: dan,
      occurredOn: "2024-05-11",
      title: "Other diver",
    });

    const page = await listImportedPaymentHistory(db, shop.id, {
      personQuery: "rosa",
      from: "2024-05-11",
      to: "2024-05-11",
    });
    expect(page.total).toBe(1);
    expect(page.rows[0]?.history.title).toBe("In range");
  });

  it("paginates oldest source history without losing a deterministic date order", async () => {
    const { db, shop } = await seededShopContext();
    const person = await makePerson(db, shop.id, "Paged Parker");
    await addHistory(db, {
      shopId: shop.id,
      personId: person,
      occurredOn: "2024-05-01",
      title: "Old",
    });
    await addHistory(db, {
      shopId: shop.id,
      personId: person,
      occurredOn: "2024-05-03",
      title: "Newest",
    });
    await addHistory(db, {
      shopId: shop.id,
      personId: person,
      occurredOn: "2024-05-02",
      title: "Middle",
    });

    const first = await listImportedPaymentHistory(
      db,
      shop.id,
      { personId: person },
      { page: 1, pageSize: 1 },
    );
    const second = await listImportedPaymentHistory(
      db,
      shop.id,
      { personId: person },
      { page: 2, pageSize: 1 },
    );
    expect(first.rows[0]?.history.title).toBe("Newest");
    expect(second.rows[0]?.history.title).toBe("Middle");
    expect(first.total).toBe(3);
  });
});
