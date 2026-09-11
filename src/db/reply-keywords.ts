import { and, asc, count, desc, eq, gte, isNull, lte, ne } from "drizzle-orm";
import { diverTranslator } from "@/i18n/messages";
import { trackEvent } from "@/lib/analytics";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { normalizeEmailAddress, normalizePhoneAddress } from "@/lib/inbox";
import { log } from "@/lib/log";
import type { NotificationProvider } from "@/lib/notifications";
import { recipientLocale } from "@/lib/notifications/kinds";
import {
  CONFIRMATION_WINDOW_MS,
  confirmationCode,
  confirmationCodeMatches,
  parseReplyKeyword,
} from "@/lib/reply-keywords";
import { hasSailed } from "@/lib/trips";
import { selfCancelBooking } from "./bookings";
import type { AppDb } from "./client";
import { getInboundMessage } from "./inbound-messages";
import { refundBookingOnCancellation } from "./refunds";
import { bookings, inboundMessages, notificationDeliveries, people, shops, trips } from "./schema";
import { sendStaffReply } from "./staff-reply";
import { liveTrip } from "./trips-live";

/**
 * **A diver replies `C` and the seat comes off** (ADR 20260909-reply-keywords).
 *
 * The one consequence path behind the reply line on a trip reminder. It runs
 * on the inbound path N-20 built, after `recordInboundMessage` has filed the
 * message, and it is the only place that turns a diver's word into a state
 * change.
 *
 * Everything here exists because **the sender is authenticated by an address
 * and nothing else.** Four rules follow from that, and none of them is
 * optional:
 *
 * - **No keyword is read from an unattributed message.** `person_id` is only
 *   written when the channel vouched for the address *and* it matched a live
 *   diver inside this shop, so a null one is a stranger and a stranger's `C`
 *   is a sentence in the inbox, not a cancellation.
 * - **The first `C` never cancels anything.** It answers with the departure
 *   named in full and a code, sent back to the address on the record. Acting
 *   on it needs the code, which means it needs the diver's mailbox or handset
 *   rather than the ability to send one message that looks like theirs.
 * - **A code is only ever accepted while a cancellation is pending.** The
 *   pending state is the diver's own recent `C` on the same channel from the
 *   same address — a row this module wrote, not a claim the reply carries.
 * - **A cancellation goes through `selfCancelBooking`.** The same seat states,
 *   the same one-hour late-departure buffer, the same refund step afterwards
 *   as the diver's own `/ready` link, so there is one policy and one refusal
 *   path rather than two doors that drift.
 *
 * **Moving is a handoff, not a reschedule.** ADR
 * 20260821-the-diver-may-release-their-own-seat settled that moving a seat is
 * the shop's — the money has to move with it — and a mnemonic is not a reason
 * to build a rescheduling engine. `M` therefore says the shop will be in
 * touch, marks the message so the inbox can read a body of one letter, and
 * deliberately leaves it **unanswered** so it stays on the worklist.
 *
 * Words: composed here through `diverTranslator`, the same terminal-renderer
 * exception `reminderSmsBody` takes (ADR 20260731-notification-locale). No
 * downstream surface picks words for a message that has already been sent.
 */

/** What the inbound path did with one message. Codes, for logs and tests. */
export type ReplyKeywordOutcome =
  /** Nothing about the message was a keyword. The overwhelming majority. */
  | "not_a_keyword"
  /** A keyword from an address nobody on the roster holds, or that no channel vouched for. */
  | "unknown_sender"
  /** A channel with no way back to the diver. */
  | "channel_unsupported"
  /** Too many messages from this address too fast; nothing was interpreted. */
  | "rate_limited"
  /** `M`: the shop will pick it up, and the message stays on the worklist. */
  | "handed_off"
  /** `C`: the departure was named and a code sent. Nothing has changed yet. */
  | "awaiting_confirmation"
  /** `C` from a diver with no seat this could mean. */
  | "nothing_to_cancel"
  /** `C` from a diver holding several seats and no way to tell which. */
  | "ambiguous"
  /** The code matched. The seat is released. */
  | "cancelled"
  /** The code did not match a pending cancellation. */
  | "code_mismatch"
  /** The code matched but the seat could no longer be released. */
  | "cancel_refused";

export type HandleReplyKeywordInput = {
  shopId: string;
  /** The message `recordInboundMessage` just filed. */
  inboundMessageId: string;
  now?: Date;
  /** Tests inject a fake; production resolves SES from the environment. */
  provider?: NotificationProvider;
};

/**
 * How many messages from one address, on one channel, in one shop this will
 * read keywords out of per hour.
 *
 * It is a brute-force ceiling before it is anything else: a confirmation code
 * is six characters, and this is what makes guessing one cost an hour per ten
 * attempts. It fails *safe* — over the cap the message is filed and left for a
 * staffer, exactly as every message was before this feature existed — so a
 * chatty diver loses the shortcut and nothing else.
 */
const KEYWORD_MESSAGES_PER_HOUR = 10;

/** Cancellable seats considered for one `C`. A diver past this is ambiguous by any measure. */
const MAX_CANDIDATE_BOOKINGS = 20;

type CandidateBooking = {
  bookingId: string;
  tripId: string;
  tripTitle: string;
  startsAt: Date;
  endsAt: Date;
};

/**
 * The seats this diver could release right now, soonest first.
 *
 * Mirrors `selfCancelBooking`'s own pre-checks — a plain `booked` seat on a
 * departure that has not sailed, including the one-hour late-departure buffer
 * (AGENTS.md) — so this never offers to cancel something the domain function
 * would then refuse. The board read carries `liveTrip()`: a departure the shop
 * took down is not one a diver can be talked into cancelling.
 */
async function cancellableBookings(
  db: AppDb,
  shopId: string,
  personId: string,
  now: Date,
): Promise<CandidateBooking[]> {
  const rows = await db
    .select({
      bookingId: bookings.id,
      tripId: trips.id,
      tripTitle: trips.title,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.personId, personId),
        eq(bookings.status, "booked"),
        liveTrip(),
      ),
    )
    .orderBy(asc(trips.startsAt))
    .limit(MAX_CANDIDATE_BOOKINGS);
  return rows.filter((row) => !hasSailed(row.startsAt, now));
}

/**
 * The booking an emailed reply threads back to, when it threads back to one.
 *
 * `inbound_messages.in_reply_to_delivery_id` is resolved from the mail's own
 * `In-Reply-To` header against a delivery row this shop sent, and a delivery
 * row names its booking — so a diver replying to *this reminder* has told us
 * which seat they mean without typing anything. Scoped to the shop for the
 * usual reason, and only ever used to *pick among* seats this diver can
 * already cancel, never as authority on its own.
 */
async function bookingFromThread(
  db: AppDb,
  shopId: string,
  deliveryId: string | null,
): Promise<string | null> {
  if (!deliveryId) return null;
  const [row] = await db
    .select({ bookingId: notificationDeliveries.bookingId })
    .from(notificationDeliveries)
    .where(
      and(eq(notificationDeliveries.id, deliveryId), eq(notificationDeliveries.shopId, shopId)),
    )
    .limit(1);
  return row?.bookingId ?? null;
}

/** Whether this diver has asked to cancel recently enough that a code is still live. */
async function cancelPending(
  db: AppDb,
  shopId: string,
  message: typeof inboundMessages.$inferSelect,
  now: Date,
): Promise<boolean> {
  if (!message.personId) return false;
  const [row] = await db
    .select({ id: inboundMessages.id })
    .from(inboundMessages)
    .where(
      and(
        eq(inboundMessages.shopId, shopId),
        eq(inboundMessages.personId, message.personId),
        eq(inboundMessages.channel, message.channel),
        eq(inboundMessages.fromAddress, message.fromAddress),
        eq(inboundMessages.keywordIntent, "cancel"),
        isNull(inboundMessages.deletedAt),
        // Two windows, matching what `confirmationCodeMatches` will accept.
        gte(inboundMessages.receivedAt, new Date(now.getTime() - 2 * CONFIRMATION_WINDOW_MS)),
        // "An earlier request, and not this message" — bounded at this
        // message's own instant and excluded by id, rather than strictly
        // before it. Two messages can share a `received_at`: the e2e fleet
        // freezes the clock, so the `C` and the code that answers it land on
        // the same timestamp and a strict `<` found no pending request at all,
        // which read as "six characters somebody typed". A real inbox can do
        // the same thing at a lower rate, and would have failed the same way.
        lte(inboundMessages.receivedAt, message.receivedAt),
        ne(inboundMessages.id, message.id),
      ),
    )
    .orderBy(desc(inboundMessages.receivedAt))
    .limit(1);
  return Boolean(row);
}

async function overKeywordCap(
  db: AppDb,
  shopId: string,
  message: typeof inboundMessages.$inferSelect,
  now: Date,
): Promise<boolean> {
  const [row] = await db
    .select({ value: count() })
    .from(inboundMessages)
    .where(
      and(
        eq(inboundMessages.shopId, shopId),
        eq(inboundMessages.channel, message.channel),
        eq(inboundMessages.fromAddress, message.fromAddress),
        isNull(inboundMessages.deletedAt),
        gte(inboundMessages.receivedAt, new Date(now.getTime() - HOUR_MS)),
      ),
    );
  return (row?.value ?? 0) > KEYWORD_MESSAGES_PER_HOUR;
}

async function stampIntent(
  db: AppDb,
  shopId: string,
  messageId: string,
  intent: "cancel" | "move" | "confirm",
): Promise<void> {
  await db
    .update(inboundMessages)
    .set({ keywordIntent: intent })
    .where(and(eq(inboundMessages.shopId, shopId), eq(inboundMessages.id, messageId)));
}

export async function handleInboundReplyKeyword(
  db: AppDb,
  input: HandleReplyKeywordInput,
): Promise<ReplyKeywordOutcome> {
  const now = input.now ?? nowDate();
  const message = await getInboundMessage(db, input.shopId, input.inboundMessageId);
  if (!message) return "not_a_keyword";
  // A stranger's word is a sentence in the inbox and nothing else. This is the
  // whole of the identity check, and it is deliberately upstream of the parse:
  // nothing about an unattributed message is interpreted at all.
  if (!message.personId) {
    const parsed = parseReplyKeyword(message.body);
    return parsed.kind === "none" ? "not_a_keyword" : "unknown_sender";
  }
  // `sms` is in the channel enum for the day two-way SMS lands (ADR
  // 20260907-two-way-inbox decision 7); nothing writes it yet, and there is
  // no way to answer one, so a keyword on it would be a promise we cannot keep.
  if (message.channel === "sms") return "channel_unsupported";

  const parsed = parseReplyKeyword(message.body);
  if (parsed.kind === "none") return "not_a_keyword";
  if (await overKeywordCap(db, input.shopId, message, now)) {
    log("reply_keyword.rate_limited", "warn", {
      shopId: input.shopId,
      messageId: message.id,
      channel: message.channel,
    });
    return "rate_limited";
  }

  const [shop] = await db
    .select({ name: shops.name, defaultLocale: shops.defaultLocale, timezone: shops.timezone })
    .from(shops)
    .where(eq(shops.id, input.shopId))
    .limit(1);
  const [person] = await db
    .select({ locale: people.locale, email: people.email, phone: people.phone })
    .from(people)
    .where(
      and(
        eq(people.id, message.personId),
        eq(people.shopId, input.shopId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
      ),
    )
    .limit(1);
  if (!shop || !person) return "unknown_sender";
  // **Stricter than attribution, deliberately.** `matchPersonByAddress` reads
  // the stored number against the shop's country first (`phoneMatches`), which
  // is the right trade for filing a sentence on a record a staffer then reads
  // — and more than a state change should rest on, because the shop's country
  // is a settings field one staffer can change. A keyword needs the address on
  // file to be the address that wrote, exactly, with nothing resolved in
  // between. Since every writer of `people.phone` stores E.164 (`storedPhone`,
  // src/db/person-phone.ts), that is the ordinary case rather than the lucky
  // one: the number on the record and the number the provider reports are the
  // same digits, and the shortcut works. A row still holding a number `toE164`
  // could not read loses the shortcut, which is the safe way to lose it.
  const onFile =
    message.channel === "email"
      ? normalizeEmailAddress(person.email)
      : normalizePhoneAddress(person.phone);
  if (onFile !== message.fromAddress) return "unknown_sender";

  const locale = recipientLocale(person.locale, shop.defaultLocale);
  const t = diverTranslator(locale);
  const answer = async (body: string, marksAnswered: boolean) => {
    const sent = await sendStaffReply(db, {
      shopId: input.shopId,
      personId: message.personId as string,
      messageId: message.id,
      body,
      sentByPersonId: null,
      marksAnswered,
      now,
      provider: input.provider,
    });
    if (sent.status !== "sent") {
      // The seat still moved, or deliberately did not. A confirmation that
      // could not be delivered is worth a line so a staffer can see it in the
      // inbox and pick the conversation up by hand.
      log("reply_keyword.answer_not_sent", "warn", {
        shopId: input.shopId,
        messageId: message.id,
        status: sent.status,
        reason: sent.reason,
      });
    }
  };
  const departure = (booking: CandidateBooking) => ({
    tripTitle: booking.tripTitle,
    date: formatShortDate(booking.startsAt, locale, shop.timezone),
    time: formatTimeRangeTz(booking.startsAt, booking.endsAt, locale, shop.timezone),
  });

  if (parsed.kind === "intent") {
    return parsed.intent === "move"
      ? await handleMove(db, input.shopId, message.id, answer, t, shop.name)
      : await handleCancelRequest(db, {
          shopId: input.shopId,
          message,
          now,
          answer,
          departure,
          t,
          shopName: shop.name,
        });
  }

  // A code, which only means anything while this diver has a cancellation
  // pending. Without that it is six characters somebody typed, and the shop
  // inbox is where those go.
  if (!(await cancelPending(db, input.shopId, message, now))) return "not_a_keyword";

  const candidates = await cancellableBookings(db, input.shopId, message.personId, now);
  const matched = candidates.find((booking) =>
    confirmationCodeMatches(
      parsed.code,
      {
        shopId: input.shopId,
        bookingId: booking.bookingId,
        personId: message.personId as string,
        channel: message.channel,
        toAddress: message.fromAddress,
      },
      now.getTime(),
    ),
  );
  if (!matched) {
    await answer(t("notifications.replyKeyword.codeMismatch", { shopName: shop.name }), false);
    return "code_mismatch";
  }

  const cancelled = await selfCancelBooking(db, {
    shopId: input.shopId,
    bookingId: matched.bookingId,
    now,
  });
  if (!cancelled.ok) {
    // Never distinguished to the diver: the same fail-closed-uniformly rule
    // `selfCancelBooking` states over its own reasons. The seat moved under
    // them between the code and the reply, and the shop is who says what now.
    await answer(t("notifications.replyKeyword.cancelRefused", { shopName: shop.name }), false);
    return "cancel_refused";
  }
  await stampIntent(db, input.shopId, message.id, "confirm");
  await trackEvent({ name: "booking_cancelled", source: "diver" });

  // Cancellation and refund stay the two independent steps the staff path and
  // `/ready` both use (H-07). Caught for the same reason `cancelMyBookingAction`
  // catches it: the seat is already released and the diver is owed a confirmation
  // either way; a refund a transient failure lost is a thing staff can see and fix.
  let refunded: number | null = null;
  try {
    const refund = await refundBookingOnCancellation(db, {
      shopId: input.shopId,
      bookingId: matched.bookingId,
    });
    if (refund.status === "refunded") refunded = refund.amountCents;
    if (refund.status !== "no_policy" && refund.status !== "unpaid") {
      await trackEvent({ name: "refund_issued", auto: true, status: refund.status });
    }
  } catch {
    log("reply_keyword.refund_failed", "error", {
      shopId: input.shopId,
      bookingId: matched.bookingId,
    });
  }

  const named = departure(matched);
  await answer(
    refunded === null
      ? t("notifications.replyKeyword.cancelled", named)
      : `${t("notifications.replyKeyword.cancelled", named)} ${t("notifications.replyKeyword.refundOnItsWay")}`,
    true,
  );
  return "cancelled";
}

async function handleMove(
  db: AppDb,
  shopId: string,
  messageId: string,
  answer: (body: string, marksAnswered: boolean) => Promise<void>,
  t: ReturnType<typeof diverTranslator>,
  shopName: string,
): Promise<ReplyKeywordOutcome> {
  await stampIntent(db, shopId, messageId, "move");
  // Answered stays false on purpose: a person still has to do this.
  await answer(t("notifications.replyKeyword.moveHandoff", { shopName }), false);
  return "handed_off";
}

async function handleCancelRequest(
  db: AppDb,
  input: {
    shopId: string;
    message: typeof inboundMessages.$inferSelect;
    now: Date;
    answer: (body: string, marksAnswered: boolean) => Promise<void>;
    departure: (booking: CandidateBooking) => { tripTitle: string; date: string; time: string };
    t: ReturnType<typeof diverTranslator>;
    shopName: string;
  },
): Promise<ReplyKeywordOutcome> {
  const { shopId, message, now, answer, departure, t, shopName } = input;
  const personId = message.personId as string;
  const candidates = await cancellableBookings(db, shopId, personId, now);
  if (candidates.length === 0) {
    await stampIntent(db, shopId, message.id, "cancel");
    // Left unanswered: a diver asking to cancel something we cannot find is a
    // person who needs a person.
    await answer(t("notifications.replyKeyword.nothingToCancel", { shopName }), false);
    return "nothing_to_cancel";
  }

  let subject = candidates[0];
  if (candidates.length > 1) {
    // An emailed reply carries which reminder it answers; a WhatsApp does not.
    // With no thread to read, guessing between two departures is the one
    // mistake this feature must never make, so it hands over instead.
    const threaded = await bookingFromThread(db, shopId, message.inReplyToDeliveryId);
    const fromThread = candidates.find((booking) => booking.bookingId === threaded);
    if (!fromThread) {
      await stampIntent(db, shopId, message.id, "cancel");
      await answer(t("notifications.replyKeyword.ambiguous", { shopName }), false);
      return "ambiguous";
    }
    subject = fromThread;
  }

  const code = confirmationCode(
    {
      shopId,
      bookingId: subject.bookingId,
      personId,
      channel: message.channel,
      toAddress: message.fromAddress,
    },
    now.getTime(),
  );
  // Stamped before the answer goes out, so the pending state exists no matter
  // what the send does. A code nobody received cancels nothing on its own.
  await stampIntent(db, shopId, message.id, "cancel");
  await answer(
    t("notifications.replyKeyword.confirmCancel", { ...departure(subject), code }),
    true,
  );
  return "awaiting_confirmation";
}
