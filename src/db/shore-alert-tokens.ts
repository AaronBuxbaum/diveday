import { and, eq, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import { type NotificationProvider, publicAppUrl, recipientLocale } from "@/lib/notifications";
import { shopPath } from "@/lib/staff-notices";
import {
  issueCapability,
  mintCapability,
  openCapability,
  spendCapability,
  verifyCapability,
  withdrawUnspentCapabilities,
} from "./capabilities";
import type { AppDb, DbExecutor } from "./client";
import { sendNotification } from "./notifications";
import { ownerLogins } from "./owner-logins";
import { activityEvents, shops } from "./schema";

/**
 * **The shore contact's two links** (H-20261014-stale-roll-call-recipients
 * review), both `capabilities` rows bound to the address they were mailed to
 * (issue #3721): `shore_alert_confirm` and `shore_alert_stop`.
 *
 * `confirm` proves the inbox is the shore contact's and that they agreed: the
 * link goes to the address the shop saved and nowhere else, and consuming it
 * sets `shops.shore_alert_confirmed_at` only while the shop still names that
 * address -- the shape `src/db/shop-contact-email.ts` gives the front desk's
 * address (issue #1288), and for the same reasons. It expires, works once,
 * and a fresh one revokes the outstanding one. `stop` is in every alert:
 * using it clears the shop's shore contact, again only while the shop still
 * names the address the alert went to, so an old alert's link cannot take a
 * later, different address off the shop.
 */

export type IssuedShoreAlertConfirmation = { token: string; tokenId: string; expiresAt: Date };

const lower = (email: string) => email.trim().toLowerCase();

/** Mints a fresh confirmation link for the shop's address, revoking any outstanding one. */
export async function issueShoreAlertConfirmation(
  db: AppDb,
  input: { shopId: string; email: string; now?: Date },
): Promise<IssuedShoreAlertConfirmation> {
  const now = input.now ?? nowDate();
  return db.transaction(async (tx) => {
    // Two saves in flight cannot both leave a live link (as in
    // issueShopContactEmailConfirmation; `no key update` for the same reason).
    await tx
      .select({ id: shops.id })
      .from(shops)
      .where(eq(shops.id, input.shopId))
      .for("no key update");
    const { token, id, expiresAt } = await mintCapability(tx, {
      purpose: "shore_alert_confirm",
      shopId: input.shopId,
      subjectId: input.email,
      now,
    });
    if (!expiresAt) throw new Error("shore_alert_confirm must expire");
    return { token, tokenId: id, expiresAt };
  });
}

/** The shop's name while it still names `address`, the address a link was minted for. */
async function shopNaming(db: DbExecutor, shopId: string, address: string) {
  const [shop] = await db
    .select({ name: shops.name })
    .from(shops)
    .where(and(eq(shops.id, shopId), sql`lower(${shops.shoreAlertEmail}) = ${address}`))
    .limit(1);
  return shop ?? null;
}

/**
 * Read-only: what the confirm page renders for a link that would still work,
 * or null for an unknown, spent, expired, superseded or out-of-date one.
 */
export async function checkShoreAlertConfirmation(
  db: DbExecutor,
  input: { token: string; now?: Date },
): Promise<{ shopId: string; shopName: string; email: string } | null> {
  const live = await openCapability(db, {
    purpose: "shore_alert_confirm",
    token: input.token,
    now: input.now,
  });
  if (!live) return null;
  const shop = await shopNaming(db, live.shopId, live.subjectId);
  return shop ? { shopId: live.shopId, shopName: shop.name, email: live.subjectId } : null;
}

/** Whether this exact confirmation link was consumed: the page's only success signal. */
export async function wasShoreAlertConfirmed(
  db: DbExecutor,
  input: { token: string },
): Promise<{ shopName: string; email: string } | null> {
  const known = await verifyCapability(db, {
    purpose: "shore_alert_confirm",
    token: input.token,
  });
  if (!known?.usedAt) return null;
  const [shop] = await db
    .select({ name: shops.name })
    .from(shops)
    .where(eq(shops.id, known.shopId))
    .limit(1);
  return shop ? { shopName: shop.name, email: known.subjectId } : null;
}

/**
 * Whether a token is a shore contact's confirmation link at all, live or not:
 * which words the page uses to say a link is no longer available.
 */
export async function isShoreAlertToken(
  db: DbExecutor,
  input: { token: string },
): Promise<boolean> {
  return (
    (await verifyCapability(db, { purpose: "shore_alert_confirm", token: input.token })) !== null
  );
}

const ADDRESS_CHANGED_UNDER_CLAIM = Symbol("diveday:shore-alert-address-changed");

/**
 * Spends the link and stamps the shop confirmed in one transaction, with the
 * shop row locked first, exactly as `consumeShopContactEmailConfirmation`
 * does: a concurrent save of a new address serialises behind it, and a link
 * whose address the shop no longer names is left unspent and stamps nothing.
 */
export async function consumeShoreAlertConfirmation(
  db: AppDb,
  input: { token: string; now?: Date },
): Promise<{ shopId: string } | null> {
  const now = input.now ?? nowDate();
  try {
    return await db.transaction(async (tx) => {
      const live = await openCapability(tx, {
        purpose: "shore_alert_confirm",
        token: input.token,
        now,
      });
      if (!live) return null;
      await tx
        .select({ id: shops.id })
        .from(shops)
        .where(eq(shops.id, live.shopId))
        .for("no key update");
      // Checked under the lock, before the spend: a stale link stays unspent.
      if (!(await shopNaming(tx, live.shopId, live.subjectId))) return null;
      const claimed = await spendCapability(tx, {
        purpose: "shore_alert_confirm",
        token: input.token,
        now,
      });
      if (!claimed) return null;
      // The stamp keeps its own address predicate: if the lock above is ever
      // removed or reordered, it still confirms only the address the link went to.
      // A miss throws, which rolls the spend back.
      const stamped = await tx
        .update(shops)
        .set({ shoreAlertConfirmedAt: now })
        .where(
          and(
            eq(shops.id, claimed.shopId),
            sql`lower(${shops.shoreAlertEmail}) = ${claimed.subjectId}`,
          ),
        )
        .returning({ id: shops.id });
      if (stamped.length === 0) throw ADDRESS_CHANGED_UNDER_CLAIM;
      return { shopId: claimed.shopId };
    });
  } catch (error) {
    if (error === ADDRESS_CHANGED_UNDER_CLAIM) return null;
    throw error;
  }
}

/**
 * Mints the stop link one alert carries: a `shore_alert_stop` capability bound
 * to the address the alert goes to (issue #3721). Never expires; returns the
 * raw token for the URL.
 */
export async function issueShoreAlertStopToken(
  db: DbExecutor,
  input: { shopId: string; email: string },
): Promise<string> {
  return issueCapability(db, {
    purpose: "shore_alert_stop",
    shopId: input.shopId,
    subjectId: lower(input.email),
  });
}

export type ShoreAlertStopContext = {
  shopId: string;
  shopName: string;
  /** The shop no longer names the address this link was sent to. */
  alreadyStopped: boolean;
};

/**
 * Resolves a stop link to its shop, or null for a token that is not one. A
 * link that was used, or whose address the shop no longer names, resolves as
 * already stopped, so a second click says so rather than failing. A link
 * works once: after the shop adds the same address back and it confirms
 * again, an old alert's spent link cannot take it off a second time
 * (H-20261014-stale-roll-call-recipients security re-review).
 */
export async function resolveShoreAlertStopToken(
  db: DbExecutor,
  token: string,
): Promise<ShoreAlertStopContext | null> {
  const capability = await verifyCapability(db, { purpose: "shore_alert_stop", token });
  if (!capability) return null;
  const [shop] = await db
    .select({ name: shops.name, current: shops.shoreAlertEmail })
    .from(shops)
    .where(eq(shops.id, capability.shopId))
    .limit(1);
  if (!shop) return null;
  const named = shop.current !== null && lower(shop.current) === capability.subjectId;
  return {
    shopId: capability.shopId,
    shopName: shop.name,
    alreadyStopped: capability.usedAt !== null || !named,
  };
}

/**
 * The stop: spends the link (it works once), clears the shop's shore contact
 * (all four columns, which the table's checks require to move together) while
 * the shop still names the address the link went to, and writes the log's
 * line with no actor, all in one transaction. Then it tells each owner by
 * email (H-20261014-stale-roll-call-recipients re-review: a one-click unsubscribe from a mail client makes an
 * accidental stop plausible, and the shop must not learn of it from a silent
 * Today). A spent, stale or unknown link changes nothing and sends nothing.
 */
export async function stopShoreAlertsByToken(
  db: AppDb,
  input: { token: string; now?: Date; origin?: string | null; provider?: NotificationProvider },
): Promise<ShoreAlertStopContext | null> {
  const now = input.now ?? nowDate();
  const stopped = await db.transaction(async (tx) => {
    // The shop row first, then the link: the same order a contact save and an
    // erasure take, so a stop racing either never deadlocks (review B2).
    const known = await verifyCapability(tx, { purpose: "shore_alert_stop", token: input.token });
    if (!known) return null;
    await tx
      .select({ id: shops.id })
      .from(shops)
      .where(eq(shops.id, known.shopId))
      .for("no key update");
    // Spent even when the address has since changed: it then stops nothing,
    // and the page says the contact is already off (review S2).
    const claimed = await spendCapability(tx, {
      purpose: "shore_alert_stop",
      token: input.token,
      now,
    });
    if (!claimed) return null;
    const [cleared] = await tx
      .update(shops)
      .set({
        shoreAlertEmail: null,
        shoreAlertConsentAt: null,
        shoreAlertConsentByPersonId: null,
        shoreAlertConfirmedAt: null,
      })
      .where(
        and(
          eq(shops.id, claimed.shopId),
          sql`lower(${shops.shoreAlertEmail}) = ${claimed.subjectId}`,
        ),
      )
      .returning({
        id: shops.id,
        name: shops.name,
        slug: shops.slug,
        isDemo: shops.isDemo,
        defaultLocale: shops.defaultLocale,
      });
    if (!cleared) return null;
    // Every other alert's link to that address goes with it (review S1).
    await withdrawUnspentCapabilities(tx, { purpose: "shore_alert_stop", shopId: cleared.id });
    await tx.insert(activityEvents).values({
      shopId: cleared.id,
      actorPersonId: null,
      systemReason: "shore_contact_stopped",
      code: "shore_alert_contact_stopped",
      params: {},
      occurredAt: now,
    });
    return cleared;
  });
  if (!stopped) return resolveShoreAlertStopToken(db, input.token);
  await tellOwnersShoreAlertsStopped(db, { shop: stopped, stoppedAt: now, ...input });
  return { shopId: stopped.id, shopName: stopped.name, alreadyStopped: false };
}

/**
 * One email to each owner with an active login. Never throws: the stop is
 * already recorded, and the person who clicked must not see an error over the
 * shop's mail.
 */
async function tellOwnersShoreAlertsStopped(
  db: AppDb,
  input: {
    shop: { id: string; name: string; slug: string; isDemo: boolean; defaultLocale: string };
    stoppedAt: Date;
    origin?: string | null;
    provider?: NotificationProvider;
  },
): Promise<void> {
  const { shop } = input;
  // A demo shop never sent an alert, so it has no stop link to use.
  if (shop.isDemo) return;
  const origin = input.origin === undefined ? publicAppUrl() : input.origin;
  if (!origin) return;
  try {
    let sent = 0;
    const owners = await ownerLogins(db, shop.id);
    for (const owner of owners) {
      const delivery = await sendNotification(
        db,
        {
          kind: "shore_alert_stopped",
          shopId: shop.id,
          personId: owner.personId,
          to: owner.email,
          locale: recipientLocale(owner.locale, shop.defaultLocale),
          recipientName: owner.fullName,
          shopName: shop.name,
          settingsUrl: `${origin}${shopPath(shop.slug, "settings", "emergency-reference")}`,
          stoppedAt: input.stoppedAt,
        },
        input.provider,
      );
      if (delivery.status === "sent") sent += 1;
    }
    log("shore_alert.stopped", "info", { shopId: shop.id, owners: owners.length, sent });
  } catch (error) {
    log("shore_alert.stopped_notify_failed", "error", {
      shopId: shop.id,
      error: error instanceof Error ? error.name : "unknown",
    });
  }
}
