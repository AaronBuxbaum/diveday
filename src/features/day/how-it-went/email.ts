import { and, eq, exists, gte, inArray, isNull, sql } from "drizzle-orm";
import type { AppDb, DbExecutor } from "@/db/client";
import { sendNotification } from "@/db/notifications";
import { ownerLogins } from "@/db/owner-logins";
import { people, rollCallEvents, shops, trips, userAccounts } from "@/db/schema";
import { liveTrip, notRehearsal } from "@/db/trips";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { rungOffsetMs } from "@/lib/departure-clock";
import { log } from "@/lib/log";
import {
  type NotificationProvider,
  notificationTripTitle,
  publicAppUrl,
  recipientLocale,
} from "@/lib/notifications/index";
import { shopPath } from "@/lib/staff-notices";

/**
 * **The owner's How it went email** (glossary, "How it went"): one email per
 * departure to each owner who wants it, linking the page. It goes at the first
 * hourly pass once the recap is due (`recap_due`, four hours past the boat's
 * scheduled return), so the counts it links to have had the afternoon to
 * settle.
 *
 * Only a departure somebody counted: one with no roll-call mark at all would
 * link a page saying every count was not taken, which the crew already know.
 * Never a demo shop, a rehearsal or a cancelled departure.
 *
 * The departure is claimed first (`trips.how_it_went_sent_at`, a conditional
 * update, so two passes cannot both send). A pass that reached no owner gives
 * the claim back, so the next pass tries again, and so does one that threw.
 * A departure past the lookback is never sent: a late account of a day the
 * owner has moved on from is noise.
 */
export const HOW_IT_WENT_LOOKBACK_MS = 48 * HOUR_MS;

/**
 * Whether this login wants the email: their own answer, else on. Only an owner
 * may open the page (`canPersonExportIncidentRecord`), so only an owner is
 * asked.
 */
export function howItWentEmailWanted(choice: boolean | null): boolean {
  return choice ?? true;
}

export type HowItWentEmailSummary = {
  checked: number;
  sent: number;
  emails: number;
  released: number;
};

async function claim(db: DbExecutor, tripId: string, now: Date): Promise<boolean> {
  const claimed = await db
    .update(trips)
    .set({ howItWentSentAt: now })
    .where(and(eq(trips.id, tripId), isNull(trips.howItWentSentAt)))
    .returning({ id: trips.id });
  return claimed.length > 0;
}

async function release(db: DbExecutor, tripId: string, claimedAt: Date) {
  await db
    .update(trips)
    .set({ howItWentSentAt: null })
    .where(and(eq(trips.id, tripId), eq(trips.howItWentSentAt, claimedAt)));
}

/** The owners of this shop who want the email: active logins, minus any who turned it off. */
async function wantingOwners(db: DbExecutor, shopId: string) {
  const owners = await ownerLogins(db, shopId);
  if (owners.length === 0) return owners;
  const choices = await db
    .select({ personId: userAccounts.personId, choice: userAccounts.howItWentEmail })
    .from(userAccounts)
    .where(
      inArray(
        userAccounts.personId,
        owners.map((owner) => owner.personId),
      ),
    );
  const off = new Set(
    choices.filter((row) => !howItWentEmailWanted(row.choice)).map((row) => row.personId),
  );
  return owners.filter((owner) => !off.has(owner.personId));
}

export async function sendDueHowItWentEmails(
  db: AppDb,
  input: { now?: Date; origin?: string | null; provider?: NotificationProvider } = {},
): Promise<HowItWentEmailSummary> {
  const now = input.now ?? nowDate();
  const summary: HowItWentEmailSummary = { checked: 0, sent: 0, emails: 0, released: 0 };
  const origin = input.origin === undefined ? publicAppUrl() : input.origin;
  if (!origin) return summary;
  const dueTo = new Date(now.getTime() - rungOffsetMs("recap_due"));
  const dueFrom = new Date(dueTo.getTime() - HOW_IT_WENT_LOOKBACK_MS);
  const due = await db
    .select({
      id: trips.id,
      shopId: trips.shopId,
      title: trips.title,
      startsAt: trips.startsAt,
      slug: shops.slug,
      shopName: shops.name,
      defaultLocale: shops.defaultLocale,
      timezone: shops.timezone,
    })
    .from(trips)
    .innerJoin(shops, eq(shops.id, trips.shopId))
    .where(
      and(
        liveTrip(),
        // A rehearsal sends nothing to anyone (ADR 20261012-rehearsal-departures).
        notRehearsal(),
        eq(trips.status, "scheduled"),
        isNull(trips.howItWentSentAt),
        // Strictly past the rung, as `recapIsDue` reads it.
        sql`${trips.endsAt} < ${dueTo}`,
        gte(trips.endsAt, dueFrom),
        eq(shops.isDemo, false),
        exists(
          // diveday:roll-call-both-subjects: any mark, seat or crew, means somebody counted.
          db
            .select({ one: sql`1` })
            .from(rollCallEvents)
            .where(
              and(eq(rollCallEvents.tripId, trips.id), eq(rollCallEvents.shopId, trips.shopId)),
            ),
        ),
      ),
    );
  summary.checked = due.length;
  let failure: unknown;
  const ownersByShop = new Map<string, Awaited<ReturnType<typeof wantingOwners>>>();
  for (const trip of due) {
    let owners = ownersByShop.get(trip.shopId);
    if (!owners) {
      owners = await wantingOwners(db, trip.shopId);
      ownersByShop.set(trip.shopId, owners);
    }
    if (owners.length === 0) continue;
    if (!(await claim(db, trip.id, now))) continue;
    let reached = 0;
    try {
      for (const owner of owners) {
        const delivery = await sendNotification(
          db,
          {
            kind: "how_it_went",
            shopId: trip.shopId,
            personId: owner.personId,
            tripId: trip.id,
            to: owner.email,
            locale: recipientLocale(owner.locale, trip.defaultLocale),
            recipientName: owner.fullName,
            shopName: trip.shopName,
            tripTitle: notificationTripTitle(trip.title),
            startsAt: trip.startsAt,
            timezone: trip.timezone,
            pageUrl: `${origin}${shopPath(trip.slug, "trips", trip.id, "how-it-went")}`,
            settingsUrl: `${origin}${shopPath(trip.slug, "me", "email")}`,
            sentAt: now,
          },
          input.provider,
        );
        if (delivery.status === "sent") {
          reached += 1;
          summary.emails += 1;
        }
      }
    } catch (error) {
      failure ??= error;
    } finally {
      if (reached === 0) {
        await release(db, trip.id, now);
        summary.released += 1;
      }
    }
    if (reached > 0) summary.sent += 1;
  }
  // Ids and counts only — never a name or an address.
  log("how_it_went_email.pass", "info", summary);
  if (failure !== undefined) throw failure;
  return summary;
}

/** This owner's answer and what it resolves to, for their email settings; null for anyone else. */
export async function readHowItWentEmailChoice(
  db: DbExecutor,
  input: { shopId: string; personId: string },
): Promise<{ wanted: boolean; isDefault: boolean } | null> {
  const owner = (await ownerLogins(db, input.shopId)).find(
    (login) => login.personId === input.personId,
  );
  if (!owner) return null;
  const [row] = await db
    .select({ choice: userAccounts.howItWentEmail })
    .from(userAccounts)
    .where(eq(userAccounts.personId, input.personId))
    .limit(1);
  const choice = row?.choice ?? null;
  return { wanted: howItWentEmailWanted(choice), isDefault: choice === null };
}

/** Records this owner's own answer. Only ever their own row: the caller passes the session. */
export async function setHowItWentEmailChoice(
  db: DbExecutor,
  input: { shopId: string; personId: string; wanted: boolean },
): Promise<boolean> {
  const updated = await db
    .update(userAccounts)
    .set({ howItWentEmail: input.wanted })
    .where(
      and(
        eq(userAccounts.personId, input.personId),
        sql`exists (select 1 from ${people} where ${people.id} = ${userAccounts.personId} and ${people.shopId} = ${input.shopId})`,
      ),
    )
    .returning({ id: userAccounts.id });
  return updated.length > 0;
}
