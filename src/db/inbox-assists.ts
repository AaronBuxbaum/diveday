// i18n-exempt-file: the facts a reply draft quotes are written for Claude, never shown on a page
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import {
  checkedTranslation,
  DRAFT_THREAD_LINES,
  groundedReply,
  inboundTriageCall,
  languageOfLocale,
  replyDraftCall,
  replyTranslationCall,
  storedTriage,
  type ThreadLine,
} from "@/lib/assists/inbox";
import { nowDate } from "@/lib/clock";
import { deskTimeValue } from "@/lib/desk-hours";
import { formatMoneyCents, formatShortDate, formatTime } from "@/lib/format";
import { log } from "@/lib/log";
import { seatsOnSale, spotsRemaining } from "@/lib/trips";
import { type AssistOptions, assistsAvailable, runAssist } from "./assists";
import type { AppDb } from "./client";
import { listActiveCourses } from "./courses";
import { personThread } from "./inbound-messages";
import { inboundMessages, shops } from "./schema";
import { offsetUpcomingTripsWithCounts } from "./trips";

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

/** The departures a draft may quote: the next two weeks, as many as a desk would read out. */
const FACT_DEPARTURES = 30;
const FACT_HORIZON_DAYS = 14;

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
        ne(inboundMessages.channel, "page"),
      ),
    )
    .limit(1);
  if (!row?.body.trim()) return;
  if (!(await assistsAvailable(db, shopId, options))) return;
  const value = await runAssist(db, {
    ...options,
    shopId,
    feature: "inbox_sort",
    call: inboundTriageCall({ subject: row.subject, body: row.body, targetLocale: row.locale }),
  });
  // A call that ran and found nothing usable still counts as read: asking
  // again on every view would spend the shop's cap on the same answer.
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
    .where(and(eq(inboundMessages.shopId, shopId), eq(inboundMessages.id, messageId)));
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

/** The shop's facts a reply may quote, one line each, in the shop's own words and currency. */
export async function replyFacts(
  db: AppDb,
  shopId: string,
  now: Date = nowDate(),
): Promise<string[]> {
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
    })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  if (!shop) return [];
  const horizon = new Date(now.getTime() + FACT_HORIZON_DAYS * 24 * 60 * 60 * 1000);
  const [upcoming, courses] = await Promise.all([
    offsetUpcomingTripsWithCounts(db, shopId, { limit: FACT_DEPARTURES, now, monthEnd: horizon }),
    listActiveCourses(db, shopId),
  ]);
  const money = (cents: number | null | undefined) =>
    cents == null ? "price on request" : formatMoneyCents(cents, shop.currency, shop.locale);
  const lines = [
    `Shop: ${shop.name}. Times are local (${shop.timezone}).`,
    `Desk hours: ${deskTimeValue(shop.opens)} to ${deskTimeValue(shop.closes)} daily.`,
  ];
  if (shop.phone) lines.push(`Phone: ${shop.phone}`);
  lines.push("Departures:");
  for (const trip of upcoming.trips) {
    const seats = spotsRemaining(seatsOnSale(trip));
    lines.push(
      `- ${formatShortDate(trip.startsAt, shop.locale, shop.timezone)} ${formatTime(trip.startsAt, shop.locale, shop.timezone)}, ${trip.title}: ${seats === 0 ? "full" : `${seats} seats open`}, ${money(trip.priceCents ?? trip.course?.priceCents)}`,
    );
  }
  if (upcoming.trips.length === 0) lines.push("- none scheduled in the next two weeks");
  if (courses.length > 0) {
    lines.push("Courses:");
    for (const course of courses) lines.push(`- ${course.title}: ${money(course.priceCents)}`);
  }
  if (shop.rentalTerms?.trim()) lines.push(`Rental terms: ${shop.rentalTerms.trim()}`);
  return lines;
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
  const { shopId, personId } = input;
  if (!(await assistsAvailable(db, shopId, input))) return null;
  const entries = await personThread(db, shopId, personId);
  const thread: ThreadLine[] = entries
    .filter((entry) => entry.direction === "outbound" || entry.message.channel !== "page")
    .map((entry) =>
      entry.direction === "inbound"
        ? { from: "diver" as const, text: entry.message.body }
        : { from: "shop" as const, text: entry.reply.body },
    )
    .filter((line) => line.text.trim())
    .slice(-DRAFT_THREAD_LINES);
  if (thread.at(-1)?.from !== "diver") return null;
  const facts = await replyFacts(db, shopId, input.now);
  const value = await runAssist(db, {
    ...input,
    feature: "inbox_draft",
    call: replyDraftCall({ facts, thread }),
  });
  return value ? groundedReply(value, { facts, thread }) : null;
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
