import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import {
  buildExportTables,
  countShopScoped,
  EXPORT_TABLES,
  type ExportTableRead,
  readScoped,
} from "./export-tables";
import { bookings, certifications, people, shopTextTranslations } from "./schema";

/**
 * The read list both export bundles go through. What matters about it is the
 * scoping — a read through it can never return another shop's or another
 * person's row — and that it reads in the entry's order; the bundles' own
 * contents are `export.test.ts`'s and `export-bundle.snapshot.test.ts`'s.
 */
describe("the export read list", () => {
  it("reads one shop's rows, in the entry's order, and nothing for another shop", async () => {
    const { db, shop } = await seededShopContext();
    const rows = await readScoped(db, "people", { kind: "shop", shopId: shop.id });
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.every((row) => row.shopId === shop.id)).toBe(true);
    const expected = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.shopId, shop.id))
      .orderBy(asc(people.createdAt), asc(people.id));
    expect(rows.map((row) => row.id)).toEqual(expected.map((row) => row.id));
    expect(await countShopScoped(db, "people", shop.id)).toBe(rows.length);

    expect(await readScoped(db, "people", { kind: "shop", shopId: randomUUID() })).toEqual([]);
    expect(await countShopScoped(db, "people", randomUUID())).toBe(0);
  });

  it("reads one person's rows only inside their own shop", async () => {
    const { db, shop } = await seededShopContext();
    const [card] = await db
      .select({ personId: certifications.personId })
      .from(certifications)
      .where(eq(certifications.shopId, shop.id))
      .limit(1);
    if (!card) throw new Error("seed has no certification");

    const diver = (shopId: string) =>
      ({ kind: "diver", shopId, personId: card.personId, bookingIds: [] }) as const;
    const rows = await readScoped(db, "certifications", diver(shop.id));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.personId === card.personId && row.shopId === shop.id)).toBe(
      true,
    );
    // The right person under the wrong shop is nobody.
    expect(await readScoped(db, "certifications", diver(randomUUID()))).toEqual([]);
  });

  it("reads by the diver's bookings, and skips the query when there are none", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    const seats = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.shopId, shop.id))
      .limit(50);
    const bookingIds = seats.map((seat) => seat.id);
    const diver = (shopId: string, ids: string[]) =>
      ({ kind: "diver", shopId, personId: randomUUID(), bookingIds: ids }) as const;
    const rows = await readScoped(db, "bookingPayments", diver(shop.id, bookingIds));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => bookingIds.includes(row.bookingId))).toBe(true);
    expect(await readScoped(db, "bookingPayments", diver(randomUUID(), bookingIds))).toEqual([]);

    const noQuery = {
      select: () => {
        throw new Error("an empty booking list must not reach the database");
      },
    } as unknown as typeof db;
    expect(await readScoped(noQuery, "bookingPayments", diver(shop.id, []))).toEqual([]);
  });

  it("refuses to read a shop-only table for a diver, rather than widening to the shop", async () => {
    const { db, shop } = await seededShopContext();
    const scope = {
      kind: "diver",
      shopId: shop.id,
      personId: randomUUID(),
      bookingIds: [],
    } as const;
    // @ts-expect-error `people` has no person or booking scope, so a diver cannot read it.
    await expect(readScoped(db, "people", scope)).rejects.toThrow(/no diver scope/);
  });

  it("declares a total order for every table except the three the loader reorders", () => {
    const unordered = Object.entries(EXPORT_TABLES as Record<string, ExportTableRead>)
      .filter(([, entry]) => entry.order.length === 0)
      .map(([key]) => key)
      .sort();
    // `buddyPairMembers` is put in team order after the read (issue #1795).
    expect(unordered).toEqual(["bookingPayments", "buddyPairMembers", "tripRequirements"]);
  });

  it("reads one field's translations in locale order, whatever order they were written in", async () => {
    const { db, shop } = await seededShopContext();
    const subject = {
      shopId: shop.id,
      subjectKind: "trip",
      subjectId: randomUUID(),
      field: "title",
    };
    // Written out of locale order, so a read that only orders by subject and
    // field would hand them back as they were inserted.
    for (const locale of ["fr-FR", "de-DE", "es-ES"]) {
      await db
        .insert(shopTextTranslations)
        .values({ ...subject, locale, text: locale, sourceDigest: "digest" });
    }
    const rows = await readScoped(db, "shopTextTranslations", { kind: "shop", shopId: shop.id });
    expect(
      rows.filter((row) => row.subjectId === subject.subjectId).map((row) => row.locale),
    ).toEqual(["de-DE", "es-ES", "fr-FR"]);
  });

  it("builds a bundle's files in list order, each from its own row builder", () => {
    const tables = buildExportTables(
      [
        { file: "b.csv", header: ["n"], rows: (ctx: { n: number }) => [[ctx.n]], note: "B" },
        { file: "a.csv", header: ["twice"], rows: (ctx) => [[ctx.n * 2]], note: "A" },
      ],
      { n: 21 },
    );
    expect(tables).toEqual([
      { file: "b.csv", header: ["n"], rows: [[21]], note: "B" },
      { file: "a.csv", header: ["twice"], rows: [[42]], note: "A" },
    ]);
  });
});
