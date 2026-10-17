// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { setLogSink } from "@/lib/log";
import type { CustomerProvider, DeleteCustomerResult } from "@/lib/payments/customers";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import {
  attemptProcessorErasure,
  dischargeProcessorErasure,
  recordProcessorErasureObligations,
  retryPendingProcessorErasures,
  retryProcessorErasure,
} from "./processor-erasure";
import { people, processorErasureObligations, STRIPE_ERASURE_TARGETS, shops } from "./schema";
import { upsertShopStripeAccount } from "./stripe-accounts";

// The WhatsApp chat target and the account column (issue #1721), split from
// processor-erasure.test.ts for length. One seeded database for the file and a
// rolled-back transaction per test (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

/** A provider that answers the same way every time and counts its calls. */
function providerReturning(result: DeleteCustomerResult): CustomerProvider & {
  deleteCustomer: ReturnType<typeof vi.fn>;
} {
  return { deleteCustomer: vi.fn().mockResolvedValue(result) };
}

const CUSTOMER = (externalId: string, providerAccountId = "acct_test") => ({
  target: "stripe_customer" as const,
  externalId,
  providerAccountId,
});
const INVOICE = (externalId: string, providerAccountId = "acct_test") => ({
  target: "stripe_invoice_snapshot" as const,
  externalId,
  providerAccountId,
});

async function personIdByName(db: AppDb, shopId: string, fullName: string) {
  const [row] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shopId), eq(people.fullName, fullName)));
  if (!row) throw new Error(`seed person missing: ${fullName}`);
  return row.id;
}

/**
 * A second shop with a person of its own, for the tenant-scoping assertions.
 * Each shop is connected to its own Stripe account, because a delete is only
 * ever attempted against an account that still maps to the obligation's shop.
 */
async function twoShops() {
  const { db, shop } = ctx;
  const ownerId = await personIdByName(db, shop.id, "Dana Reyes");
  await upsertShopStripeAccount(db, shop.id, "acct_test");
  const [otherShop] = await db
    .insert(shops)
    .values({ name: "Other Shop", slug: "other-shop-processor-erasure", timezone: "UTC" })
    .returning();
  if (!otherShop) throw new Error("second shop insert failed");
  const [otherPerson] = await db
    .insert(people)
    .values({ shopId: otherShop.id, fullName: "Other Diver" })
    .returning();
  if (!otherPerson) throw new Error("second shop person insert failed");
  await upsertShopStripeAccount(db, otherShop.id, "acct_other");
  return { db, shop, ownerId, otherShop, otherPerson };
}

async function rowById(db: AppDb, id: string) {
  const [row] = await db
    .select()
    .from(processorErasureObligations)
    .where(eq(processorErasureObligations.id, id));
  return row;
}

/**
 * A WhatsApp chat (issue #1721). It sits in the shop's own WhatsApp Business
 * account at Meta, and the Cloud API has no delete for a sent or received
 * message, so the only thing that discharges it is the owner deleting the
 * chat and saying so. Its handle is the diver's number,
 * which is why discharging it has to take the number away too.
 */
const CHAT = (number: string, providerAccountId: string | null = "pn_shop") => ({
  target: "whatsapp_conversation" as const,
  externalId: number,
  providerAccountId,
});

describe("a WhatsApp chat obligation", () => {
  it("is raised with no account when the shop had no number connected", async () => {
    const { db, shop, ownerId } = await twoShops();
    const raised = await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      targets: [CHAT("+13055550177", null)],
    });
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({
      target: "whatsapp_conversation",
      externalId: "+13055550177",
      providerAccountId: null,
      status: "owed",
    });
  });

  it("folds a second sighting of the same number into one chat", async () => {
    const { db, shop, ownerId } = await twoShops();
    const raised = await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      targets: [CHAT("+13055550177"), CHAT("+13055550177"), CHAT("+13055550188")],
    });
    expect(raised.map((row) => row.externalId).sort()).toEqual(["+13055550177", "+13055550188"]);
  });

  it("never calls anything, and stays out of the nightly drain", async () => {
    const { db, shop, ownerId } = await twoShops();
    const [obligation] = await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      targets: [CHAT("+13055550177")],
    });
    if (!obligation) throw new Error("obligation missing");
    const provider = providerReturning({ status: "deleted" });

    expect(await attemptProcessorErasure(db, obligation, provider)).toEqual({ status: "manual" });
    expect(await retryPendingProcessorErasures(db, { provider })).toEqual({
      attempted: 0,
      discharged: 0,
    });
    expect(await retryProcessorErasure(db, shop.id, obligation.id, provider)).toEqual({
      ok: true,
      outcome: { status: "manual" },
    });
    expect(provider.deleteCustomer).not.toHaveBeenCalled();
    expect(await rowById(db, obligation.id)).toMatchObject({ status: "owed", attempts: 0 });
  });

  it("forgets the diver's number once the owner says the chat is deleted", async () => {
    const { db, shop, ownerId } = await twoShops();
    const [obligation] = await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      targets: [CHAT("+13055550177")],
    });
    if (!obligation) throw new Error("obligation missing");

    expect(
      await dischargeProcessorErasure(db, {
        shopId: shop.id,
        obligationId: obligation.id,
        actorPersonId: ownerId,
      }),
    ).toEqual({ ok: true });
    const row = await rowById(db, obligation.id);
    expect(row).toMatchObject({ status: "discharged", dischargedByPersonId: ownerId });
    // The number was held only so the owner could find the chat. Once it is
    // gone at Meta, nothing here may still say who the diver was.
    expect(JSON.stringify(row)).not.toContain("3055550177");
    expect(row?.externalId).toBe(obligation.id);
  });

  it("keeps a Stripe handle on discharge — only the number is personal", async () => {
    const { db, shop, ownerId } = await twoShops();
    const [obligation] = await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      targets: [INVOICE("in_kept")],
    });
    if (!obligation) throw new Error("obligation missing");
    await dischargeProcessorErasure(db, {
      shopId: shop.id,
      obligationId: obligation.id,
      actorPersonId: ownerId,
    });
    expect(await rowById(db, obligation.id)).toMatchObject({
      status: "discharged",
      externalId: "in_kept",
    });
  });

  it("raises the chat again for a later erasure once the first is discharged", async () => {
    // The discharged row no longer holds the number, so it cannot swallow a
    // second, separate chat with the same number through the uniqueness key.
    const { db, shop, ownerId } = await twoShops();
    const [first] = await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      targets: [CHAT("+13055550177")],
    });
    if (!first) throw new Error("obligation missing");
    await dischargeProcessorErasure(db, {
      shopId: shop.id,
      obligationId: first.id,
      actorPersonId: ownerId,
    });
    const again = await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      targets: [CHAT("+13055550177")],
    });
    expect(again).toHaveLength(1);
    expect(again[0]?.id).not.toBe(first.id);
  });

  it("refuses another shop's chat on discharge, and leaves its number alone", async () => {
    const { db, shop, ownerId, otherShop, otherPerson } = await twoShops();
    const [theirs] = await recordProcessorErasureObligations(db, {
      shopId: otherShop.id,
      personId: otherPerson.id,
      targets: [CHAT("+13055550177")],
    });
    if (!theirs) throw new Error("obligation missing");
    expect(
      await dischargeProcessorErasure(db, {
        shopId: shop.id,
        obligationId: theirs.id,
        actorPersonId: ownerId,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(await rowById(db, theirs.id)).toMatchObject({
      status: "owed",
      externalId: "+13055550177",
    });
  });
});

describe("the account a Stripe obligation lives on", () => {
  it("is refused by the database when it is missing", async () => {
    // The writer drops such an entry first (above). This is the floor under
    // it: a row naming a Stripe object and no account can be neither retried
    // nor found, so no path may write one.
    const { db, shop, ownerId } = await twoShops();
    for (const target of STRIPE_ERASURE_TARGETS) {
      await expect(
        db.transaction(async (tx) => {
          await tx.insert(processorErasureObligations).values({
            shopId: shop.id,
            personId: ownerId,
            target,
            externalId: `x_${target}`,
            providerAccountId: null,
          });
        }),
        target,
      ).rejects.toThrow();
    }
  });

  it("is what the delete is sent to", async () => {
    const { db, shop, ownerId } = await twoShops();
    const [obligation] = await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      targets: [CUSTOMER("cus_account")],
    });
    if (!obligation) throw new Error("obligation missing");
    // Written to both columns this release, so the release still serving
    // during a deploy, which reads only `stripe_account_id`, retries it too.
    expect(obligation).toMatchObject({
      providerAccountId: "acct_test",
      stripeAccountId: "acct_test",
    });
    const provider = providerReturning({ status: "deleted" });
    await attemptProcessorErasure(db, obligation, provider);
    expect(provider.deleteCustomer).toHaveBeenCalledWith(
      "acct_test",
      "cus_account",
      expect.any(String),
    );
  });

  it("still takes a Stripe row the previous release wrote, with only the old column", async () => {
    // Records review F3 / security F2: that release is still serving while
    // this one's migrations run, and its erasure must not roll back.
    const { db, shop, ownerId } = await twoShops();
    const [row] = await db
      .insert(processorErasureObligations)
      .values({
        shopId: shop.id,
        personId: ownerId,
        target: "stripe_customer",
        externalId: "cus_old_release",
        stripeAccountId: "acct_test",
      })
      .returning();
    if (!row) throw new Error("insert failed");
    const provider = providerReturning({ status: "deleted" });
    expect(await attemptProcessorErasure(db, row, provider)).toEqual({ status: "discharged" });
    expect(provider.deleteCustomer).toHaveBeenCalledWith(
      "acct_test",
      "cus_old_release",
      expect.any(String),
    );
  });

  it("never writes the old column for a WhatsApp chat", async () => {
    const { db, shop, ownerId } = await twoShops();
    const [row] = await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      targets: [CHAT("+13055550177")],
    });
    expect(row).toMatchObject({ providerAccountId: "pn_shop", stripeAccountId: null });
  });

  it("says so when it drops a Stripe entry that names no account", async () => {
    const { db, shop, ownerId } = await twoShops();
    const lines: string[] = [];
    setLogSink((line) => lines.push(line));
    try {
      expect(
        await recordProcessorErasureObligations(db, {
          shopId: shop.id,
          personId: ownerId,
          targets: [
            { target: "stripe_customer", externalId: "cus_nowhere", providerAccountId: null },
          ],
        }),
      ).toEqual([]);
    } finally {
      setLogSink(null);
    }
    const warned = lines.find((line) => line.includes("processor_erasure_target_dropped"));
    expect(warned).toBeDefined();
    expect(warned).toContain(shop.id);
    expect(warned).toContain(ownerId);
    expect(warned).toContain("stripe_customer");
    expect(warned).not.toContain("cus_nowhere");
  });
});
