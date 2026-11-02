"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  setBookingDietaryNote,
  setBookingDiveIntent,
  setBookingHotelPickup,
  setBookingLastDived,
  setBookingReEntryAsk,
} from "@/db/bookings";
import { saveHelpRequest } from "@/db/help-requests";
import { saveRentalFitNote } from "@/db/rental-fit";
import { clearBookingRunningLate, markBookingRunningLate } from "@/db/running-late";
import { setWelcomeConsent } from "@/db/welcome-cues";
import { nowDate } from "@/lib/clock";
import { DIVE_INTENTS } from "@/lib/dive-intent";
import { DIVE_RECENCY_BANDS } from "@/lib/dive-recency";
import { cleanDietaryNote, DIETARY_NOTE_MAX } from "@/lib/lunch-aboard";
import { revalidateAndRedirect } from "@/lib/navigation";
import { isDiver } from "@/lib/participant-types";
import { RE_ENTRY_ASKS, reEntryOffersFor } from "@/lib/re-entry";
import { WELCOME_HELLOS } from "@/lib/welcome-cue";
import { base, bounceTarget, contextFor } from "./action-helpers";

/**
 * **Day-of details, one form and one Save** (third UX review, item 24).
 *
 * It was six forms with six Save buttons, so a diver who answered all six and
 * tapped the last Save kept one answer. Every question now posts together, and
 * each is written **only when its answer changed**: a question left as it was
 * is not rewritten, so a help request the crew already acknowledged keeps its
 * status, and an empty select ("Choose one") means "not answered", never a
 * blank. Each write is still its own guarded column write, so answering one
 * cannot blank another, and the sizes in the gear step are never touched.
 *
 * Every gate is re-derived here, never trusted from the post:
 *
 * - **Who.** The booking comes from the verified capability, never the form.
 * - **What fits the seat.** A seat that is not diving is not asked when it
 *   last dived, what the dive is for, or for a refresher (ADR
 *   20261007-participant-types), and a post that says so anyway is ignored.
 * - **D18's offers** (ADR 20260904-reef-all-the-way-down): an ask is taken
 *   only while `reEntryOffersOpen` (the saved intent and the window), only if
 *   this same post did not move the intent off `easing_back`, and only from
 *   `reEntryOffersFor`, which drops `refresher_course` for a shop that
 *   publishes no refresher.
 * - **A held seat** (`identityHeld`) writes nothing to the diver's record: the
 *   note and the welcome word are about the person, so they wait, as their own
 *   actions refused before.
 * - **The welcome word** (issue #1182, D22) is written only when the page
 *   offered it (`welcomeAsked`), and withdrawing is the same box unticked.
 */
const dayOfSchema = z.object({
  lastDivedBand: z.union([z.enum(DIVE_RECENCY_BANDS), z.literal("")]).optional(),
  diveIntent: z.union([z.enum(DIVE_INTENTS), z.literal("")]).optional(),
  reEntryAsk: z.enum(RE_ENTRY_ASKS).optional(),
  note: z.string().trim().max(300).optional(),
  hotelPickupLocation: z.string().trim().max(300).optional(),
  dietaryNote: z.string().trim().max(DIETARY_NOTE_MAX).optional(),
  kind: z.enum(["carry_gear", "first_timer", "find_group", "none"]).optional(),
  welcomeAsked: z.literal("1").optional(),
  welcomeShare: z.literal("on").optional(),
  welcomeHello: z.union([z.enum(WELCOME_HELLOS), z.literal("")]).optional(),
});

export async function saveDayOfDetailsFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  const parsed = dayOfSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=day-of`);
  const answers = parsed.data;
  const { data } = ctx;
  const shopId = data.shop.id;
  const bookingId = ctx.bookingId;
  const diving = isDiver(data.participantType);
  const writes: Array<Promise<boolean>> = [];

  if (diving && answers.lastDivedBand && answers.lastDivedBand !== data.lastDivedBand) {
    writes.push(setBookingLastDived(ctx.db, { shopId, bookingId, band: answers.lastDivedBand }));
  }
  const intent = diving && answers.diveIntent ? answers.diveIntent : null;
  if (intent && intent !== data.diveIntent) {
    writes.push(setBookingDiveIntent(ctx.db, { shopId, bookingId, intent }));
  }
  if (
    diving &&
    answers.reEntryAsk &&
    answers.reEntryAsk !== data.reEntryAsk &&
    data.reEntryOffersOpen &&
    (intent === null || intent === "easing_back") &&
    reEntryOffersFor(data.refresherCourseOffered).includes(answers.reEntryAsk)
  ) {
    writes.push(setBookingReEntryAsk(ctx.db, { shopId, bookingId, ask: answers.reEntryAsk }));
  }
  // Only a shop that runs pickups asks, and the server, not the hidden field,
  // is what keeps a hand-made post from storing one (security review N5).
  if (answers.hotelPickupLocation !== undefined && data.offersHotelPickup) {
    const location = answers.hotelPickupLocation || null;
    if (location !== (data.hotelPickupLocation ?? null)) {
      writes.push(
        setBookingHotelPickup(ctx.db, { shopId, bookingId, hotelPickupLocation: location }),
      );
    }
  }
  // Asked only on a departure that serves lunch aboard, and the server, not
  // the form, is what keeps a hand-made post from storing one elsewhere.
  if (answers.dietaryNote !== undefined && data.lunchAboard) {
    const note = cleanDietaryNote(answers.dietaryNote);
    if (note !== (data.dietaryNote ?? null)) {
      writes.push(setBookingDietaryNote(ctx.db, { shopId, bookingId, note }));
    }
  }
  if (!data.identityHeld) {
    if (answers.note !== undefined && answers.note !== (data.rentalFit?.note ?? "")) {
      writes.push(
        saveRentalFitNote(ctx.db, { shopId, personId: data.person.id, note: answers.note }).then(
          Boolean,
        ),
      );
    }
    if (answers.welcomeAsked && data.welcomeOffer) {
      const shared = answers.welcomeShare === "on";
      // The word that goes with the yes (#2425): kept only with the yes, so an
      // unticked box clears it in the write. The thread no longer asks for it
      // (visual review 2026-10-24, B27: the day-of step asks one question,
      // the crew note), so a save without the field leaves a word already on
      // file where it was rather than clearing it.
      const hello =
        shared && data.welcomeOffer.kind === "first_trip"
          ? answers.welcomeHello === undefined
            ? data.welcomeHello
            : answers.welcomeHello || null
          : null;
      if (shared !== data.welcomeShared || (shared && hello !== data.welcomeHello)) {
        writes.push(
          setWelcomeConsent(ctx.db, { shopId, bookingId, shared, hello }).then(
            (result) => result.ok,
          ),
        );
      }
    }
  }
  // Last, and alone: the one write with a refusal of its own to report.
  let helpHandled = false;
  const currentHelp = data.helpRequest?.kind ?? "none";
  if (answers.kind && answers.kind !== currentHelp) {
    const result = await saveHelpRequest(ctx.db, { shopId, bookingId, kind: answers.kind });
    if (!result.ok && result.reason === "handled") helpHandled = true;
    else writes.push(Promise.resolve(result.ok));
  }
  const saved = (await Promise.all(writes)).every(Boolean);
  if (helpHandled) revalidateAndRedirect(base(token), `${base(token)}?error=help-handled`);
  revalidateAndRedirect(base(token), `${base(token)}?${saved ? "saved=day-of" : "error=day-of"}`);
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
 * **Taking "running late" back** (third UX review, item 26): the second tap
 * on the same control. A closed seat (checked in, the boat gone) keeps its
 * record and the page simply reloads, since the block is no longer drawn.
 */
export async function clearRunningLateAction(token: string) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  await clearBookingRunningLate(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
    now: nowDate(),
  });
  revalidateAndRedirect(base(token));
}
