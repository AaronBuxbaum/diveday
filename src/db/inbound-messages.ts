import { and, asc, count, desc, eq, gte, isNull, ne, notLike, or, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import {
  type InboundChannel,
  MOVE_ASK_NOTE_MAX_LENGTH,
  moveAskProviderId,
  normalizeEmailAddress,
  normalizePhoneAddress,
  phoneMatches,
  truncateInboundBody,
} from "@/lib/inbox";
import { hasSailed } from "@/lib/trips";
import type { AppDb, DbExecutor } from "./client";
import { offsetPage, PAGE_SIZE } from "./paging";
import { queryAll } from "./query-helpers";
import {
  bookings,
  inboundMessages,
  notificationDeliveries,
  people,
  shops,
  staffReplies,
  trips,
} from "./schema";
import { lockSeatDeparture } from "./seat-locks";
import { liveTrip, notRehearsal } from "./trips-live";

/**
 * The shop inbox's readers and writers (ADR 20260907-two-way-inbox).
 *
 * Three rules every function here keeps:
 *
 * - **The tenant comes first.** A message is recorded against a shop the
 *   receiving route already resolved (a reply-to token, a WhatsApp Business
 *   Account), and the sender is matched to a person **inside that shop** only.
 *   Nothing here takes an address and finds a shop from it.
 * - **Attribution needs a vouched address.** A message whose sender the
 *   channel did not authenticate (`senderAuthenticated: false`) is filed as a
 *   stranger, never matched onto a diver's record.
 * - **A redelivery is a no-op.** `provider_message_id` is unique per channel,
 *   and `recordInboundMessage` says `duplicate` rather than inserting twice —
 *   Meta and SNS both retry on any non-2xx, and both occasionally deliver
 *   twice on a 200.
 * - **Every read is live.** `deleted_at is null` on the inbox, the thread, the
 *   counts, and the per-person window check.
 */

export type RecordInboundMessageInput = {
  shopId: string;
  channel: InboundChannel;
  /** As the provider gave it; normalised here per channel. */
  fromAddress: string;
  subject?: string | null;
  body: string;
  mediaCount?: number;
  receivedAt: Date;
  providerMessageId: string;
  /** An email's own `Message-ID` header, for threading the reply; null elsewhere. */
  emailMessageId?: string | null;
  /** The provider's id of the outbound message this answers, when a header names one. */
  inReplyToProviderMessageId?: string | null;
  /**
   * Whether the channel vouches for the address this arrived from. WhatsApp
   * always does — Meta reports the number the message was sent from, and only
   * that number's owner can send from it. Email only when SES authenticated
   * it: a `From:` header is written by whoever sent the mail, so an
   * unauthenticated one is filed as a stranger rather than put on the record
   * of the diver it names. Required, so a writer can never vouch by
   * forgetting: the schema's default is false for the same reason (#2311).
   */
  senderAuthenticated: boolean;
  /**
   * The provider judged it spam (SES's spam verdict failed). Filed all the
   * same, but stored so the after-hours ping neither fires on it nor counts
   * it (#2311). Defaults to false; only the email route has a verdict.
   */
  spamFlagged?: boolean;
};

export type RecordInboundMessageResult =
  | { status: "recorded"; id: string; personId: string | null }
  | { status: "duplicate" }
  | { status: "invalid_address" };

/**
 * The person an address belongs to, inside one shop. Null for a stranger.
 *
 * Email is an exact match on the lowercased address. A phone is decided by
 * `phoneMatches`, which reads the stored number against the shop's own country
 * (`shops.address_country`) and then compares for equality — so the shop is
 * read here, once, and handed to the rule.
 *
 * The SQL above it is a **prefilter, not the rule**: it narrows to rows whose
 * stored digits end in the inbound number's last seven, which is a deliberate
 * superset. Seven because `normalizePhoneAddress` already refuses anything
 * shorter, so it is the longest tail that cannot cut off a real national
 * number in any country DiveDay knows — the old ten was the North American
 * national-number length in disguise, and it hid every shorter one. A loose
 * prefilter fetches a few more rows per inbound message inside one shop;
 * `phoneMatches` is what decides, and it is strict. Among several matches — a
 * duplicate record the merge tool has not met yet — the oldest live diver wins,
 * so a message keeps landing on the record the shop has been using longest.
 *
 * Both reads lock what they match (`for key share`), which waits on a merge
 * holding the row `for update` and then re-reads it: a record merged away while
 * the message was arriving is no longer live, and the message is not filed on
 * it. The lock lasts only as long as the caller's transaction, which is why
 * `recordInboundMessage` runs the match and the insert in one.
 */
export async function matchPersonByAddress(
  db: DbExecutor,
  shopId: string,
  channel: InboundChannel,
  normalizedAddress: string,
): Promise<string | null> {
  const live = and(
    eq(people.shopId, shopId),
    isNull(people.deletedAt),
    isNull(people.anonymizedAt),
  );
  if (channel === "email") {
    const [row] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(live, sql`lower(${people.email}) = ${normalizedAddress}`))
      .orderBy(asc(people.createdAt))
      .limit(1)
      .for("key share");
    return row?.id ?? null;
  }
  const [shop] = await db
    .select({ country: shops.addressCountry })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  const tail = normalizedAddress.slice(-7);
  const candidates = await db
    .select({ id: people.id, phone: people.phone })
    .from(people)
    .where(
      and(
        live,
        sql`right(regexp_replace(coalesce(${people.phone}, ''), '\\D', '', 'g'), 7) = ${tail}`,
      ),
    )
    .orderBy(asc(people.createdAt))
    .for("key share");
  return (
    candidates.find((row) => phoneMatches(row.phone, normalizedAddress, shop?.country))?.id ?? null
  );
}

function normalizeAddress(channel: InboundChannel, raw: string): string | null {
  return channel === "email" ? normalizeEmailAddress(raw) : normalizePhoneAddress(raw);
}

/**
 * A stored subject, with control characters taken out.
 *
 * Cleaned where the row is written rather than in the notification schema,
 * because every reader of the row inherits it — the inbox list, the record's
 * conversation, an export — whereas the schema only protects the send path.
 *
 * Each control character becomes a **space** and the runs are then collapsed,
 * so a subject folded across lines reads "a b" rather than "ab". Truncation
 * comes last, so the 500 cap applies to the cleaned string. Only `\p{Cc}` is
 * touched: ordinary spaces, accents and emoji all survive.
 */
function sanitizeSubject(subject: string | null | undefined): string | null {
  return (
    subject
      ?.replace(/\p{Cc}/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500) || null
  );
}

/**
 * File one inbound message. Attribution and the reply link are resolved
 * here, in one place, so the two webhook routes cannot disagree about either.
 */
export async function recordInboundMessage(
  db: DbExecutor,
  input: RecordInboundMessageInput,
): Promise<RecordInboundMessageResult> {
  const fromAddress = normalizeAddress(input.channel, input.fromAddress);
  if (!fromAddress) return { status: "invalid_address" };
  // One transaction, so the match's row lock holds until the message is filed
  // (`matchPersonByAddress`): a merge cannot land between the two.
  return db.transaction((tx) => recordMatchedInboundMessage(tx, input, fromAddress));
}

async function recordMatchedInboundMessage(
  db: DbExecutor,
  input: RecordInboundMessageInput,
  fromAddress: string,
): Promise<RecordInboundMessageResult> {
  const personId =
    input.senderAuthenticated !== true
      ? null
      : await matchPersonByAddress(db, input.shopId, input.channel, fromAddress);
  let inReplyToDeliveryId: string | null = null;
  if (input.inReplyToProviderMessageId) {
    const [delivery] = await db
      .select({ id: notificationDeliveries.id })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.shopId, input.shopId),
          eq(notificationDeliveries.providerMessageId, input.inReplyToProviderMessageId),
        ),
      )
      .limit(1);
    inReplyToDeliveryId = delivery?.id ?? null;
  }

  const [inserted] = await db
    .insert(inboundMessages)
    .values({
      shopId: input.shopId,
      personId,
      channel: input.channel,
      fromAddress,
      subject: sanitizeSubject(input.subject),
      body: truncateInboundBody(input.body),
      mediaCount: Math.max(0, Math.floor(input.mediaCount ?? 0)),
      receivedAt: input.receivedAt,
      providerMessageId: input.providerMessageId,
      emailMessageId: input.emailMessageId?.trim().slice(0, 998) || null,
      inReplyToDeliveryId,
      senderAuthenticated: input.senderAuthenticated === true,
      spamFlagged: input.spamFlagged === true,
    })
    .onConflictDoNothing({ target: [inboundMessages.channel, inboundMessages.providerMessageId] })
    .returning({ id: inboundMessages.id });
  return inserted ? { status: "recorded", id: inserted.id, personId } : { status: "duplicate" };
}

type RecordMoveAskResult =
  | { status: "recorded"; id: string }
  | { status: "already" }
  | { status: "not_found" };

/**
 * **A diver asks to move a seat** (H-20261014-ask-to-move). Past the free-cancellation window a
 * cancel forfeits the money, so the booking page offers "Ask to move" instead:
 * a request, not a move. It lands in the Inbox as a `page` message naming the
 * booking, with the diver's optional note as its words, and staff decide —
 * moving a paid seat stays staff-side.
 *
 * The booking is read inside the shop and must belong to a live diver; the
 * address recorded is the one on file, so the row says who to call. One ask
 * per booking and departure (`moveAskProviderId`): a repeat while it stands
 * is `already`, never a second row. Once staff answered or deleted it, or the
 * seat moved (`moveBooking` answers it), it no longer stands, and asking
 * again files a new row. The old row and its replies remain history, while its
 * internal provider key is retired so the new row owns the standing request.
 * A row id is the request generation, even if both asks have the same time.
 */
export async function recordMoveAsk(
  db: DbExecutor,
  input: {
    shopId: string;
    bookingId: string;
    /** The departure on the validated page; refused if staff moved the seat meanwhile. */
    expectedTripId?: string;
    /**
     * The ask comes from a called-off departure's card (`askToMoveFromCancelledAction`,
     * H-20261022-called-off-boat-offers): the seat must be on a cancelled departure, the one state an
     * ordinary ask refuses, and a boat that never sails is not refused as sailed.
     */
    calledOff?: true;
    note?: string | null;
    now: Date;
  },
): Promise<RecordMoveAskResult> {
  return db.transaction(async (tx): Promise<RecordMoveAskResult> => {
    // The same order as staff moves/cancels: departure, booking, Inbox row.
    // Re-read after the lock, since staff may have moved or released the seat.
    const lockedTripId = await lockSeatDeparture(tx, input.shopId, input.bookingId);
    if (!lockedTripId) return { status: "not_found" };
    const [seat] = await tx
      .select({
        personId: people.id,
        email: people.email,
        phone: people.phone,
        tripId: bookings.tripId,
        startsAt: trips.startsAt,
        cancelledAt: trips.cancelledAt,
      })
      .from(bookings)
      .innerJoin(
        people,
        and(
          eq(people.id, bookings.personId),
          eq(people.shopId, input.shopId),
          isNull(people.deletedAt),
          isNull(people.anonymizedAt),
        ),
      )
      .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, input.shopId)))
      .where(
        and(
          eq(bookings.id, input.bookingId),
          eq(bookings.shopId, input.shopId),
          eq(bookings.tripId, lockedTripId),
          input.expectedTripId ? eq(bookings.tripId, input.expectedTripId) : undefined,
          eq(bookings.status, "booked"),
          isNull(bookings.identityUnconfirmedAt),
          input.calledOff ? eq(trips.status, "cancelled") : ne(trips.status, "cancelled"),
          liveTrip(),
          notRehearsal(),
        ),
      )
      .limit(1)
      .for("update", { of: bookings });
    if (!seat || (!input.calledOff && hasSailed(seat.startsAt, input.now))) {
      return { status: "not_found" };
    }
    const note = truncateInboundBody(input.note ?? "").slice(0, MOVE_ASK_NOTE_MAX_LENGTH);
    const fromAddress =
      normalizeEmailAddress(seat.email) ?? normalizePhoneAddress(seat.phone) ?? "";
    const providerMessageId = moveAskProviderId(input.bookingId, seat.tripId);
    let body = note;
    const [previous] = await tx
      .select({
        id: inboundMessages.id,
        answeredAt: inboundMessages.answeredAt,
        deletedAt: inboundMessages.deletedAt,
        receivedAt: inboundMessages.receivedAt,
        body: inboundMessages.body,
      })
      .from(inboundMessages)
      .where(
        and(
          eq(inboundMessages.shopId, input.shopId),
          eq(inboundMessages.channel, "page"),
          eq(inboundMessages.providerMessageId, providerMessageId),
        ),
      )
      .limit(1)
      .for("update");
    if (previous) {
      const open = !previous.answeredAt && !previous.deletedAt;
      // On the called-off card, an ask the diver sent while the boat was still
      // going was about a departure that no longer sails: it has lapsed, and
      // this ask replaces it (`askLapsedByCallOff`).
      const lapsed =
        open &&
        input.calledOff === true &&
        askLapsedByCallOff(previous.receivedAt, seat.cancelledAt);
      if (open && !lapsed) return { status: "already" };
      // The diver's own words from the lapsed ask ("must be back Sunday")
      // still hold for the desk: they follow the offer in the new row.
      if (lapsed) body = carriedMoveAskNote(note, previous.body);
      // Keep the original identity/body and any reply foreign keys. Only the
      // current request owns the canonical key used by the pending reader. A
      // lapsed ask stops waiting in the Inbox the way a move answers one.
      await tx
        .update(inboundMessages)
        .set({
          providerMessageId: `${providerMessageId}:superseded:${previous.id}`,
          ...(lapsed ? { answeredAt: input.now } : {}),
        })
        .where(and(eq(inboundMessages.shopId, input.shopId), eq(inboundMessages.id, previous.id)));
    }
    const [filed] = await tx
      .insert(inboundMessages)
      .values({
        shopId: input.shopId,
        personId: seat.personId,
        channel: "page",
        fromAddress,
        body,
        receivedAt: input.now,
        providerMessageId,
        keywordIntent: "move",
        bookingId: input.bookingId,
        // The booking capability vouched for the identity; this is never a reply target.
        senderAuthenticated: true,
      })
      .returning({ id: inboundMessages.id });
    return filed ? { status: "recorded", id: filed.id } : { status: "already" };
  });
}

/**
 * Whether an ask sent at `receivedAt` predates the call-off at `cancelledAt`,
 * so it was about a boat that was still going (H-20261022-called-off-boat-offers). A cancelled departure
 * with no recorded time (`trips.cancelled_at` is null only for trips cancelled
 * before the column existed, long sailed) gives nothing to compare: the ask
 * stands, rather than every tap filing another Inbox row.
 */
function askLapsedByCallOff(receivedAt: Date, cancelledAt: Date | null): boolean {
  return cancelledAt !== null && receivedAt.getTime() < cancelledAt.getTime();
}

/** A new ask's note, then a lapsed ask's own words, within the length a note may have. */
function carriedMoveAskNote(note: string, carried: string): string {
  return [note, carried.trim()]
    .filter((part) => part !== "")
    .join("\n\n")
    .slice(0, MOVE_ASK_NOTE_MAX_LENGTH);
}

/** The diver's own words and send time, never a staff reply or contact details. */
export type PendingMoveAsk = { note: string; sentAt: Date };

/**
 * The standing request for this live booking and its current departure (H-20261014-ask-to-move).
 * A known departure is an expectation, never permission to read an old request:
 * the booking is joined again so a concurrent move cannot expose a stale receipt.
 */
export async function getPendingMoveAsk(
  db: DbExecutor,
  shopId: string,
  bookingId: string,
  knownTripId?: string,
  /** The called-off card's ask (`recordMoveAsk`'s `calledOff`): it stands only on a cancelled departure. */
  options: { calledOff?: true } = {},
): Promise<PendingMoveAsk | null> {
  const tripId =
    knownTripId ??
    (
      await db
        .select({ tripId: bookings.tripId })
        .from(bookings)
        .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
        .limit(1)
    )[0]?.tripId;
  if (!tripId) return null;
  const [row] = await db
    .select({ note: inboundMessages.body, sentAt: inboundMessages.receivedAt })
    .from(inboundMessages)
    .innerJoin(
      bookings,
      and(
        eq(bookings.id, inboundMessages.bookingId),
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripId),
        eq(bookings.status, "booked"),
        isNull(bookings.identityUnconfirmedAt),
        eq(bookings.personId, inboundMessages.personId),
      ),
    )
    .innerJoin(
      people,
      and(
        eq(people.id, bookings.personId),
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
      ),
    )
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
    .where(
      and(
        eq(inboundMessages.shopId, shopId),
        eq(inboundMessages.bookingId, bookingId),
        eq(inboundMessages.channel, "page"),
        eq(inboundMessages.keywordIntent, "move"),
        eq(inboundMessages.providerMessageId, moveAskProviderId(bookingId, tripId)),
        isNull(inboundMessages.answeredAt),
        isNull(inboundMessages.deletedAt),
        options.calledOff
          ? and(
              eq(trips.status, "cancelled"),
              // `askLapsedByCallOff`, in SQL: an ask from before the call-off does not stand.
              or(isNull(trips.cancelledAt), gte(inboundMessages.receivedAt, trips.cancelledAt)),
            )
          : ne(trips.status, "cancelled"),
        liveTrip(),
        notRehearsal(),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Whether this booking's current departure has a standing request (H-20261014-ask-to-move). */
export async function hasMoveAsk(
  db: DbExecutor,
  shopId: string,
  bookingId: string,
  knownTripId?: string,
  options: { calledOff?: true } = {},
): Promise<boolean> {
  return (await getPendingMoveAsk(db, shopId, bookingId, knownTripId, options)) !== null;
}

/** The shop a reply-to token names, or null for a token nobody holds. */
export async function shopIdForInboundEmailToken(
  db: DbExecutor,
  token: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(eq(shops.inboundEmailToken, token))
    .limit(1);
  return row?.id ?? null;
}

const liveMessage = (shopId: string) =>
  and(eq(inboundMessages.shopId, shopId), isNull(inboundMessages.deletedAt));

export type InboxRow = {
  message: typeof inboundMessages.$inferSelect;
  /** The matched diver's name, or null for an unknown sender. */
  personName: string | null;
};

/**
 * The shop inbox, one page at a time: every live message, the unanswered
 * ones first, newest first within each half — a worklist rather than a feed
 * (ADR 20260827-people-not-lists). The count shares the row query's scope.
 */
export async function pagedInboxMessages(db: AppDb, shopId: string, options: { page?: number }) {
  const where = liveMessage(shopId);
  return offsetPage<InboxRow>({
    page: options.page,
    pageSize: PAGE_SIZE.list,
    countRows: async () => {
      const [row] = await db.select({ value: count() }).from(inboundMessages).where(where);
      return row?.value ?? 0;
    },
    fetchRows: (offset, limit) =>
      db
        .select({ message: inboundMessages, personName: people.fullName })
        .from(inboundMessages)
        // The shop condition is repeated on the join rather than inherited
        // from `personId`, which is only ever written by a shop-scoped match.
        // That is true today and is exactly the shape that stops being true
        // quietly: a reader should be able to see the tenant condition in the
        // query it is reading, not have to trust a writer three modules away.
        .leftJoin(people, and(eq(people.id, inboundMessages.personId), eq(people.shopId, shopId)))
        .where(where)
        .orderBy(
          sql`case when ${inboundMessages.answeredAt} is null then 0 else 1 end`,
          desc(inboundMessages.receivedAt),
        )
        .offset(offset)
        .limit(limit),
  });
}

/** How many live messages nobody has answered — what Today reports. */
export async function countUnansweredMessages(db: DbExecutor, shopId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(inboundMessages)
    .where(and(liveMessage(shopId), isNull(inboundMessages.answeredAt)));
  return row?.value ?? 0;
}

export type ThreadEntry =
  | { direction: "inbound"; message: typeof inboundMessages.$inferSelect }
  | {
      direction: "outbound";
      reply: typeof staffReplies.$inferSelect;
      sentByName: string | null;
    };

/**
 * One diver's conversation with the shop, oldest first: what they wrote and
 * what the shop wrote back, interleaved by time. Both halves live, both
 * scoped to the shop the record belongs to.
 */
export async function personThread(
  db: DbExecutor,
  shopId: string,
  personId: string,
): Promise<ThreadEntry[]> {
  const [inbound, outbound] = await queryAll(db, [
    () =>
      db
        .select()
        .from(inboundMessages)
        .where(and(liveMessage(shopId), eq(inboundMessages.personId, personId)))
        .orderBy(asc(inboundMessages.receivedAt)),
    () =>
      db
        .select({ reply: staffReplies, sentByName: people.fullName })
        .from(staffReplies)
        // The shop condition on the join for the same reason as
        // `pagedInboxMessages` above: `sentByPersonId` is only ever written
        // from a shop-scoped session, and the query a reader is reading should
        // say so rather than trust a writer three modules away. Left join, so
        // an id from another shop yields a null name, never that shop's.
        .leftJoin(
          people,
          and(eq(people.id, staffReplies.sentByPersonId), eq(people.shopId, shopId)),
        )
        .where(
          and(
            eq(staffReplies.shopId, shopId),
            eq(staffReplies.personId, personId),
            isNull(staffReplies.deletedAt),
          ),
        )
        .orderBy(asc(staffReplies.sentAt)),
  ]);
  const entries: ThreadEntry[] = [
    ...inbound.map((message) => ({ direction: "inbound" as const, message })),
    ...outbound.map(({ reply, sentByName }) => ({
      direction: "outbound" as const,
      reply,
      sentByName,
    })),
  ];
  const at = (entry: ThreadEntry) =>
    entry.direction === "inbound" ? entry.message.receivedAt : entry.reply.sentAt;
  return entries.sort((a, b) => at(a).getTime() - at(b).getTime());
}

/** One live message by id, inside the shop. */
export async function getInboundMessage(db: DbExecutor, shopId: string, messageId: string) {
  const [row] = await db
    .select()
    .from(inboundMessages)
    .where(and(liveMessage(shopId), eq(inboundMessages.id, messageId)))
    .limit(1);
  return row ?? null;
}

/**
 * When this diver last wrote on a channel — the fact Meta's 24-hour window is
 * measured from. Null when they never have.
 */
export async function lastInboundAt(
  db: DbExecutor,
  shopId: string,
  personId: string,
  channel: InboundChannel,
): Promise<Date | null> {
  const [row] = await db
    .select({ receivedAt: inboundMessages.receivedAt })
    .from(inboundMessages)
    .where(
      and(
        liveMessage(shopId),
        eq(inboundMessages.personId, personId),
        eq(inboundMessages.channel, channel),
      ),
    )
    .orderBy(desc(inboundMessages.receivedAt))
    .limit(1);
  return row?.receivedAt ?? null;
}

/** Stamp a message answered. Superseded move requests cannot answer a later generation. */
export async function markInboundAnswered(
  db: DbExecutor,
  shopId: string,
  messageId: string,
  now: Date = nowDate(),
  expectedReceivedAt?: Date,
): Promise<boolean> {
  const updated = await db
    .update(inboundMessages)
    .set({ answeredAt: now })
    .where(
      and(
        liveMessage(shopId),
        eq(inboundMessages.id, messageId),
        expectedReceivedAt ? eq(inboundMessages.receivedAt, expectedReceivedAt) : undefined,
        or(
          ne(inboundMessages.channel, "page"),
          notLike(inboundMessages.providerMessageId, "move-ask:%:superseded:%"),
        ),
      ),
    )
    .returning({ id: inboundMessages.id });
  return updated.length > 0;
}

/**
 * Put a message back on the worklist: the inbox's "Move back to waiting", for a
 * message somebody marked done too early. Idempotent; a no-op outside the shop.
 */
export async function reopenInboundMessage(
  db: DbExecutor,
  shopId: string,
  messageId: string,
  expectedReceivedAt?: Date,
): Promise<boolean> {
  const updated = await db
    .update(inboundMessages)
    .set({ answeredAt: null })
    .where(
      and(
        liveMessage(shopId),
        eq(inboundMessages.id, messageId),
        expectedReceivedAt ? eq(inboundMessages.receivedAt, expectedReceivedAt) : undefined,
        or(
          ne(inboundMessages.channel, "page"),
          notLike(inboundMessages.providerMessageId, "move-ask:%:superseded:%"),
        ),
      ),
    )
    .returning({ id: inboundMessages.id });
  return updated.length > 0;
}

/**
 * Soft delete a message from a sender nobody on the roster holds (ADR
 * 20260820-every-delete-is-soft; issue 1506). A no-op outside the shop, and a
 * no-op on a row that has a diver behind it.
 *
 * **`person_id is null` is in the `where`, not in the caller's promise.** The
 * surface renders the Delete on a stranger's row only (`_components/InboxRow.tsx`),
 * but that is JSX, and the action it submits takes a posted id: a diver-linked
 * id is one copy-paste from any staffer who can open a diver record, where the
 * reply composer prints it into a hidden input. Deleting one of those would
 * take what a diver wrote out of their own conversation with no way back, drop
 * Today's unanswered count, and — when it is their newest inbound — close the
 * 24-hour window the shop has to answer them at all (`src/lib/inbox.ts`). The
 * name says stranger because the query does (`security-reviewer`, issue 1506).
 */
export async function deleteStrangerInboundMessage(
  db: DbExecutor,
  shopId: string,
  messageId: string,
  now: Date = nowDate(),
): Promise<boolean> {
  const updated = await db
    .update(inboundMessages)
    .set({ deletedAt: now })
    .where(
      and(liveMessage(shopId), isNull(inboundMessages.personId), eq(inboundMessages.id, messageId)),
    )
    .returning({ id: inboundMessages.id });
  return updated.length > 0;
}

export type RecordStaffReplyInput = {
  /**
   * The row's own id, when the caller minted one first. `sendStaffReply` does:
   * the notification's idempotency key is `staff-reply/<id>`, so a queued
   * retry has to name the row the reply already is rather than a second one.
   */
  id?: string;
  shopId: string;
  personId: string;
  inboundMessageId: string | null;
  channel: InboundChannel;
  toAddress: string;
  body: string;
  locale: string;
  /**
   * The staffer who typed it, or **null when DiveDay answered on the shop's
   * behalf** — a reply-keyword confirmation (ADR 20260909-reply-keywords).
   */
  sentByPersonId: string | null;
  /**
   * Whether a sent reply also answers the message it was written to. True for
   * everything a staffer sends, and for an automatic reply that leaves the
   * shop nothing to do. **False for one that hands work over** — a diver
   * asking to be moved is still waiting on a person, and stamping that
   * message answered would take it off the worklist that exists to reach it.
   */
  marksAnswered?: boolean;
  delivery:
    | { status: "sent"; providerMessageId: string }
    | { status: "not_configured" }
    | { status: "failed"; errorCode?: string; detail?: string };
  sentAt?: Date;
};

/**
 * Record what went out and how it went. A sent reply also answers the
 * message it was written to; a failed one leaves it unanswered, because it
 * is — the row keeps the failure so the record can say so.
 */
export async function recordStaffReply(db: DbExecutor, input: RecordStaffReplyInput) {
  const sentAt = input.sentAt ?? nowDate();
  const [reply] = await db
    .insert(staffReplies)
    .values({
      ...(input.id ? { id: input.id } : {}),
      shopId: input.shopId,
      personId: input.personId,
      inboundMessageId: input.inboundMessageId,
      channel: input.channel,
      toAddress: input.toAddress,
      body: input.body,
      locale: input.locale,
      sentByPersonId: input.sentByPersonId,
      status: input.delivery.status,
      providerMessageId: input.delivery.status === "sent" ? input.delivery.providerMessageId : null,
      sendErrorCode: input.delivery.status === "failed" ? (input.delivery.errorCode ?? null) : null,
      sendError: input.delivery.status === "failed" ? (input.delivery.detail ?? null) : null,
      sentAt,
    })
    .returning();
  if (input.delivery.status === "sent" && input.inboundMessageId && input.marksAnswered !== false) {
    await markInboundAnswered(db, input.shopId, input.inboundMessageId, sentAt);
  }
  return reply;
}
