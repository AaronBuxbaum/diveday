import { and, eq, isNull } from "drizzle-orm";
import { log } from "@/lib/log";
import { type NotificationProvider, publicAppUrl, recipientLocale } from "@/lib/notifications";
import { shopPath } from "@/lib/staff-notices";
import type { AppDb } from "./client";
import { sendNotification } from "./notifications";
import { people, personRoles, shops, userAccounts } from "./schema";

/**
 * **Tell the owner that Stripe turned card payments off** (batch 6 item 8).
 *
 * Called by the Stripe webhook after `applyStripeAccountStatus` claimed the
 * change of state, so it runs once per restriction, not once per delivery.
 * One email to each active owner login; a manager sees the Today row, which
 * is the standing reminder. Bookings already fall back to paying at the shop
 * (`canAcceptPayments`), so nothing here changes what a diver can do.
 *
 * Never throws: a mail problem must not make Stripe redeliver an event whose
 * state is already stored.
 */
export async function tellOwnersPaymentsRestricted(
  db: AppDb,
  input: {
    shopId: string;
    restrictedAt: Date;
    origin?: string | null;
    provider?: NotificationProvider;
  },
): Promise<{ status: "sent" | "demo" | "no_shop" | "no_origin" | "failed"; sent: number }> {
  try {
    const [shop] = await db
      .select({
        id: shops.id,
        slug: shops.slug,
        name: shops.name,
        defaultLocale: shops.defaultLocale,
        isDemo: shops.isDemo,
      })
      .from(shops)
      .where(eq(shops.id, input.shopId))
      .limit(1);
    if (!shop) return { status: "no_shop", sent: 0 };
    // A demo's owner address is anybody's, and its account is test mode.
    if (shop.isDemo) return { status: "demo", sent: 0 };
    const origin = input.origin === undefined ? publicAppUrl() : input.origin;
    if (!origin) return { status: "no_origin", sent: 0 };

    const owners = await db
      .selectDistinct({
        personId: people.id,
        fullName: people.fullName,
        email: userAccounts.email,
        locale: people.locale,
      })
      .from(userAccounts)
      .innerJoin(people, eq(people.id, userAccounts.personId))
      .innerJoin(
        personRoles,
        and(eq(personRoles.personId, people.id), eq(personRoles.role, "owner")),
      )
      .where(
        and(
          eq(people.shopId, shop.id),
          isNull(people.deletedAt),
          isNull(people.anonymizedAt),
          eq(userAccounts.status, "active"),
        ),
      );

    let sent = 0;
    for (const owner of owners) {
      const delivery = await sendNotification(
        db,
        {
          kind: "stripe_payments_restricted",
          shopId: shop.id,
          personId: owner.personId,
          to: owner.email,
          locale: recipientLocale(owner.locale, shop.defaultLocale),
          recipientName: owner.fullName,
          shopName: shop.name,
          settingsUrl: `${origin}${shopPath(shop.slug, "settings")}#money`,
          restrictedAt: input.restrictedAt,
        },
        input.provider,
      );
      if (delivery.status === "sent") sent += 1;
    }
    log("stripe_restricted.owners_told", "info", { shopId: shop.id, owners: owners.length, sent });
    return { status: "sent", sent };
  } catch (error) {
    log("stripe_restricted.notify_failed", "error", {
      shopId: input.shopId,
      error: error instanceof Error ? error.name : "unknown",
    });
    return { status: "failed", sent: 0 };
  }
}
