import { and, eq, exists, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { createBearerToken, hashBearerToken } from "@/lib/bearer-tokens";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import { type NotificationProvider, publicAppUrl, recipientLocale } from "@/lib/notifications";
import { SHORE_ALERT_CONFIRMATION_TTL_MS } from "@/lib/shore-alert-contact";
import { shopPath } from "@/lib/staff-notices";
import type { AppDb, DbExecutor } from "./client";
import { sendNotification } from "./notifications";
import { ownerLogins } from "./owner-logins";
import { activityEvents, shopShoreAlertTokens, shops } from "./schema";

/**
 * **The shore contact's two links** (H-20261014-stale-roll-call-recipients review; `shop_shore_alert_tokens`).
 *
 * `confirm` proves the inbox is the shore contact's and that they agreed: the
 * link goes to the address the shop saved and nowhere else, and consuming it
 * sets `shops.shore_alert_confirmed_at` only while the shop still names that
 * address -- the shape `src/db/shop-contact-email.ts` gives the front desk's
 * address (issue #1288), and for the same reasons. `stop` is in every alert:
 * using it clears the shop's shore contact, again only while the shop still
 * names the address the alert went to, so an old alert's link cannot take a
 * later, different address off the shop.
 */

export type IssuedShoreAlertConfirmation = { token: string; tokenId: string; expiresAt: Date };

const lower = (email: string) => email.trim().toLowerCase();

/** Mints a fresh confirmation link for the shop's address, superseding any outstanding one. */
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
    await tx
      .update(shopShoreAlertTokens)
      .set({ supersededAt: now })
      .where(
        and(
          eq(shopShoreAlertTokens.shopId, input.shopId),
          eq(shopShoreAlertTokens.purpose, "confirm"),
          isNull(shopShoreAlertTokens.usedAt),
          isNull(shopShoreAlertTokens.supersededAt),
        ),
      );
    const token = createBearerToken();
    const expiresAt = new Date(now.getTime() + SHORE_ALERT_CONFIRMATION_TTL_MS);
    const [row] = await tx
      .insert(shopShoreAlertTokens)
      .values({
        shopId: input.shopId,
        purpose: "confirm",
        email: lower(input.email),
        tokenHash: hashBearerToken(token),
        expiresAt,
      })
      .returning({ id: shopShoreAlertTokens.id });
    if (!row) throw new Error("Failed to issue shore alert confirmation token");
    return { token, tokenId: row.id, expiresAt };
  });
}

function liveConfirmToken(token: string, now: Date) {
  return and(
    eq(shopShoreAlertTokens.tokenHash, hashBearerToken(token)),
    eq(shopShoreAlertTokens.purpose, "confirm"),
    isNull(shopShoreAlertTokens.usedAt),
    isNull(shopShoreAlertTokens.supersededAt),
    gt(shopShoreAlertTokens.expiresAt, now),
  );
}

/** The shop still names the address this link was minted for. */
function shopStillNamesAddress() {
  return exists(
    sql`(select 1 from ${shops} where ${shops.id} = ${shopShoreAlertTokens.shopId} and lower(${shops.shoreAlertEmail}) = ${shopShoreAlertTokens.email})`,
  );
}

/**
 * Read-only: what the confirm page renders for a link that would still work,
 * or null for an unknown, spent, expired, superseded or out-of-date one.
 */
export async function checkShoreAlertConfirmation(
  db: DbExecutor,
  input: { token: string; now?: Date },
): Promise<{ shopId: string; shopName: string; email: string } | null> {
  const now = input.now ?? nowDate();
  const [row] = await db
    .select({
      shopId: shopShoreAlertTokens.shopId,
      shopName: shops.name,
      email: shopShoreAlertTokens.email,
    })
    .from(shopShoreAlertTokens)
    .innerJoin(shops, eq(shops.id, shopShoreAlertTokens.shopId))
    .where(and(liveConfirmToken(input.token, now), shopStillNamesAddress()))
    .limit(1);
  return row ?? null;
}

/** Whether this exact confirmation link was consumed: the page's only success signal. */
export async function wasShoreAlertConfirmed(
  db: DbExecutor,
  input: { token: string },
): Promise<{ shopName: string; email: string } | null> {
  const [row] = await db
    .select({ shopName: shops.name, email: shopShoreAlertTokens.email })
    .from(shopShoreAlertTokens)
    .innerJoin(shops, eq(shops.id, shopShoreAlertTokens.shopId))
    .where(
      and(
        eq(shopShoreAlertTokens.tokenHash, hashBearerToken(input.token)),
        eq(shopShoreAlertTokens.purpose, "confirm"),
        isNotNull(shopShoreAlertTokens.usedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Whether a token is a shore contact's confirmation link at all, live or not:
 * which words the page uses to say a link is no longer available.
 */
export async function isShoreAlertToken(
  db: DbExecutor,
  input: { token: string },
): Promise<boolean> {
  const [row] = await db
    .select({ id: shopShoreAlertTokens.id })
    .from(shopShoreAlertTokens)
    .where(
      and(
        eq(shopShoreAlertTokens.tokenHash, hashBearerToken(input.token)),
        eq(shopShoreAlertTokens.purpose, "confirm"),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** Thrown inside the consume transaction to roll the token claim back. */
const ADDRESS_CHANGED_UNDER_CLAIM = Symbol("diveday:shore-alert-address-changed");

/**
 * Claims the link and stamps the shop confirmed in one transaction, with the
 * shop row locked first, exactly as `consumeShopContactEmailConfirmation`
 * does: a concurrent save of a new address serialises behind it, and a stamp
 * that matched nothing rolls the claim back.
 */
export async function consumeShoreAlertConfirmation(
  db: AppDb,
  input: { token: string; now?: Date },
): Promise<{ shopId: string } | null> {
  const now = input.now ?? nowDate();
  try {
    return await db.transaction(async (tx) => {
      const [live] = await tx
        .select({ shopId: shopShoreAlertTokens.shopId })
        .from(shopShoreAlertTokens)
        .where(liveConfirmToken(input.token, now))
        .limit(1);
      if (!live) return null;
      await tx
        .select({ id: shops.id })
        .from(shops)
        .where(eq(shops.id, live.shopId))
        .for("no key update");
      const [claimed] = await tx
        .update(shopShoreAlertTokens)
        .set({ usedAt: now })
        .where(and(liveConfirmToken(input.token, now), shopStillNamesAddress()))
        .returning({ shopId: shopShoreAlertTokens.shopId, email: shopShoreAlertTokens.email });
      if (!claimed) return null;
      const [stamped] = await tx
        .update(shops)
        .set({ shoreAlertConfirmedAt: now })
        .where(
          and(
            eq(shops.id, claimed.shopId),
            sql`lower(${shops.shoreAlertEmail}) = ${claimed.email}`,
          ),
        )
        .returning({ id: shops.id });
      if (!stamped) throw ADDRESS_CHANGED_UNDER_CLAIM;
      return { shopId: claimed.shopId };
    });
  } catch (error) {
    if (error === ADDRESS_CHANGED_UNDER_CLAIM) return null;
    throw error;
  }
}

/** Mints the stop link one alert carries. Never expires; returns the raw token for the URL. */
export async function issueShoreAlertStopToken(
  db: DbExecutor,
  input: { shopId: string; email: string },
): Promise<string> {
  const token = createBearerToken();
  await db.insert(shopShoreAlertTokens).values({
    shopId: input.shopId,
    purpose: "stop",
    email: lower(input.email),
    tokenHash: hashBearerToken(token),
  });
  return token;
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
  const [row] = await db
    .select({
      shopId: shopShoreAlertTokens.shopId,
      shopName: shops.name,
      email: shopShoreAlertTokens.email,
      current: shops.shoreAlertEmail,
      usedAt: shopShoreAlertTokens.usedAt,
    })
    .from(shopShoreAlertTokens)
    .innerJoin(shops, eq(shops.id, shopShoreAlertTokens.shopId))
    .where(
      and(
        eq(shopShoreAlertTokens.tokenHash, hashBearerToken(token)),
        eq(shopShoreAlertTokens.purpose, "stop"),
      ),
    )
    .limit(1);
  if (!row) return null;
  const named = row.current !== null && lower(row.current) === row.email;
  return {
    shopId: row.shopId,
    shopName: row.shopName,
    alreadyStopped: row.usedAt !== null || !named,
  };
}

/**
 * The stop: claims the link (it works once), clears the shop's shore contact
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
  const tokenHash = hashBearerToken(input.token);
  const stopped = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(shopShoreAlertTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(shopShoreAlertTokens.tokenHash, tokenHash),
          eq(shopShoreAlertTokens.purpose, "stop"),
          isNull(shopShoreAlertTokens.usedAt),
        ),
      )
      .returning({ shopId: shopShoreAlertTokens.shopId, email: shopShoreAlertTokens.email });
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
        and(eq(shops.id, claimed.shopId), sql`lower(${shops.shoreAlertEmail}) = ${claimed.email}`),
      )
      .returning({
        id: shops.id,
        name: shops.name,
        slug: shops.slug,
        isDemo: shops.isDemo,
        defaultLocale: shops.defaultLocale,
      });
    if (!cleared) return null;
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
