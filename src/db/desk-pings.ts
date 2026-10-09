import { and, countDistinct, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { isStaff, type Role } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import {
  AFTER_HOURS_PING_INTERVAL_MS,
  afterHoursPingWanted,
  type DeskHours,
  deskClosedSince,
  isAfterHours,
} from "@/lib/desk-hours";
import { log } from "@/lib/log";
import { type NotificationProvider, publicAppUrl, recipientLocale } from "@/lib/notifications";
import { shopPath } from "@/lib/staff-notices";
import type { AppDb, DbExecutor } from "./client";
import { sendNotification } from "./notifications";
import { inboundMessages, people, personRoles, shops, userAccounts } from "./schema";

/**
 * **The after-hours desk ping's reads, writes and one send path** (D4, Aaron
 * 2026-10-09). The rule is `src/lib/desk-hours.ts`; the words are
 * `src/lib/notifications/desk-emails.ts`.
 *
 * Called by the two inbound webhooks (email and WhatsApp) once a message is
 * actually filed — never on a redelivery — and never allowed to fail the
 * webhook: a mail problem must not make a provider retry a message that is
 * already in the Inbox.
 */

type StaffLogin = {
  accountId: string;
  personId: string;
  fullName: string;
  email: string;
  locale: string | null;
  roles: Role[];
  choice: boolean | null;
};

/** Every active staff login at this shop, with their roles and their own answer. */
async function staffLogins(db: DbExecutor, shopId: string): Promise<StaffLogin[]> {
  const rows = await db
    .select({
      accountId: userAccounts.id,
      personId: people.id,
      fullName: people.fullName,
      email: userAccounts.email,
      locale: people.locale,
      choice: userAccounts.afterHoursPing,
      role: personRoles.role,
    })
    .from(userAccounts)
    .innerJoin(people, eq(people.id, userAccounts.personId))
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        eq(userAccounts.status, "active"),
      ),
    );
  const byPerson = new Map<string, StaffLogin>();
  for (const row of rows) {
    const existing = byPerson.get(row.personId);
    if (existing) {
      existing.roles.push(row.role as Role);
      continue;
    }
    const { role, ...rest } = row;
    byPerson.set(row.personId, { ...rest, roles: [role as Role] });
  }
  return [...byPerson.values()].filter((person) => isStaff(person.roles));
}

/**
 * How many divers have written in since the desk closed and are still waiting:
 * distinct senders of live, unanswered messages received at or after `since`.
 * Senders rather than messages, because three texts from one diver are one
 * person waiting.
 */
export async function countWaitingSince(
  db: DbExecutor,
  shopId: string,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ value: countDistinct(inboundMessages.fromAddress) })
    .from(inboundMessages)
    .where(
      and(
        eq(inboundMessages.shopId, shopId),
        isNull(inboundMessages.deletedAt),
        isNull(inboundMessages.answeredAt),
        gte(inboundMessages.receivedAt, since),
      ),
    );
  return row?.value ?? 0;
}

/**
 * Take this person's batching clock, or learn it is not theirs to take yet.
 * One conditional update, so two messages landing together cannot both send.
 */
async function claimPing(db: DbExecutor, accountId: string, now: Date): Promise<boolean> {
  const cutoff = new Date(now.getTime() - AFTER_HOURS_PING_INTERVAL_MS);
  const claimed = await db
    .update(userAccounts)
    .set({ afterHoursPingedAt: now })
    .where(
      and(
        eq(userAccounts.id, accountId),
        or(isNull(userAccounts.afterHoursPingedAt), lte(userAccounts.afterHoursPingedAt, cutoff)),
      ),
    )
    .returning({ id: userAccounts.id });
  return claimed.length > 0;
}

/** Give a claim back after a send that did not go, unless a later claim took it since. */
async function releasePing(db: DbExecutor, accountId: string, claimedAt: Date): Promise<void> {
  await db
    .update(userAccounts)
    .set({ afterHoursPingedAt: null })
    .where(and(eq(userAccounts.id, accountId), eq(userAccounts.afterHoursPingedAt, claimedAt)));
}

export type DeskPingOutcome =
  | { status: "in_hours" | "demo" | "no_origin" | "no_shop" | "nobody_waiting" }
  | { status: "pinged"; sent: number; failed: number; batched: number };

/**
 * A diver message was just filed at `receivedAt`: if the desk is closed, ping
 * every staffer who wants it and whose batching clock has run out.
 *
 * Both the message's time and now must be after hours. A message that sat in
 * a provider's retry queue overnight and lands at 09:00 is already in front of
 * whoever opened the Inbox.
 */
export async function pingDeskAfterHours(
  db: AppDb,
  input: {
    shopId: string;
    receivedAt: Date;
    now?: Date;
    origin?: string | null;
    provider?: NotificationProvider;
  },
): Promise<DeskPingOutcome> {
  const now = input.now ?? nowDate();
  const [shop] = await db
    .select({
      id: shops.id,
      slug: shops.slug,
      name: shops.name,
      timezone: shops.timezone,
      defaultLocale: shops.defaultLocale,
      isDemo: shops.isDemo,
      opensMinute: shops.deskOpensMinute,
      closesMinute: shops.deskClosesMinute,
    })
    .from(shops)
    .where(eq(shops.id, input.shopId))
    .limit(1);
  if (!shop) return { status: "no_shop" };
  const hours: DeskHours = { opensMinute: shop.opensMinute, closesMinute: shop.closesMinute };
  if (
    !isAfterHours(input.receivedAt, shop.timezone, hours) ||
    !isAfterHours(now, shop.timezone, hours)
  ) {
    return { status: "in_hours" };
  }
  // A demo shop's "divers" are seeded, and its staff addresses are anybody's.
  if (shop.isDemo) return { status: "demo" };
  const origin = input.origin === undefined ? publicAppUrl() : input.origin;
  if (!origin) return { status: "no_origin" };

  const waiting = await countWaitingSince(db, shop.id, deskClosedSince(now, shop.timezone, hours));
  if (waiting === 0) return { status: "nobody_waiting" };

  const outcome = { status: "pinged" as const, sent: 0, failed: 0, batched: 0 };
  const recipients = (await staffLogins(db, shop.id)).filter((person) =>
    afterHoursPingWanted(person.choice, person.roles),
  );
  for (const person of recipients) {
    if (!(await claimPing(db, person.accountId, now))) {
      outcome.batched += 1;
      continue;
    }
    const delivery = await sendNotification(
      db,
      {
        kind: "desk_after_hours",
        shopId: shop.id,
        personId: person.personId,
        to: person.email,
        // Staff mail in the staffer's own recorded language, else the shop's.
        locale: recipientLocale(person.locale, shop.defaultLocale),
        recipientName: person.fullName,
        shopName: shop.name,
        waiting,
        inboxUrl: `${origin}${shopPath(shop.slug, "inbox")}`,
        settingsUrl: `${origin}${shopPath(shop.slug, "settings", "email")}`,
        pingedAt: now,
      },
      input.provider,
    );
    if (delivery.status === "sent") {
      outcome.sent += 1;
    } else {
      outcome.failed += 1;
      // Not sent, so not a ping: the next message may try again at once.
      await releasePing(db, person.accountId, now);
    }
  }
  // Ids and counts only — never an address, a name, or a word of a message.
  log("desk_ping.after_hours", "info", {
    shopId: shop.id,
    waiting,
    sent: outcome.sent,
    failed: outcome.failed,
    batched: outcome.batched,
  });
  return outcome;
}

/**
 * The webhook's call: `pingDeskAfterHours`, with every throw caught and logged.
 * The message is already filed by the time this runs, so the webhook answers
 * 200 whatever becomes of the ping.
 */
export async function pingDeskAfterHoursSafely(
  db: AppDb,
  input: { shopId: string; receivedAt: Date },
): Promise<void> {
  try {
    await pingDeskAfterHours(db, input);
  } catch (error) {
    log("desk_ping.failed", "error", {
      shopId: input.shopId,
      errorCode: error instanceof Error ? error.name : "unknown_error",
    });
  }
}

/** This staffer's answer and what it resolves to, for their email settings. */
export async function readAfterHoursPingChoice(
  db: DbExecutor,
  input: { shopId: string; personId: string },
): Promise<{ wanted: boolean; isDefault: boolean } | null> {
  const person = (await staffLogins(db, input.shopId)).find(
    (login) => login.personId === input.personId,
  );
  if (!person) return null;
  return {
    wanted: afterHoursPingWanted(person.choice, person.roles),
    isDefault: person.choice === null,
  };
}

/** Records this staffer's own answer. Only ever their own row: the caller passes the session. */
export async function setAfterHoursPingChoice(
  db: DbExecutor,
  input: { shopId: string; personId: string; wanted: boolean },
): Promise<boolean> {
  const updated = await db
    .update(userAccounts)
    .set({ afterHoursPing: input.wanted })
    .where(
      and(
        eq(userAccounts.personId, input.personId),
        sql`exists (select 1 from ${people} where ${people.id} = ${userAccounts.personId} and ${people.shopId} = ${input.shopId})`,
      ),
    )
    .returning({ id: userAccounts.id });
  return updated.length > 0;
}

/** The shop's desk hours, already validated by `parseDeskHours`. */
export async function setShopDeskHours(
  db: DbExecutor,
  shopId: string,
  hours: DeskHours,
): Promise<void> {
  await db
    .update(shops)
    .set({ deskOpensMinute: hours.opensMinute, deskClosesMinute: hours.closesMinute })
    .where(eq(shops.id, shopId));
}
