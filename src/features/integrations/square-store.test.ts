import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordCounterOrder } from "@/db/orders";
import { createPerson } from "@/db/people";
import {
  collectionEntries,
  integrationSyncRecords,
  people,
  personRoles,
  shops,
  userAccounts,
} from "@/db/schema";
import { recordPurchaseRefund } from "@/features/recorded-purchases";
import { percentFeeCents } from "@/lib/billing/pricing-plans";
import { nowMs } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import {
  getSquareReceiptState,
  linkSquareReceipt,
  releaseSquareReceipt,
  squareReceiptMatch,
} from "./square-store";
import { disconnectShopIntegration, getShopIntegration, recordShopIntegration } from "./store";

beforeEach(() => {
  vi.stubEnv("SQUARE_CLIENT_ID", "test-client");
  vi.stubEnv("SQUARE_CLIENT_SECRET", "test-secret");
  vi.stubEnv("SQUARE_ENVIRONMENT", "sandbox");
});
afterEach(() => vi.unstubAllEnvs());

const receipt = {
  paymentId: "payment-1",
  locationId: "location-1",
  status: "COMPLETED",
  currency: "usd",
  totalCents: 10000,
  tipCents: 0,
  refundedCents: 0,
  receiptNumber: "ABCD",
};
const order = {
  totalCents: 10000,
  currency: "usd",
  refundedCents: 0,
  counterReceipt: { tipCents: 0 },
};
const paymentResponse = (refund = 0) =>
  Response.json({
    payment: {
      id: "payment-1",
      location_id: "location-1",
      status: "COMPLETED",
      total_money: { amount: 10000, currency: "USD" },
      refunded_money: { amount: refund, currency: "USD" },
    },
  });

async function fixture() {
  // A fresh database: this subject commits receipt and money transactions.
  const { db, shop } = await seededShopContext();
  await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shop.id));
  const [staff] = await db
    .select({ personId: personRoles.personId })
    .from(personRoles)
    .innerJoin(people, eq(people.id, personRoles.personId))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  if (!staff) throw new Error("owner missing");
  const [payer] = await db.select().from(people).where(eq(people.shopId, shop.id)).limit(1);
  if (!payer) throw new Error("payer missing");
  const input = {
    shopId: shop.id,
    personId: payer.id,
    createdByPersonId: staff.personId,
    collection: "cash" as const,
    lineItems: [
      {
        kind: "other" as const,
        description: "Counter purchase",
        quantity: 1,
        unitAmountCents: 10000,
      },
    ],
  };
  const recorded = await recordCounterOrder(db, input);
  if (!recorded.ok) throw new Error("purchase missing");
  const connect = () =>
    recordShopIntegration(db, {
      shopId: shop.id,
      provider: "square",
      externalAccountId: "merchant-1",
      credentials: {
        accessToken: "test-access",
        refreshToken: "test-refresh",
        expiresAt: nowMs() + 3600000,
        merchantId: "merchant-1",
      },
      settings: { environment: "sandbox", squareLocationId: "location-1" },
    });
  await connect();
  const linkInput = {
    shopId: shop.id,
    personId: staff.personId,
    orderId: recorded.order.id,
    paymentId: "payment-1",
  };
  return { db, shop, input, connect, linkInput };
}

describe("Square receipt matching", () => {
  it("requires completed payment, selected location, exact original gross/tip/currency and refund", () => {
    expect(squareReceiptMatch(receipt, order, "location-1")).toBe("matched");
    expect(squareReceiptMatch({ ...receipt, status: "PENDING" }, order, "location-1")).toBe(
      "not_completed",
    );
    expect(squareReceiptMatch(receipt, order, "another-location")).toBe("location_mismatch");
    for (const change of [{ currency: "jpy" }, { totalCents: 9999 }, { tipCents: 100 }])
      expect(squareReceiptMatch({ ...receipt, ...change }, order, "location-1")).toBe(
        "amount_mismatch",
      );
    expect(squareReceiptMatch({ ...receipt, refundedCents: 2500 }, order, "location-1")).toBe(
      "refund_mismatch",
    );
  });
  it("links and rechecks one purchase without a second collection, including refund observations", async () => {
    const { db, linkInput } = await fixture();
    const entries = () =>
      db.select().from(collectionEntries).where(eq(collectionEntries.sourceId, linkInput.orderId));
    const before = await entries();
    expect(before).toHaveLength(1);
    expect(percentFeeCents(before[0]?.amountCents ?? 0, 300)).toBe(300);
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => paymentResponse());
    expect(await linkSquareReceipt(db, linkInput, fetchImpl)).toBe("matched");
    expect(await linkSquareReceipt(db, linkInput, fetchImpl)).toBe("matched");
    expect(await entries()).toEqual(before);
    fetchImpl.mockImplementation(async () => paymentResponse(2500));
    expect(await linkSquareReceipt(db, linkInput, fetchImpl)).toBe("refund_mismatch");
    expect(await entries()).toEqual(before);
    expect(
      (await getSquareReceiptState(db, linkInput.shopId, linkInput.orderId)).link?.lastError,
    ).toBe("refund_mismatch");
    // Only the existing manual return path owns the economic reversal.
    const refund = {
      shopId: linkInput.shopId,
      orderId: linkInput.orderId,
      actorPersonId: linkInput.personId,
      attemptId: randomUUID(),
      currency: "usd",
      amountCents: 2500,
      expectedRefundedCents: 0,
      reason: "Already returned in Square",
    };
    expect((await recordPurchaseRefund(db, refund)).ok).toBe(true);
    expect((await recordPurchaseRefund(db, refund)).ok).toBe(true);
    const partial = await entries();
    expect(partial.map((entry) => entry.amountCents)).toEqual([10000, -2500]);
    expect(partial[1]?.reversesEntryId).toBe(before[0]?.id);
    expect(
      percentFeeCents(
        partial.reduce((sum, entry) => sum + entry.amountCents, 0),
        300,
      ),
    ).toBe(225);
    expect(await linkSquareReceipt(db, linkInput, fetchImpl)).toBe("matched");
    expect(await linkSquareReceipt(db, linkInput, fetchImpl)).toBe("matched");
    expect(await entries()).toEqual(partial);
    // A distinct later refund observation still never creates another sale or reversal.
    fetchImpl.mockImplementation(async () => paymentResponse(10000));
    expect(await linkSquareReceipt(db, linkInput, fetchImpl)).toBe("refund_mismatch");
    expect(await entries()).toEqual(partial);
    expect(
      (
        await recordPurchaseRefund(db, {
          ...refund,
          attemptId: randomUUID(),
          amountCents: 7500,
          expectedRefundedCents: 2500,
        })
      ).ok,
    ).toBe(true);
    const full = await entries();
    expect(full.map((entry) => entry.amountCents)).toEqual([10000, -2500, -7500]);
    expect(
      percentFeeCents(
        full.reduce((sum, entry) => sum + entry.amountCents, 0),
        300,
      ),
    ).toBe(0);
    expect(await linkSquareReceipt(db, linkInput, fetchImpl)).toBe("matched");
    expect(await linkSquareReceipt(db, linkInput, fetchImpl)).toBe("matched");
    expect(await entries()).toEqual(full);
    expect(
      await db
        .select()
        .from(integrationSyncRecords)
        .where(eq(integrationSyncRecords.provider, "square")),
    ).toHaveLength(1);
  });
  it("keeps duplicate protection across disconnect and reconnect", async () => {
    const { db, linkInput, input, connect } = await fixture();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => paymentResponse());
    expect(await linkSquareReceipt(db, linkInput, fetchImpl)).toBe("matched");
    await disconnectShopIntegration(db, linkInput.shopId, "square");
    expect(await linkSquareReceipt(db, linkInput, fetchImpl)).toBe("not_connected");
    await connect();
    const second = await recordCounterOrder(db, input);
    if (!second.ok) throw new Error("second purchase missing");
    expect(await linkSquareReceipt(db, { ...linkInput, orderId: second.order.id }, fetchImpl)).toBe(
      "already_linked",
    );
    expect(await linkSquareReceipt(db, linkInput, fetchImpl)).toBe("matched");
  });
  it("rejects a foreign order/person before contacting Square and never leaks the linked tenant", async () => {
    const { db, linkInput } = await fixture();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => paymentResponse());
    expect(await linkSquareReceipt(db, { ...linkInput, orderId: randomUUID() }, fetchImpl)).toBe(
      "invalid",
    );
    expect(await linkSquareReceipt(db, { ...linkInput, personId: randomUUID() }, fetchImpl)).toBe(
      "invalid",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await getSquareReceiptState(db, randomUUID(), linkInput.orderId)).link).toBeNull();
  });
  it("does not link a response arriving after a disconnect", async () => {
    const { db, linkInput } = await fixture();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      await disconnectShopIntegration(db, linkInput.shopId, "square");
      return paymentResponse();
    });
    expect(await linkSquareReceipt(db, linkInput, fetchImpl)).toBe("not_connected");
    expect((await getSquareReceiptState(db, linkInput.shopId, linkInput.orderId)).link).toBeNull();
  });
});

it("deletes only the receipt association, retaining history and allowing a corrected match", async () => {
  const { db, linkInput } = await fixture();
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => paymentResponse());
  expect(await linkSquareReceipt(db, linkInput, fetchImpl)).toBe("matched");
  const before = await db
    .select()
    .from(collectionEntries)
    .where(eq(collectionEntries.sourceId, linkInput.orderId));
  expect(await releaseSquareReceipt(db, { ...linkInput, paymentId: "stale-form" })).toBe(false);
  expect(await releaseSquareReceipt(db, linkInput)).toBe(true);
  expect((await getSquareReceiptState(db, linkInput.shopId, linkInput.orderId)).link).toBeNull();
  expect(await linkSquareReceipt(db, linkInput, fetchImpl)).toBe("matched");
  expect(
    await db
      .select()
      .from(integrationSyncRecords)
      .where(eq(integrationSyncRecords.sourceId, linkInput.orderId)),
  ).toHaveLength(2);
  expect(
    await db
      .select()
      .from(collectionEntries)
      .where(eq(collectionEntries.sourceId, linkInput.orderId)),
  ).toEqual(before);
});

it("scopes real foreign orders and staff before HTTP and reserves a merchant payment across shops", async () => {
  const { db, linkInput, input } = await fixture();
  const [otherShop] = await db
    .insert(shops)
    .values({ name: "Other Square shop", slug: `square-${randomUUID()}`, timezone: "UTC" })
    .returning();
  if (!otherShop) throw new Error("other shop missing");
  const otherStaff = await createPerson(db, {
    shopId: otherShop.id,
    fullName: "Other owner",
    email: "square-other@example.test",
    phone: null,
    origin: "seed",
    roles: ["owner"],
  });
  await db
    .insert(userAccounts)
    .values({ personId: otherStaff.id, email: "square-other@example.test", status: "active" });
  const otherOrder = await recordCounterOrder(db, {
    ...input,
    shopId: otherShop.id,
    personId: otherStaff.id,
    createdByPersonId: otherStaff.id,
  });
  if (!otherOrder.ok) throw new Error("other order missing");
  await recordShopIntegration(db, {
    shopId: otherShop.id,
    provider: "square",
    externalAccountId: "merchant-1",
    settings: { environment: "sandbox", squareLocationId: "location-1" },
    credentials: {
      accessToken: "other-test-access",
      refreshToken: "other-test-refresh",
      merchantId: "merchant-1",
      expiresAt: nowMs() + 3600000,
    },
  });
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => paymentResponse());
  expect(
    await linkSquareReceipt(db, { ...linkInput, orderId: otherOrder.order.id }, fetchImpl),
  ).toBe("invalid");
  expect(await linkSquareReceipt(db, { ...linkInput, personId: otherStaff.id }, fetchImpl)).toBe(
    "invalid",
  );
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(await linkSquareReceipt(db, linkInput, fetchImpl)).toBe("matched");
  expect(
    await linkSquareReceipt(
      db,
      { ...linkInput, shopId: otherShop.id, personId: otherStaff.id, orderId: otherOrder.order.id },
      fetchImpl,
    ),
  ).toBe("already_linked");
  expect((await getSquareReceiptState(db, otherShop.id, linkInput.orderId)).link).toBeNull();
});

it("an in-flight credential refresh cannot reconnect a disconnected merchant", async () => {
  const { db, linkInput } = await fixture();
  await recordShopIntegration(db, {
    shopId: linkInput.shopId,
    provider: "square",
    externalAccountId: "merchant-1",
    settings: { environment: "sandbox", squareLocationId: "location-1" },
    credentials: {
      accessToken: "test-access",
      refreshToken: "test-refresh",
      merchantId: "merchant-1",
      expiresAt: nowMs() - 1000,
    },
  });
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
    await disconnectShopIntegration(db, linkInput.shopId, "square");
    return Response.json({
      access_token: "renewed-test-access",
      refresh_token: "renewed-test-refresh",
      merchant_id: "merchant-1",
      expires_at: new Date(nowMs() + 3600000).toISOString(),
    });
  });
  expect(await linkSquareReceipt(db, linkInput, fetchImpl)).toBe("not_connected");
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(await getShopIntegration(db, linkInput.shopId, "square")).toBeNull();
  expect((await getSquareReceiptState(db, linkInput.shopId, linkInput.orderId)).link).toBeNull();
});
