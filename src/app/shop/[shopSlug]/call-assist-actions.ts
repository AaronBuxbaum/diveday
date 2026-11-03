"use server";

import { CALL_NOTE_MAX, type CallNoteReading } from "@/components/assists/call-note";
import { bookingAskFromNote } from "@/db/booking-ask-assists";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { requireShopSurface } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";

/** The Took-a-call note's own limit (`callSchema.message`). */
const NOTE_MAX = 1_500;

/**
 * **The call scribble, read into the Took-a-call form** (ADR
 * 20261018-claude-assists; the `call-note` assist). Answers the form's fields
 * for the browser to fill, and writes nothing: the call is logged by
 * `tookACallAction` once the staffer has read the form. The note field gets
 * the scribble verbatim, with the callback time Claude found after it. The
 * shop is the session's, whatever slug the form carried.
 */
export async function readCallNoteAction(
  shopSlug: string,
  text: string,
): Promise<CallNoteReading | null> {
  if (typeof text !== "string" || !text.trim() || text.length > CALL_NOTE_MAX) return null;
  const { db, shop } = await requireShopSurface(shopSlug);
  const ask = await bookingAskFromNote(db, { shopId: shop.id, text });
  if (!ask) return null;
  const t = staffTranslator(await requestLocale(shop.defaultLocale));
  const scribble = text.trim();
  const withCallback = ask.callback
    ? `${scribble}\n${t("assistsFront.callNote.callback", { when: ask.callback })}`
    : scribble;
  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(ask.fields)) if (value) fields[name] = value;
  fields.message = withCallback.length <= NOTE_MAX ? withCallback : scribble;
  return {
    fields,
    match: ask.match
      ? { name: ask.match.name, href: shopPath(shopSlug, "divers", ask.match.id) }
      : null,
  };
}
