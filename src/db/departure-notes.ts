import { and, asc, count, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { diverTranslator } from "@/i18n/messages";
import { readinessLinkPath } from "@/lib/booking-capabilities";
import { nowDate } from "@/lib/clock";
import {
  DEPARTURE_NOTES_PER_DEPARTURE,
  type DepartureNoteBlock,
  type DepartureNoteProblem,
  departureNoteBlock,
  departureNoteProblem,
  foldDepartureNote,
} from "@/lib/departure-notes";
import { log } from "@/lib/log";
import { type NotificationProvider, publicAppUrl, recipientLocale } from "@/lib/notifications";
import { type CourtesyProvider, sendCourtesyMessage } from "@/lib/notifications/courtesy";
import { departureNoteText } from "@/lib/notifications/desk-notes";
import {
  type SmsProvider,
  smsProviderFromEnvironment,
  smsRecipient,
} from "@/lib/notifications/sms";
import { type IssuedCapability, issueBookingCapabilities } from "./booking-capabilities";
import type { AppDb, DbExecutor } from "./client";
import { notificationProviderForDb, sendNotificationBatch } from "./notifications";
import { recordTripActivity } from "./operations";
import {
  bookings,
  departureNotes,
  heldSends,
  lostItems,
  people,
  shops,
  tripScheduleDays,
  trips,
} from "./schema";
import { stopListedSmsProvider } from "./sms-opt-outs";
import { liveTrip, notRehearsal } from "./trips";
import { seatHeld } from "./trips-queries";
import { whatsAppProvidersForShops } from "./whatsapp-accounts";

/**
 * **A note to everyone on a departure** (batch 4, J4): the consequence path
 * behind the trip page's "Note to everyone". The tap holds the send for the
 * same eight seconds every held send gets (`src/db/held-sends.ts`, ADR
 * 20260906-before-you-ask), and `sendDepartureNote` is what runs when the hold
 * drains — so everything is checked twice: at the hold, and again here, where
 * a departure cancelled or sailed during the hold is refused and nobody is
 * messaged.
 *
 * One message per held seat, by that diver's usual channel: email when they
 * have an address, otherwise a text over the shop's own WhatsApp or platform
 * SMS (`src/lib/notifications/courtesy.ts`). Transactional, so a diver who
 * turned optional email off still hears where to park.
 */

export type DepartureNoteRefusal = DepartureNoteProblem | DepartureNoteBlock | "not_found";

export type DepartureNoteCheck =
  | { ok: true; body: string; trip: typeof trips.$inferSelect }
  | { ok: false; reason: DepartureNoteRefusal };

/** How many notes this departure has carried. */
export async function departureNotesSent(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: count(departureNotes.id) })
    .from(departureNotes)
    .where(and(eq(departureNotes.shopId, shopId), eq(departureNotes.tripId, tripId)));
  return row?.n ?? 0;
}

/** How many seats a note to this departure would reach now. */
export async function departureNoteAudience(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: count(bookings.id) })
    .from(bookings)
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, shopId)))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripId),
        seatHeld,
        isNull(people.deletedAt),
      ),
    );
  return row?.n ?? 0;
}

/** Notes to this departure still inside their hold, not yet sent or undone. */
export async function departureNotesHeld(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: count(heldSends.id) })
    .from(heldSends)
    .where(
      and(
        eq(heldSends.shopId, shopId),
        eq(heldSends.kind, "departure_note"),
        sql`${heldSends.payload}->>'tripId' = ${tripId}`,
      ),
    );
  return row?.n ?? 0;
}

/**
 * When the departure's last day starts, or null for a one-day departure's lone
 * row (its start is the trip's own). A multi-day course takes notes until this
 * day sails, not its first (#2393).
 */
export async function lastDayStartsAt(db: DbExecutor, tripId: string): Promise<Date | null> {
  const [day] = await db
    .select({ startsAt: tripScheduleDays.startsAt })
    .from(tripScheduleDays)
    .where(eq(tripScheduleDays.tripId, tripId))
    .orderBy(desc(tripScheduleDays.startsAt))
    .limit(1);
  return day?.startsAt ?? null;
}

/**
 * The day a note sent `now` is about: the first of the departure's days not
 * yet over, so a note sent on day three of a course is dated day three, not
 * day one. Null when the departure has no day rows; the trip's own start
 * stands then.
 */
export async function dayStillToComeStartsAt(
  db: DbExecutor,
  tripId: string,
  now: Date,
): Promise<Date | null> {
  const [day] = await db
    .select({ startsAt: tripScheduleDays.startsAt })
    .from(tripScheduleDays)
    .where(and(eq(tripScheduleDays.tripId, tripId), gt(tripScheduleDays.endsAt, now)))
    .orderBy(asc(tripScheduleDays.startsAt))
    .limit(1);
  return day?.startsAt ?? null;
}

/**
 * Whether this note may go to this departure now; the one check the hold and
 * the send share. `countHeld` is the hold's: a note still inside its eight
 * seconds counts against the cap, so a fourth tap is refused at the box
 * rather than when the hold drains. The send itself counts only what was sent
 * (its own held row is already claimed by then).
 */
export async function checkDepartureNote(
  db: DbExecutor,
  input: { shopId: string; tripId: string; body: string; now?: Date; countHeld?: boolean },
): Promise<DepartureNoteCheck> {
  const problem = departureNoteProblem(input.body);
  if (problem) return { ok: false, reason: problem };
  const [trip] = await db
    .select()
    .from(trips)
    .where(
      and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip(), notRehearsal()),
    )
    .limit(1);
  if (!trip) return { ok: false, reason: "not_found" };
  const sent =
    (await departureNotesSent(db, input.shopId, input.tripId)) +
    (input.countHeld ? await departureNotesHeld(db, input.shopId, input.tripId) : 0);
  const block = departureNoteBlock(
    { ...trip, lastDayStartsAt: await lastDayStartsAt(db, trip.id) },
    sent,
    input.now ?? nowDate(),
  );
  if (block) return { ok: false, reason: block };
  return { ok: true, body: foldDepartureNote(input.body), trip };
}

export type DepartureNoteProviders = {
  emailProvider?: NotificationProvider;
  smsProvider?: SmsProvider;
  whatsAppProviders?: Map<string, CourtesyProvider>;
};

export type SendDepartureNoteOutcome =
  | { ok: true; noteId: string; recipients: number; delivered: number }
  | { ok: false; reason: DepartureNoteRefusal };

/**
 * Check the note and write its row in one transaction, under the same
 * `FOR UPDATE` on the departure that `createBooking` takes, so two sends
 * racing for the last of the cap serialize. The insert is conditional on the
 * count as well: on a single connection (PGlite) the lock cannot exhibit the
 * race, and the one statement still cannot pass the cap. Nothing leaves the
 * building inside the transaction; the messages go after it commits.
 */
async function claimDepartureNote(
  db: AppDb,
  input: { shopId: string; tripId: string; body: string; actorPersonId: string | null },
) {
  return db.transaction(async (tx) => {
    const problem = departureNoteProblem(input.body);
    if (problem) return { ok: false as const, reason: problem };
    const [trip] = await tx
      .select()
      .from(trips)
      .where(
        and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip(), notRehearsal()),
      )
      .limit(1)
      .for("update");
    if (!trip) return { ok: false as const, reason: "not_found" as const };
    const now = nowDate();
    const block = departureNoteBlock(
      { ...trip, lastDayStartsAt: await lastDayStartsAt(tx, trip.id) },
      await departureNotesSent(tx, input.shopId, trip.id),
      now,
    );
    if (block) return { ok: false as const, reason: block };
    const body = foldDepartureNote(input.body);
    const seats = await tx
      .select({ booking: bookings, person: people })
      .from(bookings)
      .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, input.shopId)))
      .where(
        and(
          eq(bookings.shopId, input.shopId),
          eq(bookings.tripId, trip.id),
          seatHeld,
          isNull(people.deletedAt),
        ),
      );
    const inserted = await tx.execute(sql`
      insert into departure_notes (shop_id, trip_id, body, sent_by_person_id, recipients, sent_at)
      select ${input.shopId}::uuid, ${trip.id}::uuid, ${body}, ${input.actorPersonId}::uuid,
        ${seats.length}, ${now.toISOString()}::timestamptz
      where (
        select count(*) from departure_notes
        where shop_id = ${input.shopId}::uuid and trip_id = ${trip.id}::uuid
      ) < ${DEPARTURE_NOTES_PER_DEPARTURE}
      returning id`);
    const note = (inserted.rows as { id: string }[])[0];
    if (!note) return { ok: false as const, reason: "limit" as const };
    const dayStartsAt = (await dayStillToComeStartsAt(tx, trip.id, now)) ?? trip.startsAt;
    return { ok: true as const, trip, body, seats, note, dayStartsAt };
  });
}

/** Send one checked note to every held seat on the departure, and record it. */
export async function sendDepartureNote(
  db: AppDb,
  input: { shopId: string; tripId: string; body: string; actorPersonId: string | null },
  providers: DepartureNoteProviders = {},
): Promise<SendDepartureNoteOutcome> {
  const [shop] = await db.select().from(shops).where(eq(shops.id, input.shopId)).limit(1);
  if (!shop) return { ok: false, reason: "not_found" };
  const claimed = await claimDepartureNote(db, input);
  if (!claimed.ok) return claimed;
  const { trip, body, seats, note, dayStartsAt } = claimed;

  const origin = publicAppUrl();
  const emailProvider = notificationProviderForDb(providers.emailProvider);
  const senders = providers.whatsAppProviders ?? (await whatsAppProvidersForShops(db, [shop.id]));
  const sms = stopListedSmsProvider(db, providers.smsProvider ?? smsProviderFromEnvironment());

  // **One insert for every seat's link, then the sends** (code review
  // 2026-10-13, item 35). A 20-seat note used to mint its links one seat at a
  // time inside the send loop, about sixty serial round trips before the last
  // diver heard. A failed mint costs the links, never the note: the message
  // still goes, without the readiness link, as it does with no public origin.
  let links = new Map<string, IssuedCapability>();
  if (origin) {
    try {
      links = await issueBookingCapabilities(db, {
        shopId: shop.id,
        bookingIds: seats.map(({ booking }) => booking.id),
        purpose: "readiness",
      });
    } catch (error) {
      log("departure_note.links_failed", "error", {
        noteId: note.id,
        errorCode: error instanceof Error ? error.name : "unknown_error",
      });
    }
  }
  const readinessUrlFor = (bookingId: string) => {
    const capability = links.get(bookingId);
    return origin && capability
      ? new URL(readinessLinkPath(capability.token), `${origin}/`).toString()
      : undefined;
  };

  let delivered = 0;
  // Email first, as one batch through the queue's own fan-out
  // (`sendNotificationBatch`), which holds a rehearsal, refuses a bad payload
  // and queues a retryable failure per member, exactly as one send does.
  const emailed = seats.flatMap(({ booking, person }) =>
    person.email
      ? [
          {
            kind: "departure_note" as const,
            noteId: note.id,
            seatId: booking.id,
            shopId: shop.id,
            to: person.email,
            locale: recipientLocale(person.locale, shop.defaultLocale),
            diverName: person.fullName,
            shopName: shop.name,
            tripTitle: trip.title,
            startsAt: dayStartsAt,
            timezone: shop.timezone,
            body,
            readinessUrl: readinessUrlFor(booking.id),
          },
        ]
      : [],
  );
  if (emailed.length > 0) {
    try {
      const deliveries = await sendNotificationBatch(db, emailed, emailProvider);
      delivered += deliveries.filter((delivery) => delivery.status === "sent").length;
    } catch (error) {
      log("departure_note.send_failed", "error", {
        noteId: note.id,
        errorCode: error instanceof Error ? error.name : "unknown_error",
      });
    }
  }
  // Then a text to every seat with no address, side by side.
  const texted = await Promise.all(
    seats.map(async ({ booking, person }) => {
      if (person.email) return false;
      const phone = smsRecipient(person.phone);
      if (!phone) return false;
      try {
        const locale = recipientLocale(person.locale, shop.defaultLocale);
        const t = diverTranslator(locale);
        const { delivery } = await sendCourtesyMessage(
          {
            to: phone,
            body: departureNoteText({
              locale,
              shopName: shop.name,
              tripTitle: trip.title,
              body,
              readinessUrl: readinessUrlFor(booking.id),
            }),
            smsStopLine: t("notifications.sms.stopLine"),
            shopName: shop.name,
          },
          { sms, whatsapp: senders.get(shop.id) ?? null },
        );
        return delivery.status === "sent";
      } catch (error) {
        // One seat's failure never stops the rest of the departure hearing.
        log("departure_note.send_failed", "error", {
          noteId: note.id,
          errorCode: error instanceof Error ? error.name : "unknown_error",
        });
        return false;
      }
    }),
  );
  delivered += texted.filter(Boolean).length;

  await db.update(departureNotes).set({ delivered }).where(eq(departureNotes.id, note.id));
  if (input.actorPersonId) {
    await recordTripActivity(db, {
      shopId: shop.id,
      tripId: trip.id,
      actorPersonId: input.actorPersonId,
      entry: { code: "departure_note_sent" },
    });
  }
  return { ok: true, noteId: note.id, recipients: seats.length, delivered };
}

/** The notes a departure has carried, newest first, for the trip page. */
export async function listDepartureNotes(db: DbExecutor, shopId: string, tripId: string) {
  return db
    .select({
      id: departureNotes.id,
      body: departureNotes.body,
      recipients: departureNotes.recipients,
      delivered: departureNotes.delivered,
      sentAt: departureNotes.sentAt,
      sentByName: people.fullName,
    })
    .from(departureNotes)
    .leftJoin(people, eq(people.id, departureNotes.sentByPersonId))
    .where(and(eq(departureNotes.shopId, shopId), eq(departureNotes.tripId, tripId)))
    .orderBy(asc(departureNotes.sentAt));
}

/**
 * Clear a demo shop's held sends and the desk records a departure leaves
 * (notes sent, items found), for the seeds' resets. The held sends lead,
 * since a held departure note is the one way a note row is written.
 */
export async function deleteHeldSendsAndDeskRows(db: DbExecutor, shopId: string): Promise<void> {
  await db.delete(heldSends).where(eq(heldSends.shopId, shopId));
  await db.delete(lostItems).where(eq(lostItems.shopId, shopId));
  await db.delete(departureNotes).where(eq(departureNotes.shopId, shopId));
}
