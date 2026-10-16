import { and, eq, gt, isNotNull, isNull, lt, or } from "drizzle-orm";
import { createBearerToken, hashBearerToken } from "@/lib/bearer-tokens";
import { BOOKKEEPER_CONFIRMATION_TTL_MS, bookkeeperMonthOnSet } from "@/lib/bookkeeper";
import { log } from "@/lib/log";
import { type NotificationProvider, publicAppUrl, recipientLocale } from "@/lib/notifications";
import { shopPath } from "@/lib/staff-notices";
import type { AppDb, DbExecutor } from "./client";
import { sendNotification } from "./notifications";
import { ownerLogins } from "./owner-logins";
import { people, shops } from "./schema";

/**
 * **The bookkeeper's address and the month-end claim** (fifth loop, item 35;
 * ADR 20261016-bookkeeper-month-end-email). The address lives on the shop with
 * who set it and when; nothing is sent to it until the bookkeeper opens the
 * confirm link it receives (`bookkeeper_confirmed_at`, security review B1, on
 * the shore contact's model, H-118); `bookkeeper_sent_month` is the claim the
 * daily pass moves forward before it sends.
 */

export type BookkeeperSetting = {
  email: string;
  setAt: Date;
  setByPersonId: string;
  /** The setter's name as the people row holds it today; null when gone. */
  setByName: string | null;
  confirmedAt: Date | null;
};

/** The shop's bookkeeper address, or null while the email is off. */
export async function readBookkeeper(
  db: DbExecutor,
  shopId: string,
): Promise<BookkeeperSetting | null> {
  const [row] = await db
    .select({
      email: shops.bookkeeperEmail,
      setAt: shops.bookkeeperEmailSetAt,
      setByPersonId: shops.bookkeeperEmailSetByPersonId,
      setByName: people.fullName,
      confirmedAt: shops.bookkeeperConfirmedAt,
    })
    .from(shops)
    .leftJoin(
      people,
      and(eq(people.id, shops.bookkeeperEmailSetByPersonId), eq(people.shopId, shops.id)),
    )
    .where(eq(shops.id, shopId))
    .limit(1);
  if (!row?.email || !row.setAt || !row.setByPersonId) return null;
  return {
    email: row.email,
    setAt: row.setAt,
    setByPersonId: row.setByPersonId,
    setByName: row.setByName,
    confirmedAt: row.confirmedAt,
  };
}

/**
 * What a save did: the first address, a different one, the address taken
 * off, the same one saved again (which re-records who stands behind it), or
 * nothing at all (clearing an empty field).
 */
export type BookkeeperChange = "set" | "changed" | "cleared" | "resaved" | "none";

/** Every bookkeeper column empty: the address, its provenance, its confirmation and its claim. */
export const BOOKKEEPER_CLEARED = {
  bookkeeperEmail: null,
  bookkeeperEmailSetAt: null,
  bookkeeperEmailSetByPersonId: null,
  bookkeeperSentMonth: null,
  bookkeeperConfirmedAt: null,
  bookkeeperConfirmTokenHash: null,
  bookkeeperConfirmExpiresAt: null,
} as const;

/**
 * Sets the address (normalized by the caller) with who set it and when, or
 * clears all of it with null, under a lock on the shop row so two saves agree
 * on what changed.
 *
 * A new address is unconfirmed: the confirmation and any outstanding link are
 * cleared with the old one, so nothing is sent until the new inbox confirms.
 * It also counts the month already due as sent (`bookkeeperMonthOnSet`), so
 * its first email is the next 2nd's. Saving the address already on file moves
 * only who set it and when (an owner vouching for an address a departed
 * manager set, security review F1), never the claim or the confirmation.
 */
export async function setBookkeeper(
  db: AppDb,
  input: { shopId: string; timeZone: string; email: string | null; personId: string; now: Date },
): Promise<{ change: BookkeeperChange; confirmed: boolean }> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ email: shops.bookkeeperEmail, confirmedAt: shops.bookkeeperConfirmedAt })
      .from(shops)
      .where(eq(shops.id, input.shopId))
      .for("no key update");
    const none = { change: "none" as const, confirmed: false };
    if (!current) return none;
    if (input.email === null) {
      if (current.email === null) return none;
      await tx.update(shops).set(BOOKKEEPER_CLEARED).where(eq(shops.id, input.shopId));
      return { change: "cleared" as const, confirmed: false };
    }
    if (current.email === input.email) {
      await tx
        .update(shops)
        .set({ bookkeeperEmailSetAt: input.now, bookkeeperEmailSetByPersonId: input.personId })
        .where(eq(shops.id, input.shopId));
      return { change: "resaved" as const, confirmed: current.confirmedAt !== null };
    }
    await tx
      .update(shops)
      .set({
        ...BOOKKEEPER_CLEARED,
        bookkeeperEmail: input.email,
        bookkeeperEmailSetAt: input.now,
        bookkeeperEmailSetByPersonId: input.personId,
        bookkeeperSentMonth: bookkeeperMonthOnSet(input.now, input.timeZone),
      })
      .where(eq(shops.id, input.shopId));
    const change: BookkeeperChange = current.email === null ? "set" : "changed";
    return { change, confirmed: false };
  });
}

/**
 * Mints the confirm link for the address on file, replacing any outstanding
 * one, or null when the shop no longer names `email` or it is already
 * confirmed. Returns the raw token for the URL; only its hash is stored.
 */
export async function issueBookkeeperConfirmation(
  db: DbExecutor,
  input: { shopId: string; email: string; now: Date },
): Promise<{ token: string; expiresAt: Date } | null> {
  const token = createBearerToken();
  const expiresAt = new Date(input.now.getTime() + BOOKKEEPER_CONFIRMATION_TTL_MS);
  const issued = await db
    .update(shops)
    .set({
      bookkeeperConfirmTokenHash: hashBearerToken(token),
      bookkeeperConfirmExpiresAt: expiresAt,
    })
    .where(
      and(
        eq(shops.id, input.shopId),
        eq(shops.bookkeeperEmail, input.email),
        isNull(shops.bookkeeperConfirmedAt),
      ),
    )
    .returning({ id: shops.id });
  return issued.length > 0 ? { token, expiresAt } : null;
}

function liveLink(token: string, now: Date) {
  return and(
    eq(shops.bookkeeperConfirmTokenHash, hashBearerToken(token)),
    isNull(shops.bookkeeperConfirmedAt),
    gt(shops.bookkeeperConfirmExpiresAt, now),
    isNotNull(shops.bookkeeperEmail),
  );
}

/**
 * Read-only: what the confirm page shows for a link that would still work, or
 * null for an unknown, spent, expired or replaced one.
 */
export async function checkBookkeeperConfirmation(
  db: DbExecutor,
  input: { token: string; now: Date },
): Promise<{ shopName: string; email: string } | null> {
  const [row] = await db
    .select({ shopName: shops.name, email: shops.bookkeeperEmail })
    .from(shops)
    .where(liveLink(input.token, input.now))
    .limit(1);
  return row?.email ? { shopName: row.shopName, email: row.email } : null;
}

/** Whether this exact link confirmed the address on file: the page's only success signal. */
export async function wasBookkeeperConfirmed(
  db: DbExecutor,
  input: { token: string },
): Promise<{ shopName: string } | null> {
  const [row] = await db
    .select({ shopName: shops.name })
    .from(shops)
    .where(
      and(
        eq(shops.bookkeeperConfirmTokenHash, hashBearerToken(input.token)),
        isNotNull(shops.bookkeeperConfirmedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Whether a token is a bookkeeper's link the shop still holds, live or not. */
export async function isBookkeeperToken(
  db: DbExecutor,
  input: { token: string },
): Promise<boolean> {
  const [row] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(eq(shops.bookkeeperConfirmTokenHash, hashBearerToken(input.token)))
    .limit(1);
  return row !== undefined;
}

/**
 * Consumes the link in one statement: stamps the address confirmed only while
 * the link is live, so a link whose address was changed (which cleared its
 * hash), replaced, used or expired confirms nothing.
 */
export async function consumeBookkeeperConfirmation(
  db: DbExecutor,
  input: { token: string; now: Date },
): Promise<{ shopId: string } | null> {
  const [row] = await db
    .update(shops)
    .set({ bookkeeperConfirmedAt: input.now })
    .where(liveLink(input.token, input.now))
    .returning({ shopId: shops.id });
  return row ?? null;
}

/**
 * Every real shop whose bookkeeper confirmed their address: the daily pass's
 * candidates. The pass re-checks the setter's standing itself.
 */
export async function listBookkeeperShops(db: DbExecutor) {
  return db
    .select({
      id: shops.id,
      slug: shops.slug,
      name: shops.name,
      timezone: shops.timezone,
      currency: shops.currency,
      defaultLocale: shops.defaultLocale,
      email: shops.bookkeeperEmail,
      setByPersonId: shops.bookkeeperEmailSetByPersonId,
      sentMonth: shops.bookkeeperSentMonth,
    })
    .from(shops)
    .where(
      and(
        eq(shops.isDemo, false),
        isNotNull(shops.bookkeeperEmail),
        isNotNull(shops.bookkeeperConfirmedAt),
      ),
    );
}

/**
 * **The claim**: moves `bookkeeper_sent_month` to `month` only while the shop
 * still names `email`, confirmed, and has not sent that month, in one
 * statement, so two passes at once send it once and an address changed
 * mid-pass is never mailed the old one's files. True when this caller won.
 */
export async function claimBookkeeperMonth(
  db: DbExecutor,
  input: { shopId: string; email: string; month: string },
): Promise<boolean> {
  const claimed = await db
    .update(shops)
    .set({ bookkeeperSentMonth: input.month })
    .where(
      and(
        eq(shops.id, input.shopId),
        eq(shops.bookkeeperEmail, input.email),
        isNotNull(shops.bookkeeperConfirmedAt),
        or(isNull(shops.bookkeeperSentMonth), lt(shops.bookkeeperSentMonth, input.month)),
      ),
    )
    .returning({ id: shops.id });
  return claimed.length > 0;
}

/**
 * Gives a claimed month back after a send that failed, so the next day's pass
 * tries again; only while the claim is still this one.
 */
export async function releaseBookkeeperMonth(
  db: DbExecutor,
  input: { shopId: string; month: string; previous: string | null },
): Promise<void> {
  await db
    .update(shops)
    .set({ bookkeeperSentMonth: input.previous })
    .where(and(eq(shops.id, input.shopId), eq(shops.bookkeeperSentMonth, input.month)));
}

/** What the owners are told about the bookkeeper's address. */
export type BookkeeperOwnerEvent =
  | { event: "set" | "changed"; email: string; actorName: string }
  | { event: "cleared"; actorName: string }
  | { event: "sent"; email: string; month: string };

/**
 * One email to each owner with an active login (security review B1 and F1):
 * when the address is set, changed or removed, and on every month-end send,
 * so an address nobody meant to keep shows up in an owner's inbox rather than
 * at the bottom of a Reports month. Never throws: the act it reports already
 * happened. A demo shop sends nothing. Returns how many went.
 */
export async function tellOwnersAboutBookkeeper(
  db: AppDb,
  input: {
    shop: { id: string; name: string; slug: string; defaultLocale: string };
    what: BookkeeperOwnerEvent;
    at: Date;
    origin?: string | null;
    provider?: NotificationProvider;
  },
): Promise<number> {
  const { shop } = input;
  const origin = input.origin === undefined ? publicAppUrl() : input.origin;
  if (!origin) return 0;
  try {
    const [row] = await db
      .select({ isDemo: shops.isDemo })
      .from(shops)
      .where(eq(shops.id, shop.id))
      .limit(1);
    if (!row || row.isDemo) return 0;
    let sent = 0;
    for (const owner of await ownerLogins(db, shop.id)) {
      const delivery = await sendNotification(
        db,
        {
          kind: "bookkeeper_notice",
          shopId: shop.id,
          personId: owner.personId,
          to: owner.email,
          locale: recipientLocale(owner.locale, shop.defaultLocale),
          recipientName: owner.fullName,
          shopName: shop.name,
          reportsUrl: `${origin}${shopPath(shop.slug, "reports")}#bookkeeper`,
          at: input.at,
          ...input.what,
        },
        input.provider,
      );
      if (delivery.status === "sent") sent += 1;
    }
    return sent;
  } catch (error) {
    log("bookkeeper.owner_notice_failed", "error", {
      shopId: shop.id,
      event: input.what.event,
      error: error instanceof Error ? error.name : "unknown",
    });
    return 0;
  }
}
