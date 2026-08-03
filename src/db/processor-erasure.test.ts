// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { CustomerProvider, DeleteCustomerResult } from "@/lib/payments/customers";
import { seededShopContext } from "@/test/db";
import type { AppDb } from "./client";
import {
  attemptProcessorErasure,
  dischargeProcessorErasure,
  listOwedProcessorErasures,
  MAX_AUTOMATIC_DELETE_ATTEMPTS,
  recordProcessorErasureObligations,
  retryPendingProcessorErasures,
  retryProcessorErasure,
} from "./processor-erasure";
import { people, processorErasureObligations, shops } from "./schema";

/** A provider that answers the same way every time and counts its calls. */
function providerReturning(result: DeleteCustomerResult): CustomerProvider & {
  deleteCustomer: ReturnType<typeof vi.fn>;
} {
  return { deleteCustomer: vi.fn().mockResolvedValue(result) };
}

const CUSTOMER = (externalId: string) => ({
  target: "stripe_customer" as const,
  externalId,
  stripeAccountId: "acct_test",
});
const INVOICE = (externalId: string) => ({
  target: "stripe_invoice_snapshot" as const,
  externalId,
  stripeAccountId: "acct_test",
});

async function personIdByName(db: AppDb, shopId: string, fullName: string) {
  const [row] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shopId), eq(people.fullName, fullName)));
  if (!row) throw new Error(`seed person missing: ${fullName}`);
  return row.id;
}

/** A second shop with a person of its own, for the tenant-scoping assertions. */
async function twoShops() {
  const { db, shop } = await seededShopContext();
  const ownerId = await personIdByName(db, shop.id, "Dana Reyes");
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
  return { db, shop, ownerId, otherShop, otherPerson };
}

async function rowById(db: AppDb, id: string) {
  const [row] = await db
    .select()
    .from(processorErasureObligations)
    .where(eq(processorErasureObligations.id, id));
  return row;
}

describe("recording processor erasure obligations", () => {
  it("raises one row per distinct target and ignores blanks", async () => {
    const { db, shop, ownerId } = await twoShops();
    const raised = await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      targets: [
        CUSTOMER("cus_a"),
        CUSTOMER("cus_b"),
        CUSTOMER("cus_a"),
        CUSTOMER("  "),
        INVOICE("in_a"),
        // Missing account id: a row with nowhere to send the delete is worse
        // than no row, because it can never be discharged by anything.
        { target: "stripe_customer" as const, externalId: "cus_c", stripeAccountId: "" },
      ],
    });
    expect(raised.map((row) => row.externalId).sort()).toEqual(["cus_a", "cus_b", "in_a"]);
    const owed = await listOwedProcessorErasures(db, shop.id);
    expect(owed.every((row) => row.status === "owed" && row.attempts === 0)).toBe(true);
  });

  it("records nothing when the diver's orders name nothing at all", async () => {
    const { db, shop, ownerId } = await twoShops();
    expect(
      await recordProcessorErasureObligations(db, {
        shopId: shop.id,
        personId: ownerId,
        targets: [],
      }),
    ).toEqual([]);
    expect(await listOwedProcessorErasures(db, shop.id)).toEqual([]);
  });

  it("folds a repeat obligation onto the existing row instead of duplicating the work", async () => {
    const { db, shop, ownerId } = await twoShops();
    await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      targets: [CUSTOMER("cus_shared")],
    });
    expect(
      await recordProcessorErasureObligations(db, {
        shopId: shop.id,
        personId: ownerId,
        targets: [CUSTOMER("cus_shared")],
      }),
    ).toEqual([]);
    expect(await listOwedProcessorErasures(db, shop.id)).toHaveLength(1);
  });

  it("keeps one shop's obligations out of another's, even on the same handle", async () => {
    const { db, shop, ownerId, otherShop, otherPerson } = await twoShops();
    await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      targets: [CUSTOMER("cus_same")],
    });
    await recordProcessorErasureObligations(db, {
      shopId: otherShop.id,
      personId: otherPerson.id,
      targets: [CUSTOMER("cus_same")],
    });

    const mine = await listOwedProcessorErasures(db, shop.id);
    const theirs = await listOwedProcessorErasures(db, otherShop.id);
    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(1);
    expect(mine[0]?.id).not.toBe(theirs[0]?.id);
    expect(mine[0]?.shopId).toBe(shop.id);
    expect(theirs[0]?.shopId).toBe(otherShop.id);
  });
});

describe("attempting the Stripe customer delete", () => {
  it("deletes on the order's own connected account and discharges the row", async () => {
    const { db, shop, ownerId } = await twoShops();
    const [obligation] = await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      targets: [{ target: "stripe_customer", externalId: "cus_1", stripeAccountId: "acct_shop" }],
    });
    if (!obligation) throw new Error("obligation missing");
    const provider = providerReturning({ status: "deleted" });

    expect(await attemptProcessorErasure(db, obligation, provider)).toEqual({
      status: "discharged",
    });
    expect(provider.deleteCustomer).toHaveBeenCalledWith(
      "acct_shop",
      "cus_1",
      // House idempotency-key shape: the row's own id plus the step.
      `${obligation.id}:customer-delete`,
    );
    expect(await rowById(db, obligation.id)).toMatchObject({
      status: "discharged",
      attempts: 1,
      lastError: null,
      // Nobody attested this — DiveDay did it.
      dischargedByPersonId: null,
    });
    expect(await listOwedProcessorErasures(db, shop.id)).toEqual([]);
  });

  it("treats an already-deleted customer as discharged", async () => {
    const { db, shop, ownerId } = await twoShops();
    const [obligation] = await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      targets: [CUSTOMER("cus_gone")],
    });
    if (!obligation) throw new Error("obligation missing");

    expect(
      await attemptProcessorErasure(
        db,
        obligation,
        providerReturning({ status: "already_deleted" }),
      ),
    ).toEqual({ status: "discharged" });
    expect(await rowById(db, obligation.id)).toMatchObject({ status: "discharged" });
  });

  it("leaves a failed delete owed, with the reason on the row", async () => {
    const { db, shop, ownerId } = await twoShops();
    const [obligation] = await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      targets: [CUSTOMER("cus_broken")],
    });
    if (!obligation) throw new Error("obligation missing");

    expect(
      await attemptProcessorErasure(
        db,
        obligation,
        providerReturning({ status: "failed", error: "HTTP 401: account_invalid" }),
      ),
    ).toEqual({ status: "failed", error: "HTTP 401: account_invalid" });
    expect(await rowById(db, obligation.id)).toMatchObject({
      status: "owed",
      attempts: 1,
      lastError: "HTTP 401: account_invalid",
    });
    expect(await listOwedProcessorErasures(db, shop.id)).toHaveLength(1);
  });

  it("does not discharge a row when Stripe is not configured at all", async () => {
    const { db, shop, ownerId } = await twoShops();
    const [obligation] = await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      targets: [CUSTOMER("cus_unreachable")],
    });
    if (!obligation) throw new Error("obligation missing");

    // A deployment with no key has erased nothing at the processor; saying
    // otherwise in a compliance ledger is the failure mode this pins.
    expect(
      await attemptProcessorErasure(
        db,
        obligation,
        providerReturning({ status: "not_configured" }),
      ),
    ).toMatchObject({ status: "failed" });
    expect(await rowById(db, obligation.id)).toMatchObject({
      status: "owed",
      lastError: "stripe not configured",
    });
  });

  it("never calls Stripe for an invoice snapshot — no API reaches it", async () => {
    const { db, shop, ownerId } = await twoShops();
    const [obligation] = await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      targets: [INVOICE("in_1")],
    });
    if (!obligation) throw new Error("obligation missing");
    const provider = providerReturning({ status: "deleted" });

    expect(await attemptProcessorErasure(db, obligation, provider)).toEqual({ status: "manual" });
    expect(provider.deleteCustomer).not.toHaveBeenCalled();
    expect(await rowById(db, obligation.id)).toMatchObject({ status: "owed", attempts: 0 });
  });
});

describe("retrying an owed delete", () => {
  it("retries one row for the owning shop and discharges it on success", async () => {
    const { db, shop, ownerId } = await twoShops();
    const [obligation] = await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      targets: [CUSTOMER("cus_retry")],
    });
    if (!obligation) throw new Error("obligation missing");
    await attemptProcessorErasure(
      db,
      obligation,
      providerReturning({ status: "failed", error: "HTTP 503" }),
    );

    const result = await retryProcessorErasure(
      db,
      shop.id,
      obligation.id,
      providerReturning({ status: "deleted" }),
    );
    expect(result).toEqual({ ok: true, outcome: { status: "discharged" } });
    expect(await rowById(db, obligation.id)).toMatchObject({ status: "discharged", attempts: 2 });
  });

  it("refuses another shop's obligation and never calls Stripe for it", async () => {
    const { db, shop, otherShop, otherPerson } = await twoShops();
    const [theirs] = await recordProcessorErasureObligations(db, {
      shopId: otherShop.id,
      personId: otherPerson.id,
      targets: [CUSTOMER("cus_theirs")],
    });
    if (!theirs) throw new Error("obligation missing");
    const provider = providerReturning({ status: "deleted" });

    expect(await retryProcessorErasure(db, shop.id, theirs.id, provider)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(provider.deleteCustomer).not.toHaveBeenCalled();
    expect(await listOwedProcessorErasures(db, otherShop.id)).toHaveLength(1);
  });

  it("drains owed deletes across shops on the nightly tick, skipping manual rows", async () => {
    const { db, shop, ownerId, otherShop, otherPerson } = await twoShops();
    await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      targets: [CUSTOMER("cus_one"), INVOICE("in_one")],
    });
    await recordProcessorErasureObligations(db, {
      shopId: otherShop.id,
      personId: otherPerson.id,
      targets: [CUSTOMER("cus_two")],
    });

    const provider = providerReturning({ status: "deleted" });
    expect(await retryPendingProcessorErasures(db, { provider })).toEqual({
      attempted: 2,
      discharged: 2,
    });
    // The invoice snapshot is untouched: it has no API behind it, so a nightly
    // retry would be a call that can never succeed.
    const stillOwed = await listOwedProcessorErasures(db, shop.id);
    expect(stillOwed.map((row) => row.target)).toEqual(["stripe_invoice_snapshot"]);
  });

  it("stops retrying a permanently broken delete, but never forgets it", async () => {
    const { db, shop, ownerId } = await twoShops();
    const [obligation] = await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      targets: [CUSTOMER("cus_hopeless")],
    });
    if (!obligation) throw new Error("obligation missing");
    await db
      .update(processorErasureObligations)
      .set({ attempts: MAX_AUTOMATIC_DELETE_ATTEMPTS, lastError: "HTTP 401: account_invalid" })
      .where(eq(processorErasureObligations.id, obligation.id));

    const provider = providerReturning({ status: "deleted" });
    expect(await retryPendingProcessorErasures(db, { provider })).toEqual({
      attempted: 0,
      discharged: 0,
    });
    expect(provider.deleteCustomer).not.toHaveBeenCalled();
    // Still owed, still visible — the cap stops the nightly call, not the debt.
    expect(await listOwedProcessorErasures(db, shop.id)).toHaveLength(1);
    // And an owner can still drive it by hand.
    expect(
      await retryProcessorErasure(
        db,
        shop.id,
        obligation.id,
        providerReturning({ status: "deleted" }),
      ),
    ).toMatchObject({ ok: true });
  });
});

describe("discharging by attestation", () => {
  it("closes a manual obligation and records who attested it", async () => {
    const { db, shop, ownerId } = await twoShops();
    const [obligation] = await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      targets: [INVOICE("in_done")],
    });
    if (!obligation) throw new Error("obligation missing");

    expect(
      await dischargeProcessorErasure(db, {
        shopId: shop.id,
        obligationId: obligation.id,
        actorPersonId: ownerId,
      }),
    ).toEqual({ ok: true });
    expect(await listOwedProcessorErasures(db, shop.id)).toEqual([]);
    const row = await rowById(db, obligation.id);
    expect(row).toMatchObject({ status: "discharged", dischargedByPersonId: ownerId });
    expect(row?.dischargedAt).toBeInstanceOf(Date);
  });

  it("refuses a second time — a replayed submit rewrites no attestation", async () => {
    const { db, shop, ownerId } = await twoShops();
    const [obligation] = await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      targets: [INVOICE("in_twice")],
    });
    if (!obligation) throw new Error("obligation missing");
    await dischargeProcessorErasure(db, {
      shopId: shop.id,
      obligationId: obligation.id,
      actorPersonId: ownerId,
    });
    const afterFirst = await rowById(db, obligation.id);

    expect(
      await dischargeProcessorErasure(db, {
        shopId: shop.id,
        obligationId: obligation.id,
        actorPersonId: ownerId,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    const afterSecond = await rowById(db, obligation.id);
    expect(afterSecond?.dischargedAt).toEqual(afterFirst?.dischargedAt);
    expect(afterSecond?.dischargedByPersonId).toBe(afterFirst?.dischargedByPersonId);
  });

  it("refuses another shop's obligation, and leaves it standing", async () => {
    const { db, shop, ownerId, otherShop, otherPerson } = await twoShops();
    const [theirs] = await recordProcessorErasureObligations(db, {
      shopId: otherShop.id,
      personId: otherPerson.id,
      targets: [INVOICE("in_theirs")],
    });
    if (!theirs) throw new Error("obligation missing");

    expect(
      await dischargeProcessorErasure(db, {
        shopId: shop.id,
        obligationId: theirs.id,
        actorPersonId: ownerId,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(await listOwedProcessorErasures(db, otherShop.id)).toHaveLength(1);
  });
});
