"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  setBookingDiveIntent,
  setBookingHotelPickup,
  setBookingLastDived,
  setBookingReEntryAsk,
} from "@/db/bookings";
import { saveHelpRequest } from "@/db/help-requests";
import { saveRentalFitNote } from "@/db/rental-fit";
import { markBookingRunningLate } from "@/db/running-late";
import { setWelcomeConsent } from "@/db/welcome-cues";
import { nowDate } from "@/lib/clock";
import { DIVE_INTENTS } from "@/lib/dive-intent";
import { DIVE_RECENCY_BANDS } from "@/lib/dive-recency";
import { revalidateAndRedirect } from "@/lib/navigation";
import { RE_ENTRY_ASKS, reEntryOffersFor } from "@/lib/re-entry";
import { base, bounceTarget, contextFor, refuseWhileHeld } from "./action-helpers";

/**
 * The diver's own words to the crew, saved on their own.
 *
 * Its own action rather than a field of `saveFitFromReady` (issue 627): the
 * note is a question of its own on the page now, and `saveRentalFitNote` writes
 * the note column alone — so answering it cannot blank sizes the diver set on a
 * different day, and saving sizes cannot blank the note.
 */
const noteSchema = z.object({ note: z.string().trim().max(300) });

export async function saveNoteFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  refuseWhileHeld(token, ctx.data);
  const parsed = noteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=note`);
  const saved = await saveRentalFitNote(ctx.db, {
    shopId: ctx.data.shop.id,
    personId: ctx.data.person.id,
    note: parsed.data.note,
  });
  revalidateAndRedirect(base(token), `${base(token)}?${saved ? "saved=note" : "error=note"}`);
}

const hotelPickupSchema = z.object({
  hotelPickupLocation: z.string().trim().max(300),
});

export async function saveHotelPickupLocationFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  const parsed = hotelPickupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=pickup`);
  const location = parsed.data.hotelPickupLocation || null;
  const saved = await setBookingHotelPickup(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
    hotelPickupLocation: location,
  });
  revalidateAndRedirect(base(token), `${base(token)}?${saved ? "saved=pickup" : "error=pickup"}`);
}

const helpRequestSchema = z.object({
  kind: z.enum(["carry_gear", "first_timer", "find_group", "none"]),
});

/** Capture one small day-of request and let the shop visibly settle it. */
export async function saveHelpRequestFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  const parsed = helpRequestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=help`);
  const result = await saveHelpRequest(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
    kind: parsed.data.kind,
  });
  if (!result.ok) {
    revalidateAndRedirect(
      base(token),
      `${base(token)}?error=${result.reason === "handled" ? "help-handled" : "help"}`,
    );
  }
  revalidateAndRedirect(base(token), `${base(token)}?saved=help`);
}

const welcomeConsentSchema = z.object({ share: z.enum(["on", "off"]) });

/**
 * **Tell the crew, or take it back** (issue #1182, delight report D22).
 *
 * The only writer of `bookings.welcome_shared_at` anywhere in the app: staff
 * have no door to it, because a cue a shop switched on about a diver is the
 * profile badge D22's boundary refuses. Both directions are one action —
 * withdrawing has to be exactly as easy as consenting, which is Budget rule 6's
 * "the way back" made a button rather than a sentence.
 */
export async function saveWelcomeConsentFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  refuseWhileHeld(token, ctx.data);
  const parsed = welcomeConsentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=welcome`);
  const result = await setWelcomeConsent(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
    shared: parsed.data.share === "on",
  });
  if (!result.ok) {
    revalidateAndRedirect(base(token), `${base(token)}?error=welcome`);
  }
  // No success notice, unlike every other action on this page. The block's own
  // line says what the answer now is, and it keeps saying it on a reload — a
  // banner reading "Saved." above a form that already states the standing
  // answer is the second confirmation, not the first.
  revalidateAndRedirect(base(token));
}

/**
 * **"Running late"** (J3): the diver tells the shop from their own link. Not
 * refused on a held seat — it says nothing about the diver record, only that
 * whoever holds this seat is on the way. The write re-checks the window, so a
 * stale page tapped after check-in or after the boat sailed changes nothing.
 */
export async function sayRunningLateAction(token: string) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  const outcome = await markBookingRunningLate(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
    now: nowDate(),
  });
  if (outcome.status === "closed") {
    revalidateAndRedirect(base(token), `${base(token)}?error=late`);
  }
  // No banner: the block's own line now says what was said and when.
  revalidateAndRedirect(base(token));
}

/**
 * **How recently the diver says they last dived** (ADR
 * 20260821-currency-is-what-catches-people).
 *
 * The one question on this page whose answer nothing checks and nothing gates —
 * it is shown to the crew and that is the whole of it. Validated against the
 * pgEnum's own tuple rather than a hand-written list, so widening the bands can
 * never leave this refusing an answer the column accepts (the same rule
 * `certificationSchema` follows for agency and level).
 *
 * There is no "prefer not to say" value to post: that answer is simply not
 * submitting the form, which is the state every booking is in already.
 */
const diveRecencySchema = z.object({
  lastDivedBand: z.enum(DIVE_RECENCY_BANDS),
});

/**
 * **What this dive is for, changed after the booking** (ADR
 * 20260904-reef-all-the-way-down, D12).
 *
 * The booking form promises "change it any time from the link we send you";
 * this is that link. It also reaches the divers who never saw the booking form
 * at all — a party member, a walk-in a staffer seated — which is the argument
 * ADR 20260821-currency-is-what-catches-people already made for putting the
 * recency question here.
 *
 * Validated against the pgEnum's own tuple, like the band below it, and there
 * is no "prefer not to say" value to post: that answer is not submitting the
 * form, which is the state every booking is in already.
 */
const diveIntentSchema = z.object({
  diveIntent: z.enum(DIVE_INTENTS),
});

export async function saveDiveIntentFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  const parsed = diveIntentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=dive-intent`);

  // The booking comes from the verified capability, never from the form: a
  // bearer of this token can only ever answer for its own seat.
  const saved = await setBookingDiveIntent(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
    intent: parsed.data.diveIntent,
  });
  if (!saved) redirect(`${base(token)}?error=dive-intent`);
  revalidateAndRedirect(base(token), `${base(token)}?saved=dive-intent`);
}

/**
 * **What would help, from a diver easing back in** (ADR
 * 20260904-reef-all-the-way-down, D18).
 *
 * **Every gate is re-derived here, never trusted from the post** — the same
 * rule the nitrox request follows. All three are `getReadyPageData`'s own, so
 * what this accepts is exactly what the page offered:
 *
 * - the saved intent is `easing_back`, so an ask cannot arrive without the
 *   answer that opens it;
 * - the departure is more than a day out, because inside 24 hours nobody at
 *   the shop can act on an ask and a request recorded then would read to the
 *   crew as one somebody could have;
 * - and the ask is one of `reEntryOffersFor`, which drops `refresher_course`
 *   for a shop that publishes no refresher. That third gate was missing until
 *   review of PR #1416: the page filtered the option out, so a crafted post —
 *   or an ordinary one from a page rendered before the shop deactivated its
 *   refresher course — recorded an offer the shop could not make.
 */
const reEntryAskSchema = z.object({
  reEntryAsk: z.enum(RE_ENTRY_ASKS),
});

export async function saveReEntryAskFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  const parsed = reEntryAskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=re-entry-ask`);
  // `reEntryOffersOpen` is the saved intent and the window together, resolved
  // by the same read the page rendered from; `refresherCourseOffered` is the
  // third. Both are read fresh on this request, so a shop that switched its
  // refresher off a minute ago is answered as it is now.
  if (
    !ctx.data.reEntryOffersOpen ||
    !reEntryOffersFor(ctx.data.refresherCourseOffered).includes(parsed.data.reEntryAsk)
  ) {
    redirect(`${base(token)}?error=re-entry-ask`);
  }

  const saved = await setBookingReEntryAsk(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
    ask: parsed.data.reEntryAsk,
  });
  if (!saved) redirect(`${base(token)}?error=re-entry-ask`);
  revalidateAndRedirect(base(token), `${base(token)}?saved=re-entry-ask`);
}

export async function saveDiveRecencyFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  const parsed = diveRecencySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=last-dived`);

  // The booking comes from the verified capability, never from the form: a
  // bearer of this token can only ever answer for its own seat.
  const saved = await setBookingLastDived(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
    band: parsed.data.lastDivedBand,
  });
  if (!saved) redirect(`${base(token)}?error=last-dived`);
  revalidateAndRedirect(base(token), `${base(token)}?saved=last-dived`);
}
