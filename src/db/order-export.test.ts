import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { listOrderLinesForExport } from "./order-export";
import { orderLineItems, orders, people, shops } from "./schema";

const ctx = fileScopedShopContext();

async function orderFor(
  shopId: string,
  fullName: string,
  lines: { kind: "trip_fee" | "rental"; description: string; cents: number }[],
  status: "open" | "paid" = "paid",
) {
  const { db } = ctx;
  const [person] = await db.insert(people).values({ shopId, fullName }).returning();
  if (!person) throw new Error("person insert failed");
  const total = lines.reduce((sum, line) => sum + line.cents, 0);
  const [order] = await db
    .insert(orders)
    .values({
      shopId,
      personId: person.id,
      createdByPersonId: person.id,
      status,
      currency: "usd",
      totalCents: total,
      amountPaidCents: status === "paid" ? total : 0,
      stripeAccountId: "acct_export",
      stripeCustomerId: `cus_${fullName}`,
      stripeInvoiceId: `in_${fullName}`,
    })
    .returning();
  if (!order) throw new Error("order insert failed");
  for (const line of lines) {
    await db.insert(orderLineItems).values({
      shopId,
      orderId: order.id,
      kind: line.kind,
      description: line.description,
      unitAmountCents: line.cents,
    });
  }
  return order.id;
}

/**
 * The Orders ledger as a file holds what the ledger's filter holds, one row per
 * line, and nothing of another shop's (third UX review, item 34).
 */
describe("listOrderLinesForExport", () => {
  it("writes one row per line of every order the filter finds", async () => {
    const { db, shop } = ctx;
    const id = await orderFor(shop.id, "Xanthe Exportson", [
      { kind: "trip_fee", description: "Two-tank charter", cents: 9_500 },
      { kind: "rental", description: "BCD", cents: 1_500 },
    ]);
    const rows = await listOrderLinesForExport(db, shop.id, { q: "Xanthe Exportson" });
    expect(rows.map((row) => row.orderId)).toEqual([id, id]);
    expect(rows.map((row) => row.line?.description).sort()).toEqual(["BCD", "Two-tank charter"]);
    expect(rows[0]).toMatchObject({ diverName: "Xanthe Exportson", totalCents: 11_000 });
  });

  it("honors the ledger's status filter", async () => {
    const { db, shop } = ctx;
    await orderFor(
      shop.id,
      "Yusra Filtered",
      [{ kind: "trip_fee", description: "Charter", cents: 9_500 }],
      "open",
    );
    expect(await listOrderLinesForExport(db, shop.id, { q: "Yusra", status: "paid" })).toEqual([]);
    expect(await listOrderLinesForExport(db, shop.id, { q: "Yusra", status: "open" })).toHaveLength(
      1,
    );
  });

  it("never carries another shop's orders", async () => {
    const { db, shop } = ctx;
    const [other] = await db
      .insert(shops)
      .values({ name: "Elsewhere Diving", slug: "elsewhere-order-export", timezone: "UTC" })
      .returning({ id: shops.id });
    if (!other) throw new Error("shop insert failed");
    await orderFor(other.id, "Zora Elsewhere", [
      { kind: "trip_fee", description: "Charter", cents: 9_500 },
    ]);
    expect(await listOrderLinesForExport(db, shop.id, { q: "Zora" })).toEqual([]);
    const theirs = await listOrderLinesForExport(db, other.id, {});
    expect(theirs.map((row) => row.diverName)).toEqual(["Zora Elsewhere"]);
  });
});
