import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { fileScopedShopContext } from "@/test/db";
import { people, personRoles, shops, userAccounts } from "./schema";
import { tellOwnersPaymentsRestricted } from "./stripe-restricted";

/**
 * **The owner hears when Stripe turns card payments off** (batch 6 item 8):
 * one email to each active owner login, never to anyone else, and never from
 * a demo shop.
 */
const ctx = fileScopedShopContext();
const ORIGIN = "https://diveday.example";
const AT = new Date("2026-10-14T12:00:00Z");

function recorder() {
  const sent: Notification[] = [];
  const provider: NotificationProvider = {
    async send(notification) {
      sent.push(notification);
      return { status: "sent", providerMessageId: `msg-${sent.length}` };
    },
  };
  return { sent, provider };
}

async function ownerEmails() {
  const { db, shop } = ctx;
  const rows = await db
    .selectDistinct({ email: userAccounts.email })
    .from(userAccounts)
    .innerJoin(people, eq(people.id, userAccounts.personId))
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(people.shopId, shop.id),
        eq(userAccounts.status, "active"),
        eq(personRoles.role, "owner"),
      ),
    );
  return rows.map((row) => row.email).sort();
}

describe("tellOwnersPaymentsRestricted", () => {
  it("emails each owner, and only owners, with the way to payment settings", async () => {
    const { db, shop } = ctx;
    await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shop.id));
    const { sent, provider } = recorder();

    const outcome = await tellOwnersPaymentsRestricted(db, {
      shopId: shop.id,
      restrictedAt: AT,
      origin: ORIGIN,
      provider,
    });

    const owners = await ownerEmails();
    expect(owners.length).toBeGreaterThan(0);
    expect(outcome).toEqual({ status: "sent", sent: owners.length });
    expect(sent.map((notification) => notification.to).sort()).toEqual(owners);
    for (const notification of sent) {
      expect(notification).toMatchObject({
        kind: "stripe_payments_restricted",
        shopId: shop.id,
        settingsUrl: `${ORIGIN}/shop/${shop.slug}/settings#money`,
        restrictedAt: AT,
      });
    }
  });

  it("tells nobody from a demo shop", async () => {
    const { db, shop } = ctx;
    await db.update(shops).set({ isDemo: true }).where(eq(shops.id, shop.id));
    const { sent, provider } = recorder();
    const outcome = await tellOwnersPaymentsRestricted(db, {
      shopId: shop.id,
      restrictedAt: AT,
      origin: ORIGIN,
      provider,
    });
    expect(outcome.status).toBe("demo");
    expect(sent).toEqual([]);
  });
});
