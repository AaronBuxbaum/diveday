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
import { people, processorErasureObligations, shopStripeAccounts, shops } from "./schema";
import { upsertShopStripeAccount } from "./stripe-accounts";

/** A provider that answers the same way every time and counts its calls. */
function providerReturning(result: DeleteCustomerResult): CustomerProvider & {
  deleteCustomer: ReturnType<typeof vi.fn>;
} {
  return { deleteCustomer: vi.fn().mockResolvedValue(result) };
}

const CUSTOMER = (externalId: string, stripeAccountId = "acct_test") => ({
  target: "stripe_customer" as const,
  externalId,
  stripeAccountId,
});
const INVOICE = (externalId: string, stripeAccountId = "acct_test") => ({
  target: "stripe_invoice_snapshot" as const,
  externalId,
  stripeAccountId,
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
  const { db, shop } = await seededShopContext();
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
      targets: [CUSTOMER("cus_1")],
    });
    if (!obligation) throw new Error("obligation missing");
    const provider = providerReturning({ status: "deleted" });

    expect(await attemptProcessorErasure(db, obligation, provider)).toEqual({
      status: "discharged",
    });
    expect(provider.deleteCustomer).toHaveBeenCalledWith(
      "acct_test",
      "cus_1",
      // House idempotency-key shape: the row's own id, the step, and the
      // attempt ordinal (S4 — see the per-attempt key test below).
      `${obligation.id}:customer-delete-1`,
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

  // S4: Stripe caches the response for an idempotency key for 24h *including
  // errors*. A key derived from the obligation id alone was byte-identical on
  // every retry forever, so an owner who had just fixed the problem and clicked
  // Retry got the cached failure replayed: attempts went up, `last_error` never
  // moved, and no call really reached Stripe. Deletion is idempotent by
  // construction, so a distinct key per attempt costs nothing.
  it("uses a fresh idempotency key per attempt, so a retry is not served Stripe's cached failure", async () => {
    const { db, shop, ownerId } = await twoShops();
    const [obligation] = await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      targets: [CUSTOMER("cus_retry_key")],
    });
    if (!obligation) throw new Error("obligation missing");

    const failing = providerReturning({ status: "failed", error: "HTTP 503" });
    await attemptProcessorErasure(db, obligation, failing);
    const afterFirst = await rowById(db, obligation.id);
    if (!afterFirst) throw new Error("row vanished");
    const succeeding = providerReturning({ status: "deleted" });
    await attemptProcessorErasure(db, afterFirst, succeeding);

    expect(failing.deleteCustomer).toHaveBeenCalledWith(
      "acct_test",
      "cus_retry_key",
      `${obligation.id}:customer-delete-1`,
    );
    expect(succeeding.deleteCustomer).toHaveBeenCalledWith(
      "acct_test",
      "cus_retry_key",
      `${obligation.id}:customer-delete-2`,
    );
  });

  // S6: the snapshotted `(stripeAccountId, externalId)` pair is genuinely
  // shop-owned when the row is raised and is deliberately never re-derived —
  // but the delete goes out on the *platform* key, which can act on every
  // connected account. Shop A reconnects under a new account, freeing
  // `acct_X`; shop B later connects `acct_X`; A's old obligation would then
  // fire a destructive DELETE at a tenant that never asked for it.
  it("refuses to fire at an account that now belongs to another shop", async () => {
    const { db, shop, ownerId, otherShop } = await twoShops();
    const [obligation] = await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      targets: [CUSTOMER("cus_moved", "acct_moved")],
    });
    if (!obligation) throw new Error("obligation missing");

    // The account this obligation names is now the *other* shop's.
    await upsertShopStripeAccount(db, otherShop.id, "acct_moved");

    const provider = providerReturning({ status: "deleted" });
    expect(await attemptProcessorErasure(db, obligation, provider)).toMatchObject({
      status: "failed",
    });
    expect(provider.deleteCustomer).not.toHaveBeenCalled();
    // Still owed and visible to the owner, with the reason on the row — the
    // safe direction: a delete not made can be made later, one made at the
    // wrong tenant cannot be unmade.
    expect(await rowById(db, obligation.id)).toMatchObject({
      status: "owed",
      attempts: 1,
      lastError: "stripe account not owned by this shop",
    });
    expect(await listOwedProcessorErasures(db, shop.id)).toHaveLength(1);
  });

  it("refuses to fire at an account that maps to no shop at all", async () => {
    const { db, shop, ownerId } = await twoShops();
    const [obligation] = await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      targets: [CUSTOMER("cus_orphan", "acct_never_connected")],
    });
    if (!obligation) throw new Error("obligation missing");

    const provider = providerReturning({ status: "deleted" });
    expect(await attemptProcessorErasure(db, obligation, provider)).toMatchObject({
      status: "failed",
    });
    expect(provider.deleteCustomer).not.toHaveBeenCalled();
    expect(await rowById(db, obligation.id)).toMatchObject({ status: "owed" });
  });

  it("still fires at the shop's own account after that account was disconnected", async () => {
    const { db, shop, ownerId } = await twoShops();
    const [obligation] = await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      targets: [CUSTOMER("cus_disconnected")],
    });
    if (!obligation) throw new Error("obligation missing");
    // A disconnected account still belongs to this shop, and Stripe may still
    // answer — the ownership proof is about tenancy, not about connectivity.
    await db
      .update(shopStripeAccounts)
      .set({ disconnectedAt: new Date("2026-07-21T00:00:00.000Z") })
      .where(eq(shopStripeAccounts.shopId, shop.id));

    const provider = providerReturning({ status: "deleted" });
    expect(await attemptProcessorErasure(db, obligation, provider)).toEqual({
      status: "discharged",
    });
    expect(provider.deleteCustomer).toHaveBeenCalled();
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
      targets: [CUSTOMER("cus_two", "acct_other")],
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

  // S2: a capped row stays `owed` forever by design and keeps its original
  // `created_at`, so it sits at the head of this oldest-first, cross-shop scan
  // permanently. With the cap applied in memory *after* the LIMIT, ~`limit`
  // capped rows anywhere on the platform starved every other shop's genuinely
  // transient failure — the drain fetched the same dead rows every night,
  // filtered them all out, and returned `attempted: 0`, indistinguishable in
  // the log from "nothing due". `limit: 1` reproduces at platform scale of two.
  it("does not let capped rows at the head of the queue starve an eligible one behind them", async () => {
    const { db, shop, ownerId, otherShop, otherPerson } = await twoShops();
    // Enough capped rows to fill the old over-fetch (`limit * 4`) on their own,
    // which is what made this starve in production rather than merely in
    // theory: the scan came back full of rows the caller then discarded.
    const capped = await recordProcessorErasureObligations(db, {
      shopId: shop.id,
      personId: ownerId,
      targets: Array.from({ length: 5 }, (_, i) => CUSTOMER(`cus_capped_${i}`)),
    });
    expect(capped).toHaveLength(5);
    const [eligible] = await recordProcessorErasureObligations(db, {
      shopId: otherShop.id,
      personId: otherPerson.id,
      targets: [CUSTOMER("cus_eligible", "acct_other")],
    });
    if (!eligible) throw new Error("obligation missing");

    // The capped rows are the oldest, so an oldest-first scan reaches them
    // first — and they never age out, because a capped row stays owed forever.
    await db
      .update(processorErasureObligations)
      .set({
        attempts: MAX_AUTOMATIC_DELETE_ATTEMPTS,
        lastError: "HTTP 401: account_invalid",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      })
      .where(eq(processorErasureObligations.shopId, shop.id));
    await db
      .update(processorErasureObligations)
      .set({ createdAt: new Date("2026-06-01T00:00:00.000Z") })
      .where(eq(processorErasureObligations.id, eligible.id));

    const provider = providerReturning({ status: "deleted" });
    expect(await retryPendingProcessorErasures(db, { limit: 1, provider })).toEqual({
      attempted: 1,
      discharged: 1,
    });
    expect(provider.deleteCustomer).toHaveBeenCalledTimes(1);
    expect(provider.deleteCustomer).toHaveBeenCalledWith(
      "acct_other",
      "cus_eligible",
      expect.any(String),
    );
    expect(await rowById(db, eligible.id)).toMatchObject({ status: "discharged" });
    // The capped rows are still owed and still nobody's nightly Stripe call.
    expect(await listOwedProcessorErasures(db, shop.id)).toHaveLength(5);
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
