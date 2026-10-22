// i18n-exempt-file: the date line a prompt carries is written for Claude, never shown on a page
import { and, eq, isNull } from "drizzle-orm";
import {
  type AskFields,
  type AskSource,
  askFields,
  bookingAskCall,
} from "@/lib/assists/booking-request";
import {
  type CalendarDate,
  calendarDateInTimezone,
  calendarDateWeekday,
} from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { normalizeEmailAddress, normalizePhoneAddress } from "@/lib/inbox";
import { toE164 } from "@/lib/phone";
import { type AssistOptions, assistsAvailable, runAssist } from "./assists";
import type { AppDb } from "./client";
import { matchPersonByAddress } from "./inbound-messages";
import { inboundMessages, people, shops } from "./schema";

/**
 * **A booking ask read into the request form** (ADR 20261018-claude-assists;
 * the `request` and `call-note` assists). The prompt is
 * `src/lib/assists/booking-request.ts`; this reads the text inside the
 * caller's shop, runs it, and answers the Took-a-call form's fields for a
 * staffer to check. Nothing is written here: the request is recorded by the
 * form's own action, after a staffer has read every field.
 */

/** Weekday names for the prompt's date line, Sunday first like `calendarDateWeekday`. */
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type BookingAskResult = {
  fields: AskFields;
  /** When to ring back, in the caller's words, for the note. */
  callback: string | null;
  /** The live diver an address in the text belongs to, for a link to their record. */
  match: { id: string; name: string } | null;
};

async function shopToday(
  db: AppDb,
  shopId: string,
  now: Date,
): Promise<{ date: CalendarDate; line: string } | null> {
  const [shop] = await db
    .select({ timezone: shops.timezone })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  if (!shop) return null;
  const date = calendarDateInTimezone(now, shop.timezone);
  return { date, line: `${date} (${WEEKDAYS[calendarDateWeekday(date)]})` };
}

/** The live diver an email or phone in the fields belongs to, inside this shop. */
async function matchedDiver(
  db: AppDb,
  shopId: string,
  fields: AskFields,
): Promise<{ id: string; name: string } | null> {
  const email = normalizeEmailAddress(fields.email);
  // A number typed at the desk is local ("305 555 0142"); a stored one is
  // E.164. Read it in the shop's own country first, the way the record does.
  const [shop] = await db
    .select({ country: shops.addressCountry })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  const phone = normalizePhoneAddress(
    fields.phone ? (toE164(fields.phone, shop?.country) ?? fields.phone) : null,
  );
  const personId =
    (email ? await matchPersonByAddress(db, shopId, "email", email) : null) ??
    (phone ? await matchPersonByAddress(db, shopId, "sms", phone) : null);
  if (!personId) return null;
  const [person] = await db
    .select({ id: people.id, name: people.fullName })
    .from(people)
    .where(and(eq(people.shopId, shopId), eq(people.id, personId), isNull(people.deletedAt)))
    .limit(1);
  return person ?? null;
}

async function readAsk(
  db: AppDb,
  input: { shopId: string; text: string; source: AskSource; now?: Date } & AssistOptions,
): Promise<BookingAskResult | null> {
  const text = input.text.trim();
  if (!text) return null;
  if (!(await assistsAvailable(db, input.shopId, input))) return null;
  const today = await shopToday(db, input.shopId, input.now ?? nowDate());
  if (!today) return null;
  const value = await runAssist(db, {
    ...input,
    feature: input.source === "email" ? "booking_request" : "call_note",
    call: bookingAskCall({ text, source: input.source, today: today.line }),
  });
  if (!value) return null;
  const fields = askFields(value, today.date);
  return {
    fields,
    callback: value.callback?.trim() || null,
    match: await matchedDiver(db, input.shopId, fields),
  };
}

/** A staffer's scribble from the phone, read into the form. The scribble itself is kept by the form. */
export function bookingAskFromNote(
  db: AppDb,
  input: { shopId: string; text: string; now?: Date } & AssistOptions,
): Promise<BookingAskResult | null> {
  return readAsk(db, { ...input, source: "call" });
}

/** An inbound email or WhatsApp, read into a request. The message is read inside the shop only. */
export async function bookingAskFromMessage(
  db: AppDb,
  input: { shopId: string; messageId: string; now?: Date } & AssistOptions,
): Promise<BookingAskResult | null> {
  const [message] = await db
    .select({
      body: inboundMessages.body,
      from: inboundMessages.fromAddress,
      channel: inboundMessages.channel,
    })
    .from(inboundMessages)
    .where(
      and(
        eq(inboundMessages.shopId, input.shopId),
        eq(inboundMessages.id, input.messageId),
        isNull(inboundMessages.deletedAt),
      ),
    )
    .limit(1);
  if (!message) return null;
  const result = await readAsk(db, { ...input, text: message.body, source: "email" });
  if (!result) return null;
  // The address the message came from is a fact, not a reading: it fills the
  // reply field when the words named none, and never leaves this server.
  const fields = { ...result.fields };
  if (message.channel === "email" && !fields.email) fields.email = message.from;
  if (message.channel !== "email" && !fields.phone) fields.phone = `+${message.from}`;
  return { ...result, fields };
}
