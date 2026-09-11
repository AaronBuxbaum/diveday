import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import {
  type InboundChannel,
  normalizeEmailAddress,
  normalizePhoneAddress,
  phoneMatches,
  truncateInboundBody,
} from "@/lib/inbox";
import { type AppDb, type DbExecutor, queryAll } from "./client";
import { offsetPage, PAGE_SIZE } from "./paging";
import { inboundMessages, notificationDeliveries, people, shops, staffReplies } from "./schema";

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
   * of the diver it names. Defaults to true; the email route passes the
   * answer it got from SES.
   */
  senderAuthenticated?: boolean;
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
      .limit(1);
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
    .orderBy(asc(people.createdAt));
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

  const personId =
    input.senderAuthenticated === false
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
    })
    .onConflictDoNothing({ target: [inboundMessages.channel, inboundMessages.providerMessageId] })
    .returning({ id: inboundMessages.id });
  return inserted ? { status: "recorded", id: inserted.id, personId } : { status: "duplicate" };
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

/** Stamp a message answered. Idempotent; a no-op outside the shop. */
export async function markInboundAnswered(
  db: DbExecutor,
  shopId: string,
  messageId: string,
  now: Date = nowDate(),
): Promise<boolean> {
  const updated = await db
    .update(inboundMessages)
    .set({ answeredAt: now })
    .where(and(liveMessage(shopId), eq(inboundMessages.id, messageId)))
    .returning({ id: inboundMessages.id });
  return updated.length > 0;
}

/** Soft delete (ADR 20260820-every-delete-is-soft). A no-op outside the shop. */
export async function deleteInboundMessage(
  db: DbExecutor,
  shopId: string,
  messageId: string,
  now: Date = nowDate(),
): Promise<boolean> {
  const updated = await db
    .update(inboundMessages)
    .set({ deletedAt: now })
    .where(and(liveMessage(shopId), eq(inboundMessages.id, messageId)))
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
