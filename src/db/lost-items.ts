import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { diverTranslator } from "@/i18n/messages";
import { nowDate } from "@/lib/clock";
import { containsLink } from "@/lib/departure-notes";
import { type NotificationProvider, recipientLocale } from "@/lib/notifications";
import { type CourtesyProvider, sendCourtesyMessage } from "@/lib/notifications/courtesy";
import { lostItemText } from "@/lib/notifications/desk-notes";
import {
  type SmsProvider,
  smsProviderFromEnvironment,
  smsRecipient,
} from "@/lib/notifications/sms";
import type { AppDb, DbExecutor } from "./client";
import { notificationProviderForDb, sendNotification } from "./notifications";
import { bookings, type LostItem, lostItems, people, shops, trips } from "./schema";
import { stopListedSmsProvider } from "./sms-opt-outs";
import { liveTrip, notRehearsal } from "./trips";
import { whatsAppProvidersForShops } from "./whatsapp-accounts";

/**
 * **Lost and found** (batch 4, J2): what the crew finds aboard after a
 * departure, recorded from the Boat tab, optionally tied to the seat it was
 * found at, and listed for the shop until it goes home or is discarded. One
 * tap tells the seat's diver by their usual channel — email when they have an
 * address, otherwise the shop's WhatsApp or platform SMS
 * (`src/lib/notifications/courtesy.ts`).
 *
 * Every read and write is scoped by the shop; a booking named from a form is
 * only accepted when it is on that departure of that shop.
 */

/** The longest description, matching the table's check. */
export const LOST_ITEM_DESCRIPTION_MAX = 120;

export type LostItemDescriptionProblem = "empty" | "too_long" | "link";

/**
 * Why a description may not be recorded as written. A link is refused like
 * a departure note's: the description is quoted in the message to the diver,
 * so it is held to what that message may carry.
 */
export function lostItemDescriptionProblem(raw: string): LostItemDescriptionProblem | null {
  const description = raw.replace(/\s+/g, " ").trim();
  if (description.length === 0) return "empty";
  if (description.length > LOST_ITEM_DESCRIPTION_MAX) return "too_long";
  if (containsLink(description)) return "link";
  return null;
}

export type RecordLostItemOutcome =
  | { ok: true; item: LostItem }
  | { ok: false; reason: LostItemDescriptionProblem | "not_found" | "seat_not_on_trip" };

export async function recordLostItem(
  db: DbExecutor,
  input: {
    shopId: string;
    tripId: string;
    description: string;
    bookingId?: string | null;
    actorPersonId: string | null;
  },
): Promise<RecordLostItemOutcome> {
  const problem = lostItemDescriptionProblem(input.description);
  if (problem) return { ok: false, reason: problem };
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
    .limit(1);
  if (!trip) return { ok: false, reason: "not_found" };

  let personId: string | null = null;
  if (input.bookingId) {
    const [seat] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(
        and(
          eq(bookings.id, input.bookingId),
          eq(bookings.shopId, input.shopId),
          eq(bookings.tripId, trip.id),
        ),
      )
      .limit(1);
    if (!seat) return { ok: false, reason: "seat_not_on_trip" };
    personId = seat.personId;
  }

  const [item] = await db
    .insert(lostItems)
    .values({
      shopId: input.shopId,
      tripId: trip.id,
      bookingId: personId ? (input.bookingId ?? null) : null,
      personId,
      description: input.description.replace(/\s+/g, " ").trim(),
      recordedByPersonId: input.actorPersonId,
    })
    .returning();
  if (!item) throw new Error("lost item was not written");
  return { ok: true, item };
}

export type LostItemResolution = "open" | "returned" | "discarded";

/** Mark an item returned or discarded, or put it back on the open list. */
export async function setLostItemStatus(
  db: DbExecutor,
  input: {
    shopId: string;
    itemId: string;
    status: LostItemResolution;
    actorPersonId: string | null;
  },
): Promise<boolean> {
  const now = nowDate();
  const resolved = input.status !== "open";
  const rows = await db
    .update(lostItems)
    .set({
      status: input.status,
      resolvedAt: resolved ? now : null,
      resolvedByPersonId: resolved ? input.actorPersonId : null,
      updatedAt: now,
    })
    .where(and(eq(lostItems.id, input.itemId), eq(lostItems.shopId, input.shopId)))
    .returning({ id: lostItems.id });
  return rows.length > 0;
}

export type TellLostItemProviders = {
  emailProvider?: NotificationProvider;
  smsProvider?: SmsProvider;
  whatsAppProviders?: Map<string, CourtesyProvider>;
};

export type TellLostItemOutcome =
  | { ok: true; channel: "email" | "sms" | "whatsapp" }
  | {
      ok: false;
      reason: "not_found" | "not_open" | "no_owner" | "already_told" | "no_contact" | "failed";
    };

/**
 * Tell the item's owner it was found. Once per item: a second tap is refused
 * rather than sent again, so a list of open items is never a way to message a
 * diver twice.
 */
export async function tellLostItemOwner(
  db: AppDb,
  input: { shopId: string; itemId: string },
  providers: TellLostItemProviders = {},
): Promise<TellLostItemOutcome> {
  const [row] = await db
    .select({ item: lostItems, trip: trips, shop: shops })
    .from(lostItems)
    .innerJoin(
      trips,
      and(
        eq(trips.id, lostItems.tripId),
        eq(trips.shopId, input.shopId),
        liveTrip(),
        notRehearsal(),
      ),
    )
    .innerJoin(shops, eq(shops.id, lostItems.shopId))
    .where(and(eq(lostItems.id, input.itemId), eq(lostItems.shopId, input.shopId)))
    .limit(1);
  if (!row) return { ok: false, reason: "not_found" };
  const { item, trip, shop } = row;
  if (item.status !== "open") return { ok: false, reason: "not_open" };
  if (!item.personId) return { ok: false, reason: "no_owner" };
  if (item.toldAt) return { ok: false, reason: "already_told" };
  const [person] = await db
    .select()
    .from(people)
    .where(and(eq(people.id, item.personId), eq(people.shopId, shop.id), isNull(people.deletedAt)))
    .limit(1);
  if (!person) return { ok: false, reason: "no_owner" };

  const phone = person.email ? null : smsRecipient(person.phone);
  if (!person.email && !phone) return { ok: false, reason: "no_contact" };

  // Claim the tell before anything is sent: of two taps racing, one row comes
  // back and the other is `already_told` without a message going out.
  const toldAt = nowDate();
  const [claim] = await db
    .update(lostItems)
    .set({ toldAt, updatedAt: toldAt })
    .where(
      and(
        eq(lostItems.id, item.id),
        eq(lostItems.shopId, shop.id),
        eq(lostItems.status, "open"),
        isNull(lostItems.toldAt),
      ),
    )
    .returning({ id: lostItems.id });
  if (!claim) return { ok: false, reason: "already_told" };
  // A message that did not go gives the claim back, so the crew can tap again.
  const release = async (): Promise<TellLostItemOutcome> => {
    await db
      .update(lostItems)
      .set({ toldAt: null, toldChannel: null })
      .where(and(eq(lostItems.id, item.id), eq(lostItems.shopId, shop.id)));
    return { ok: false, reason: "failed" };
  };

  const locale = recipientLocale(person.locale, shop.defaultLocale);
  let channel: "email" | "sms" | "whatsapp";
  try {
    if (person.email) {
      const delivery = await sendNotification(
        db,
        {
          kind: "lost_item_found",
          itemId: item.id,
          shopId: shop.id,
          to: person.email,
          locale,
          diverName: person.fullName,
          shopName: shop.name,
          tripTitle: trip.title,
          startsAt: trip.startsAt,
          timezone: shop.timezone,
          description: item.description,
          toldAt,
        },
        notificationProviderForDb(providers.emailProvider),
      );
      if (delivery.status !== "sent") return await release();
      channel = "email";
    } else if (phone) {
      const senders =
        providers.whatsAppProviders ?? (await whatsAppProvidersForShops(db, [shop.id]));
      const sms = stopListedSmsProvider(db, providers.smsProvider ?? smsProviderFromEnvironment());
      const t = diverTranslator(locale);
      const sent = await sendCourtesyMessage(
        {
          to: phone,
          body: lostItemText({
            locale,
            shopName: shop.name,
            tripTitle: trip.title,
            description: item.description,
          }),
          smsStopLine: t("notifications.sms.stopLine"),
          shopName: shop.name,
        },
        { sms, whatsapp: senders.get(shop.id) ?? null },
      );
      if (sent.delivery.status !== "sent") return await release();
      channel = sent.channel;
    } else {
      return await release();
    }
  } catch (error) {
    await release();
    throw error;
  }

  await db
    .update(lostItems)
    .set({ toldChannel: channel })
    .where(and(eq(lostItems.id, item.id), eq(lostItems.shopId, shop.id)));
  return { ok: true, channel };
}

const owner = alias(people, "lost_item_owner");

const itemColumns = {
  id: lostItems.id,
  tripId: lostItems.tripId,
  bookingId: lostItems.bookingId,
  description: lostItems.description,
  status: lostItems.status,
  toldAt: lostItems.toldAt,
  toldChannel: lostItems.toldChannel,
  createdAt: lostItems.createdAt,
  ownerName: owner.fullName,
};

/** Everything recorded on one departure, newest first, for its Boat tab. */
export async function listTripLostItems(db: DbExecutor, shopId: string, tripId: string) {
  return db
    .select(itemColumns)
    .from(lostItems)
    .leftJoin(owner, and(eq(owner.id, lostItems.personId), isNull(owner.deletedAt)))
    .where(and(eq(lostItems.shopId, shopId), eq(lostItems.tripId, tripId)))
    .orderBy(desc(lostItems.createdAt));
}

export type TripLostItem = Awaited<ReturnType<typeof listTripLostItems>>[number];

/** The shop's open items across every departure, newest first. */
export async function listOpenLostItems(db: DbExecutor, shopId: string) {
  return db
    .select({ ...itemColumns, tripTitle: trips.title, tripStartsAt: trips.startsAt })
    .from(lostItems)
    .innerJoin(trips, and(eq(trips.id, lostItems.tripId), liveTrip()))
    .leftJoin(owner, and(eq(owner.id, lostItems.personId), isNull(owner.deletedAt)))
    .where(and(eq(lostItems.shopId, shopId), eq(lostItems.status, "open")))
    .orderBy(desc(lostItems.createdAt))
    .limit(200);
}

export type OpenLostItem = Awaited<ReturnType<typeof listOpenLostItems>>[number];

/**
 * **What is waiting for each of these people** (fifth loop, item 7): their
 * open items, oldest first, keyed by person, so the check-in row and the
 * diver's record can say "Has a blue mask in lost and found" on the visit it
 * can be handed over. Only items the crew tied to a seat have a person.
 */
export async function openLostItemsByPerson(
  db: DbExecutor,
  shopId: string,
  personIds: readonly string[],
): Promise<Map<string, string[]>> {
  const byPerson = new Map<string, string[]>();
  if (personIds.length === 0) return byPerson;
  const rows = await db
    .select({ personId: lostItems.personId, description: lostItems.description })
    .from(lostItems)
    .innerJoin(trips, and(eq(trips.id, lostItems.tripId), liveTrip()))
    .where(
      and(
        eq(lostItems.shopId, shopId),
        eq(lostItems.status, "open"),
        inArray(lostItems.personId, [...new Set(personIds)]),
      ),
    )
    .orderBy(lostItems.createdAt, lostItems.description, lostItems.id);
  for (const row of rows) {
    if (!row.personId) continue;
    const list = byPerson.get(row.personId) ?? [];
    list.push(row.description);
    byPerson.set(row.personId, list);
  }
  return byPerson;
}

/** How many found items are still waiting to go home (Today's row, fifth loop item 7). */
export async function countOpenLostItems(db: DbExecutor, shopId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(lostItems)
    .innerJoin(trips, and(eq(trips.id, lostItems.tripId), liveTrip()))
    .where(and(eq(lostItems.shopId, shopId), eq(lostItems.status, "open")));
  return row?.n ?? 0;
}
