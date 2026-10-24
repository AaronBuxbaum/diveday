import { and, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { createBearerToken, hashBearerToken } from "@/lib/bearer-tokens";
import { BOOKKEEPER_CONFIRMATION_TTL_MS, bookkeeperMonthOnSet } from "@/lib/bookkeeper";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import { type NotificationProvider, publicAppUrl, recipientLocale } from "@/lib/notifications";
import { shopPath } from "@/lib/staff-notices";
import type { AppDb, DbExecutor } from "./client";
import { sendNotification } from "./notifications";
import { ownerLogins, roleLogins } from "./owner-logins";
import { activityEvents, people, shops } from "./schema";

/**
 * **The bookkeeper's address and the month-end claim** (fifth loop, item 35;
 * ADR 20261016-bookkeeper-month-end-email). The address lives on the shop with
 * who set it and when; nothing is sent to it until the bookkeeper opens the
 * confirm link it receives (`bookkeeper_confirmed_at`, security review B1, on
 * the shore contact's model, H-118); `bookkeeper_sent_month` is the claim the
 * daily pass moves forward before it sends, minting the stop link that
 * month's email carries (second-pass N1).
 */

export type BookkeeperSetting = {
  email: string;
  setAt: Date;
  setByPersonId: string;
  /** The setter's name as the people row holds it today; null when gone. */
  setByName: string | null;
  confirmedAt: Date | null;
  /** The last month-end files to this address bounced (issue #2798); null otherwise. */
  bouncedAt: Date | null;
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
      bouncedAt: shops.bookkeeperBouncedAt,
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
    bouncedAt: row.bouncedAt,
  };
}

/**
 * What a save did: the first address, a different one, the address taken
 * off, the same one saved by someone else (who now stands behind it, and is
 * never silent: second-pass F1), the same one saved again by its setter, or
 * nothing at all (clearing an empty field).
 */
export type BookkeeperChange = "set" | "changed" | "cleared" | "vouched" | "resaved" | "none";

/** The address, its provenance, its confirmation and its claim, empty; the stop link's hash stays. */
const BOOKKEEPER_ADDRESS_CLEARED = {
  bookkeeperEmail: null,
  bookkeeperEmailSetAt: null,
  bookkeeperEmailSetByPersonId: null,
  bookkeeperSentMonth: null,
  bookkeeperConfirmedAt: null,
  bookkeeperConfirmTokenHash: null,
  bookkeeperConfirmExpiresAt: null,
  bookkeeperBouncedAt: null,
} as const;

/** Every bookkeeper column empty, the last email's stop link included. */
export const BOOKKEEPER_CLEARED = {
  ...BOOKKEEPER_ADDRESS_CLEARED,
  bookkeeperStopTokenHash: null,
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
 * who set it and when, and takes back a bounce warning, never the claim or
 * the confirmation; when the
 * saver is not its setter that is `vouched`, decided here under the lock,
 * since it can restart files held because the setter lost access.
 */
export async function setBookkeeper(
  db: AppDb,
  input: { shopId: string; timeZone: string; email: string | null; personId: string; now: Date },
): Promise<{ change: BookkeeperChange; confirmed: boolean }> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        email: shops.bookkeeperEmail,
        confirmedAt: shops.bookkeeperConfirmedAt,
        setByPersonId: shops.bookkeeperEmailSetByPersonId,
      })
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
        // Saving the address again is the owner saying it is right, which is
        // what the bounce notice asks of them (issue #2798).
        .set({
          bookkeeperEmailSetAt: input.now,
          bookkeeperEmailSetByPersonId: input.personId,
          bookkeeperBouncedAt: null,
        })
        .where(eq(shops.id, input.shopId));
      const change = current.setByPersonId === input.personId ? "resaved" : "vouched";
      return { change, confirmed: current.confirmedAt !== null };
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
 * Consumes the link: stamps the address confirmed only while the link is
 * live, so a link whose address was changed (which cleared its hash),
 * replaced, used or expired confirms nothing. The month due at confirmation
 * counts as sent, so the first files are the next 2nd's however long the
 * link waited (second-pass N2), and the owners hear the inbox said yes.
 */
export async function consumeBookkeeperConfirmation(
  db: AppDb,
  input: { token: string; now: Date; origin?: string | null; provider?: NotificationProvider },
): Promise<{ shopId: string } | null> {
  const confirmed = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: shops.id,
        timezone: shops.timezone,
        email: shops.bookkeeperEmail,
        sentMonth: shops.bookkeeperSentMonth,
      })
      .from(shops)
      .where(liveLink(input.token, input.now))
      .for("no key update");
    if (!row?.email) return null;
    const due = bookkeeperMonthOnSet(input.now, row.timezone);
    await tx
      .update(shops)
      .set({
        bookkeeperConfirmedAt: input.now,
        bookkeeperSentMonth: row.sentMonth !== null && row.sentMonth > due ? row.sentMonth : due,
      })
      .where(eq(shops.id, row.id));
    return { shopId: row.id, email: row.email };
  });
  if (!confirmed) return null;
  await tellOwnersAboutBookkeeper(db, {
    shopId: confirmed.shopId,
    what: { event: "confirmed", email: confirmed.email },
    at: input.now,
    ...delivery(input),
  });
  return { shopId: confirmed.shopId };
}

/** The optional origin and provider, passed on only when given. */
function delivery(input: { origin?: string | null; provider?: NotificationProvider }) {
  return {
    ...(input.origin === undefined ? {} : { origin: input.origin }),
    ...(input.provider ? { provider: input.provider } : {}),
  };
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
      stopTokenHash: shops.bookkeeperStopTokenHash,
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
 * still names `email`, confirmed, set by the person the caller checked
 * (second-pass N4), and has not sent that month, in one statement, so two
 * passes at once send it once and an address changed mid-pass is never
 * mailed the old one's files. The winner gets that month's stop link, whose
 * hash replaces the last email's; null when this caller lost.
 */
export async function claimBookkeeperMonth(
  db: DbExecutor,
  input: { shopId: string; email: string; setByPersonId: string; month: string },
): Promise<{ stopToken: string } | null> {
  const stopToken = createBearerToken();
  const claimed = await db
    .update(shops)
    .set({ bookkeeperSentMonth: input.month, bookkeeperStopTokenHash: hashBearerToken(stopToken) })
    .where(
      and(
        eq(shops.id, input.shopId),
        eq(shops.bookkeeperEmail, input.email),
        eq(shops.bookkeeperEmailSetByPersonId, input.setByPersonId),
        isNotNull(shops.bookkeeperConfirmedAt),
        or(isNull(shops.bookkeeperSentMonth), lt(shops.bookkeeperSentMonth, input.month)),
      ),
    )
    .returning({ id: shops.id });
  return claimed.length > 0 ? { stopToken } : null;
}

/**
 * Gives a claimed month back after a send that failed, so the next day's pass
 * tries again, with the stop link of the last email that did go; only while
 * the claim is still this one: the same month, the same address and this
 * claim's own stop link. An address changed mid-send clears the link and may
 * land on the same month, so the month alone would match the new address's
 * row and hand it the old recipient's stop link (third-pass security N1).
 */
export async function releaseBookkeeperMonth(
  db: DbExecutor,
  input: {
    shopId: string;
    month: string;
    /** The address the claim was won for. */
    email: string;
    /** The claim's own stop token, from {@link claimBookkeeperMonth}. */
    stopToken: string;
    previous: string | null;
    previousStopTokenHash: string | null;
  },
): Promise<void> {
  await db
    .update(shops)
    .set({
      bookkeeperSentMonth: input.previous,
      bookkeeperStopTokenHash: input.previousStopTokenHash,
    })
    .where(
      and(
        eq(shops.id, input.shopId),
        eq(shops.bookkeeperSentMonth, input.month),
        eq(shops.bookkeeperEmail, input.email),
        eq(shops.bookkeeperStopTokenHash, hashBearerToken(input.stopToken)),
      ),
    );
}

/** What SES said about a month-end send, as the delivery webhook reads it. */
export type BookkeeperDeliveryOutcome = "bounced" | "delivered";

/**
 * **A month-end send's outcome, on the shop** (issue #2798, security review
 * N2). The webhook matches the send by the shop its tag names and the address
 * SES reports, compared with the address on file, so an outcome for an address
 * since changed or removed changes nothing; no attachment and no address is
 * kept or logged.
 *
 * A permanent bounce (or a suppressed address, which SES reports as one)
 * stamps `bookkeeper_bounced_at` once and tells every owner, naming the last
 * month claimed; a second bounce while it stands tells nobody again. A
 * delivery after the bounce clears it. The pass is untouched either way.
 * Returns what changed.
 */
export async function recordBookkeeperDeliveryOutcome(
  db: AppDb,
  input: {
    shopId: string;
    recipient: string;
    outcome: BookkeeperDeliveryOutcome;
    at: Date;
    origin?: string | null;
    provider?: NotificationProvider;
  },
): Promise<"bounced" | "cleared" | "unchanged"> {
  const sameAddress = and(
    eq(shops.id, input.shopId),
    eq(sql`lower(${shops.bookkeeperEmail})`, input.recipient.trim().toLowerCase()),
  );
  if (input.outcome === "delivered") {
    const cleared = await db
      .update(shops)
      .set({ bookkeeperBouncedAt: null })
      .where(and(sameAddress, lt(shops.bookkeeperBouncedAt, input.at)))
      .returning({ id: shops.id });
    return cleared.length > 0 ? "cleared" : "unchanged";
  }
  const [stamped] = await db
    .update(shops)
    .set({ bookkeeperBouncedAt: input.at })
    .where(and(sameAddress, isNull(shops.bookkeeperBouncedAt)))
    .returning({ email: shops.bookkeeperEmail });
  if (!stamped?.email) return "unchanged";
  // No month: the event does not say which send bounced, and the month on
  // the shop row may already be the next one's claim (security review 3, N2).
  await tellOwnersAboutBookkeeper(db, {
    shopId: input.shopId,
    what: { event: "bounced", email: stamped.email },
    at: input.at,
    ...delivery(input),
  });
  return "bounced";
}

export type BookkeeperStopContext = {
  shopName: string;
  /** The address this link went to is no longer on file. */
  alreadyStopped: boolean;
};

/**
 * Resolves a month-end email's stop link, or null for a token that is not
 * the newest one's (an older email's, or one whose address was changed since).
 */
export async function resolveBookkeeperStopToken(
  db: DbExecutor,
  token: string,
): Promise<BookkeeperStopContext | null> {
  const [row] = await db
    .select({ shopName: shops.name, email: shops.bookkeeperEmail })
    .from(shops)
    .where(eq(shops.bookkeeperStopTokenHash, hashBearerToken(token)))
    .limit(1);
  return row ? { shopName: row.shopName, alreadyStopped: row.email === null } : null;
}

/**
 * **The bookkeeper's own stop** (second-pass N1): clears the address with
 * everything that vouches for it and writes the log's line with no actor, in
 * one transaction, then tells the owners, as the shore contact's stop does
 * (H-118). The hash stays, so a second click reads as stopped. A stale or
 * unknown link changes nothing and sends nothing.
 */
export async function stopBookkeeperByToken(
  db: AppDb,
  input: { token: string; now?: Date; origin?: string | null; provider?: NotificationProvider },
): Promise<BookkeeperStopContext | null> {
  const now = input.now ?? nowDate();
  const stopped = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: shops.id, name: shops.name, email: shops.bookkeeperEmail })
      .from(shops)
      .where(
        and(
          eq(shops.bookkeeperStopTokenHash, hashBearerToken(input.token)),
          isNotNull(shops.bookkeeperEmail),
        ),
      )
      .for("no key update");
    if (!row?.email) return null;
    await tx.update(shops).set(BOOKKEEPER_ADDRESS_CLEARED).where(eq(shops.id, row.id));
    await tx.insert(activityEvents).values({
      shopId: row.id,
      actorPersonId: null,
      systemReason: "bookkeeper_stopped",
      code: "bookkeeper_email_stopped",
      params: {},
      occurredAt: now,
    });
    return { id: row.id, name: row.name, email: row.email };
  });
  if (!stopped) return resolveBookkeeperStopToken(db, input.token);
  await tellOwnersAboutBookkeeper(db, {
    shopId: stopped.id,
    what: { event: "cleared", by: "recipient", email: stopped.email },
    at: now,
    ...delivery(input),
  });
  return { shopName: stopped.name, alreadyStopped: false };
}

/** What the owners are told about the bookkeeper's address. */
export type BookkeeperOwnerEvent =
  | { event: "set" | "changed" | "vouched"; email: string; actorName: string }
  | { event: "cleared"; actorName: string }
  | { event: "cleared"; by: "recipient"; email: string }
  | { event: "cleared"; by: "erasure" }
  | { event: "confirmed"; email: string }
  | { event: "sent"; email: string; month: string }
  | { event: "bounced"; email: string };

export type BookkeeperNoticeRecipient = {
  personId: string | null;
  fullName: string | null;
  email: string;
  locale: string | null;
};

/**
 * Who hears about the address: every owner with an active login; in a shop
 * none of whose owners can sign in, every manager with one except whoever
 * acted; and failing both, the shop's own confirmed contact address
 * (second-pass N5), so a shop run by managers is not told nothing.
 */
export async function bookkeeperNoticeRecipients(
  db: DbExecutor,
  input: { shopId: string; actorPersonId?: string | null },
): Promise<BookkeeperNoticeRecipient[]> {
  const owners = await ownerLogins(db, input.shopId);
  if (owners.length > 0) return owners;
  const managers = (await roleLogins(db, input.shopId, "manager")).filter(
    (manager) => manager.personId !== input.actorPersonId,
  );
  if (managers.length > 0) return managers;
  const [shop] = await db
    .select({ email: shops.contactEmail, confirmedAt: shops.contactEmailConfirmedAt })
    .from(shops)
    .where(eq(shops.id, input.shopId))
    .limit(1);
  if (!shop?.email || !shop.confirmedAt) return [];
  return [{ personId: null, fullName: null, email: shop.email, locale: null }];
}

/**
 * One email to each of `bookkeeperNoticeRecipients` (security review B1 and
 * F1, second pass): when the address is set, changed, vouched for, confirmed
 * or removed, on every month-end send, and when one bounces (issue #2798), so
 * an address nobody meant to keep shows up in an owner's inbox rather than at
 * the bottom of a Reports month.
 * Never throws: the act it reports already happened. A demo shop sends
 * nothing. Returns how many went.
 */
export async function tellOwnersAboutBookkeeper(
  db: AppDb,
  input: {
    shopId: string;
    what: BookkeeperOwnerEvent;
    at: Date;
    /** Who acted, left out of the managers' fallback. */
    actorPersonId?: string | null;
    origin?: string | null;
    provider?: NotificationProvider;
  },
): Promise<number> {
  const origin = input.origin === undefined ? publicAppUrl() : input.origin;
  if (!origin) return 0;
  try {
    const [shop] = await db
      .select({
        name: shops.name,
        slug: shops.slug,
        defaultLocale: shops.defaultLocale,
        isDemo: shops.isDemo,
      })
      .from(shops)
      .where(eq(shops.id, input.shopId))
      .limit(1);
    if (!shop || shop.isDemo) return 0;
    const recipients = await bookkeeperNoticeRecipients(db, {
      shopId: input.shopId,
      actorPersonId: input.actorPersonId ?? null,
    });
    let sent = 0;
    for (const recipient of recipients) {
      const delivery = await sendNotification(
        db,
        {
          kind: "bookkeeper_notice",
          shopId: input.shopId,
          personId: recipient.personId,
          to: recipient.email,
          locale: recipientLocale(recipient.locale, shop.defaultLocale),
          recipientName: recipient.fullName,
          shopName: shop.name,
          reportsUrl: `${origin}${shopPath(shop.slug, "settings", "bookkeeper")}`,
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
      shopId: input.shopId,
      event: input.what.event,
      error: error instanceof Error ? error.name : "unknown",
    });
    return 0;
  }
}
