// i18n-exempt-file: the facts a reply draft quotes are written for Claude, never shown on a page
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import {
  type AssistOptions,
  assistsAvailable,
  runAssist,
  runAssistOutcome,
} from "@/features/assists";
import { listActiveCourses } from "@/features/courses";
import type { AppDb } from "../../db/client";
import { personThread } from "../../db/inbound-messages";
import { inboundMessages, shops } from "../../db/schema/index";
import { offsetUpcomingTripsWithCounts } from "../../db/trips";
import {
  checkedTranslation,
  DRAFT_THREAD_LINES,
  draftedReply,
  inboundTriageCall,
  languageOfLocale,
  replyDraftCall,
  replyTranslationCall,
  storedTriage,
  type ThreadLine,
} from "../../lib/assists/inbox";
import { nowDate } from "../../lib/clock";
import { deskTimeValue } from "../../lib/desk-hours";
import { formatMoneyCents, formatShortDate, formatTime } from "../../lib/format";
import { log } from "../../lib/log";
import { seatsOnSale, spotsRemaining } from "../../lib/trips";

/**
 * **The inbox assists, run against the database** (ADR 20261018-claude-assists).
 * The prompts are `src/lib/assists/inbox.ts`; this module reads what they
 * need inside the caller's shop, runs them through `runAssist`, and stores
 * what is worth keeping. Every function answers null or does nothing when the
 * shop's assists are dark, so each caller reads exactly as it did without
 * Claude.
 */

/** How many waiting messages one page view may sort, so a backlog costs a few calls a view, not a hundred. */
export const TRIAGE_PER_VIEW = 5;

/** The bounded public departure window and maximum number a desk would read out. */
const FACT_DEPARTURES = 40;
const FACT_HORIZON_DAYS = 45;

/**
 * **Whether triage would read this message**: the same rule as the `where` in
 * {@link triageInboundMessage}, for the pages that choose which waiting
 * messages to hand it. A message triage skips (an "Ask to move", a keyword
 * reply, spam, an unauthenticated sender, a blank body) is never stamped, so a
 * caller that passed it would spend a per-view slot on it on every view.
 */
export function awaitsTriage(
  message: Pick<
    typeof inboundMessages.$inferSelect,
    | "assistedAt"
    | "deletedAt"
    | "keywordIntent"
    | "spamFlagged"
    | "senderAuthenticated"
    | "channel"
    | "body"
  >,
): boolean {
  return (
    message.assistedAt === null &&
    message.deletedAt === null &&
    message.keywordIntent === null &&
    !message.spamFlagged &&
    message.senderAuthenticated &&
    message.channel !== "page" &&
    message.body.trim() !== ""
  );
}

/**
 * Sorts and, when it is in another language, translates one inbound message,
 * and stores the answer on it. Runs once per message: a message already read,
 * one a keyword handled, an "Ask to move", spam, or a deleted one is skipped.
 * A shop with assists dark leaves the message untouched, so it is read once
 * the shop turns them on.
 */
export async function triageInboundMessage(
  db: AppDb,
  shopId: string,
  messageId: string,
  options: AssistOptions = {},
): Promise<void> {
  const [row] = await db
    .select({
      subject: inboundMessages.subject,
      body: inboundMessages.body,
      locale: shops.defaultLocale,
    })
    .from(inboundMessages)
    .innerJoin(shops, eq(shops.id, inboundMessages.shopId))
    .where(
      and(
        eq(inboundMessages.shopId, shopId),
        eq(inboundMessages.id, messageId),
        isNull(inboundMessages.deletedAt),
        isNull(inboundMessages.assistedAt),
        isNull(inboundMessages.keywordIntent),
        eq(inboundMessages.spamFlagged, false),
        // The webhook's own rule, here too: a sender whose domain checks failed
        // must not spend the shop's Claude budget by a staffer's page view.
        eq(inboundMessages.senderAuthenticated, true),
        ne(inboundMessages.channel, "page"),
      ),
    )
    .limit(1);
  if (!row?.body.trim()) return;
  if (!(await assistsAvailable(db, shopId, options))) return;
  const { status, value } = await runAssistOutcome(db, {
    ...options,
    shopId,
    feature: "inbox_sort",
    call: inboundTriageCall({ subject: row.subject, body: row.body, targetLocale: row.locale }),
  });
  // Nothing was asked, or nothing came back (over the cap, two calls in
  // flight, a provider error): left unread, so a later view asks again.
  if (status === "skipped") return;
  // An answer that was unusable still counts as read: asking again on every
  // view would spend the shop's cap on the same answer.
  const stored = value ? storedTriage(value, { body: row.body, targetLocale: row.locale }) : null;
  await db
    .update(inboundMessages)
    .set({
      assistIntent: stored?.intent ?? null,
      assistUrgent: stored?.urgent ?? null,
      assistLanguage: stored?.language ?? null,
      assistTranslation: stored?.translation ?? null,
      assistTranslatedTo: stored?.translatedTo ?? null,
      assistedAt: options.now ?? nowDate(),
    })
    .where(
      and(
        eq(inboundMessages.shopId, shopId),
        eq(inboundMessages.id, messageId),
        // Only onto the row as it was read. An erasure that redacted the body
        // while Claude was answering must not get the diver's words back as
        // a translation, and a second triage of the same message writes
        // nothing (security review L2, B2).
        isNull(inboundMessages.assistedAt),
        eq(inboundMessages.body, row.body),
        isNull(inboundMessages.deletedAt),
      ),
    );
}

/** {@link triageInboundMessage} that can never throw: for `after()` in a webhook or a page. */
export async function triageInboundMessagesSafely(
  db: AppDb,
  shopId: string,
  messageIds: readonly string[],
  options: AssistOptions = {},
): Promise<void> {
  for (const messageId of messageIds.slice(0, TRIAGE_PER_VIEW)) {
    try {
      await triageInboundMessage(db, shopId, messageId, options);
    } catch {
      log("claude_assist.triage_failed", "warn", {});
      return;
    }
  }
}

export type ReplyFacts = {
  /**
   * Today's date in the shop's zone and the span `lines` covers, so a draft
   * can tell "not listed" from "no trip". Its numbers are never a source a
   * draft may quote (`lines` only).
   */
  window: string;
  /** The shop's facts a reply may quote, one line each, in the shop's own words and currency. */
  lines: string[];
};

/** The shop's facts a reply may quote, and the window they cover. */
export async function replyFacts(
  db: AppDb,
  shopId: string,
  now: Date = nowDate(),
): Promise<ReplyFacts> {
  const [shop] = await db
    .select({
      name: shops.name,
      timezone: shops.timezone,
      locale: shops.defaultLocale,
      currency: shops.currency,
      opens: shops.deskOpensMinute,
      closes: shops.deskClosesMinute,
      phone: shops.contactPhone,
      rentalTerms: shops.rentalTerms,
      replyNotes: shops.replyNotes,
      tagline: shops.tagline,
      description: shops.description,
      street: shops.addressStreet,
      locality: shops.addressLocality,
      region: shops.addressRegion,
      packingList: shops.packingList,
      rentalItems: shops.rentalItems,
      rentalPricing: shops.rentalPricing,
      hotelPickup: shops.offersHotelPickup,
      nitroxFill: shops.nitroxFillMethod,
      boat: shops.hasBoatDiving,
      shore: shops.hasShoreDiving,
      pool: shops.hasPoolDiving,
    })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  if (!shop) return { window: "", lines: [] };
  const horizon = new Date(now.getTime() + FACT_HORIZON_DAYS * 24 * 60 * 60 * 1000);
  const [upcoming, courses] = await Promise.all([
    offsetUpcomingTripsWithCounts(db, shopId, {
      limit: FACT_DEPARTURES,
      now,
      monthEnd: horizon,
      // A charter's title is often a customer's name, and a rehearsal is not
      // a departure: neither may reach a draft to another diver.
      outward: true,
    }),
    listActiveCourses(db, shopId),
  ]);
  const money = (cents: number | null | undefined) =>
    cents == null ? "price on request" : formatMoneyCents(cents, shop.currency, shop.locale);
  const lines = [
    `Shop: ${shop.name}. Times are local (${shop.timezone}).`,
    `Desk hours: ${deskTimeValue(shop.opens)} to ${deskTimeValue(shop.closes)} daily.`,
  ];
  if (shop.phone) lines.push(`Phone: ${shop.phone}`);
  const address = [shop.street, shop.locality, shop.region].filter(Boolean).join(", ");
  if (address) lines.push(`Address: ${address}`);
  const offers = [
    shop.boat && "boat dives",
    shop.shore && "shore dives",
    shop.pool && "pool sessions",
  ]
    .filter(Boolean)
    .join(", ");
  if (offers) lines.push(`Offers: ${offers}.`);
  if (shop.tagline?.trim()) lines.push(`About: ${shop.tagline.trim()}`);
  if (shop.description?.trim()) lines.push(shop.description.trim());
  if (shop.hotelPickup) lines.push("Hotel pickup is offered.");
  if (shop.packingList.length > 0) lines.push(`What to bring: ${shop.packingList.join("; ")}.`);
  if (shop.rentalItems.length > 0) lines.push(`Rental gear: ${shop.rentalItems.join(", ")}.`);
  const pricing = shop.rentalPricing;
  if (pricing.setCents != null)
    lines.push(`Rental set (full core kit): ${money(pricing.setCents)}.`);
  for (const [item, cents] of Object.entries(pricing.perItemCents)) {
    lines.push(`Rental ${item}: ${money(cents)}.`);
  }
  if (pricing.nitroxCents != null) lines.push(`Nitrox: ${money(pricing.nitroxCents)} per dive.`);
  lines.push("Departures:");
  for (const trip of upcoming.trips) {
    const seats = spotsRemaining(seatsOnSale(trip));
    lines.push(
      `- ${formatShortDate(trip.startsAt, shop.locale, shop.timezone)} ${formatTime(trip.startsAt, shop.locale, shop.timezone)}, ${trip.title}: ${seats === 0 ? "full" : `${seats} seats open`}, ${money(trip.priceCents ?? trip.course?.priceCents)}`,
    );
    // This shop-wide context has no booked-recipient authorization. The public
    // trip hero withholds exact arrival destinations; drafts for unmatched or
    // prebooking senders must not receive those structured fields either.
    if (trip.description?.trim()) lines.push(`  ${trip.description.trim().slice(0, 400)}`);
  }
  if (upcoming.trips.length === 0)
    lines.push(`- No public departures are listed in this ${FACT_HORIZON_DAYS}-day window.`);
  if (courses.length > 0) {
    lines.push("Courses:");
    for (const course of courses) {
      lines.push(`- ${course.title}: ${money(course.priceCents)}`);
      const about = (course.summary ?? course.description ?? "").trim();
      if (about) lines.push(`  ${about.slice(0, 400)}`);
    }
  }
  if (shop.rentalTerms?.trim()) lines.push(`Rental terms: ${shop.rentalTerms.trim()}`);
  // The shop's own notes for replies: parking, rentals, what to bring.
  const notes = (shop.replyNotes ?? "").split(/\r?\n/).filter((line) => line.trim());
  if (notes.length > 0) lines.push("Notes from the shop:", ...notes);
  const window = [
    `Today is ${formatShortDate(now, shop.locale, shop.timezone)} (${shop.timezone}).`,
    `The departures in <facts> are the shop's public departures in the next ${FACT_HORIZON_DAYS} days, through ${formatShortDate(horizon, shop.locale, shop.timezone)}, at most ${FACT_DEPARTURES} departures.`,
    upcoming.total > upcoming.trips.length
      ? "The list stops at that limit: there are more departures in those days than it shows."
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  return { window, lines };
}

/**
 * A reply to the latest message in this diver's thread, grounded in the
 * shop's facts, or null. The thread sends the words only: no address, no
 * record, and the diver's name not at all.
 */
export async function draftReplyFor(
  db: AppDb,
  input: { shopId: string; personId: string; now?: Date } & AssistOptions,
): Promise<string | null> {
  const outcome = await draftReplyOutcome(db, input);
  return outcome.text;
}

/**
 * Why a reply draft came back empty, so the screen can say so: `unavailable`
 * (dark, over the cap, a provider error: asking again may work), `declined`
 * (Claude answered but its text was empty or its schema could not be read), `nothing-to-answer`
 * (the thread holds no message from the diver).
 */
export type DraftReplyOutcome =
  | { text: string }
  | { text: null; reason: "unavailable" | "declined" | "nothing-to-answer" };

/** {@link draftReplyFor} that says why when there is no draft. */
export async function draftReplyOutcome(
  db: AppDb,
  input: { shopId: string; personId: string; now?: Date } & AssistOptions,
): Promise<DraftReplyOutcome> {
  const { shopId, personId } = input;
  if (!(await assistsAvailable(db, shopId, input))) return { text: null, reason: "unavailable" };
  const entries = await personThread(db, shopId, personId);
  const lines: ThreadLine[] = entries
    .filter((entry) => entry.direction === "outbound" || entry.message.channel !== "page")
    .map((entry) =>
      entry.direction === "inbound"
        ? { from: "diver" as const, text: entry.message.body }
        : { from: "shop" as const, text: entry.reply.body },
    )
    .filter((line) => line.text.trim());
  // The draft answers the diver's latest message: once the shop has written
  // last there is nothing to answer.
  if (lines.at(-1)?.from !== "diver") return { text: null, reason: "nothing-to-answer" };
  const thread = lines.slice(-DRAFT_THREAD_LINES);
  const { window, lines: facts } = await replyFacts(db, shopId, input.now);
  const { status, value } = await runAssistOutcome(db, {
    ...input,
    feature: "inbox_draft",
    call: replyDraftCall({ window, facts, thread }),
  });
  if (status === "skipped") return { text: null, reason: "unavailable" };
  const text = value ? draftedReply(value) : null;
  if (!text) {
    log("claude_assist.draft_unusable", "info", {
      answered: Boolean(value),
    });
    return { text: null, reason: "declined" };
  }
  return { text };
}

/**
 * The language this diver last wrote in, when it is not the shop's: what a
 * reply may be translated into. Null when they write in the shop's language
 * or no assist has read their messages.
 */
export async function diverReplyLanguage(
  db: AppDb,
  shopId: string,
  personId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ language: inboundMessages.assistLanguage, locale: shops.defaultLocale })
    .from(inboundMessages)
    .innerJoin(shops, eq(shops.id, inboundMessages.shopId))
    .where(
      and(
        eq(inboundMessages.shopId, shopId),
        eq(inboundMessages.personId, personId),
        isNull(inboundMessages.deletedAt),
        sql`${inboundMessages.assistLanguage} is not null`,
      ),
    )
    .orderBy(desc(inboundMessages.receivedAt))
    .limit(1);
  if (!row?.language) return null;
  return row.language === languageOfLocale(row.locale) ? null : row.language;
}

/** The staffer's reply in the diver's language, or null. The original stays theirs to keep. */
export async function translateReplyFor(
  db: AppDb,
  input: { shopId: string; personId: string; text: string } & AssistOptions,
): Promise<string | null> {
  const text = input.text.trim();
  if (!text) return null;
  const language = await diverReplyLanguage(db, input.shopId, input.personId);
  if (!language) return null;
  const value = await runAssist(db, {
    ...input,
    feature: "reply_translate",
    call: replyTranslationCall({ text, language }),
  });
  return value ? checkedTranslation(text, value.translation) : null;
}

/** A generic reply to exactly the selected message, including an unmatched sender. */
export async function draftReplyToMessage(
  db: AppDb,
  input: { shopId: string; messageId: string; now?: Date } & AssistOptions,
): Promise<string | null> {
  const [message] = await db
    .select({ subject: inboundMessages.subject, body: inboundMessages.body })
    .from(inboundMessages)
    .where(
      and(
        eq(inboundMessages.shopId, input.shopId),
        eq(inboundMessages.id, input.messageId),
        isNull(inboundMessages.deletedAt),
        eq(inboundMessages.senderAuthenticated, true),
        eq(inboundMessages.spamFlagged, false),
        ne(inboundMessages.channel, "page"),
      ),
    )
    .limit(1);
  if (!message?.body.trim() || !(await assistsAvailable(db, input.shopId, input))) return null;
  const thread: ThreadLine[] = [
    { from: "diver", text: [message.subject, message.body].filter(Boolean).join("\n\n") },
  ];
  const { window, lines: facts } = await replyFacts(db, input.shopId, input.now);
  const value = await runAssist(db, {
    ...input,
    feature: "inbox_draft",
    call: replyDraftCall({ window, facts, thread }),
  });
  if (!value) return null;
  // Erasure or an edit while the model was answering must not resurrect old words.
  const [current] = await db
    .select({ id: inboundMessages.id })
    .from(inboundMessages)
    .where(
      and(
        eq(inboundMessages.shopId, input.shopId),
        eq(inboundMessages.id, input.messageId),
        isNull(inboundMessages.deletedAt),
        eq(inboundMessages.body, message.body),
        message.subject === null
          ? isNull(inboundMessages.subject)
          : eq(inboundMessages.subject, message.subject),
        eq(inboundMessages.senderAuthenticated, true),
        eq(inboundMessages.spamFlagged, false),
      ),
    )
    .limit(1);
  return current ? draftedReply(value) : null;
}
