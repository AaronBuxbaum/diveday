"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { recordDiverOwnLocaleForBooking } from "@/db/people";
import { isRecapOpen, unshareRecapPhoto } from "@/db/recap";
import { parseRecapPulseCategories, submitRecapPulse } from "@/db/recap-pulses";
import { submitTripReview } from "@/db/reviews";
import { getTipCurrencyForBooking, startTipCheckout, tipBoundsCents } from "@/db/tips";
import { diverTranslator } from "@/i18n/messages";
import { requestFirstHandLocale, requestLocale } from "@/i18n/request";
import { parseForm } from "@/lib/form-parse";
import { majorToMinor } from "@/lib/money";
import { revalidateAndRedirect } from "@/lib/navigation";
import { publicAppUrl } from "@/lib/notifications";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { verifyRecapToken } from "@/lib/recap-links";
import { clientIp } from "@/lib/request-ip";
import { parseReviewRating } from "@/lib/reviews";
import { uploadRecapPhotos } from "./photo-upload";

/** A review: the rating is narrowed by `parseReviewRating`, the comment by the writer. */
const reviewForm = z.object({ rating: z.string().optional(), comment: z.string().default("") });
/** A pulse's note; its categories are read with `getAll` below. */
const pulseNoteForm = z.object({ note: z.string().default("") });

/** "Stop sharing": the one photo id; the booking is the token's, never the form's. */
const unshareForm = z.object({ photoId: z.uuid() });

/** The tip form: a preset radio, and an "Other" box that wins when filled. */
const tipForm = z.object({
  customAmount: z.string().default(""),
  amount: z.string().optional(),
});

/**
 * A diver attaches one or more photos to their own recap from the recap link
 * (`uploadRecapPhotos` holds the gate). **Never shared with the boat from
 * here** (security review of layer r5-4, F3): this link is signed for 180
 * days, cannot be revoked and is written to be forwarded, so a posted share
 * tick is ignored and the photos stay on this diver's recap. Sharing goes
 * through the diver's own readiness link (`ready/[token]/recap-photo-actions.ts`).
 */
export async function uploadRecapPhotoAction(token: string, formData: FormData) {
  await uploadRecapPhotos(token, formData, { shareWithBoat: false });
}

/**
 * **A diver takes a photo they shared back from the boat** (issue #2806; ADR
 * 20261016-shared-boat-photos, Consequences). The photo stays on their own
 * recap and leaves every other seat's.
 *
 * The signed recap token is the only credential and names the booking; the
 * form names only the photo, and `unshareRecapPhoto` clears it only when that
 * booking uploaded it, so a crafted post naming another diver's photo changes
 * nothing. The `/ready` after-state binds this same action to a recap token
 * minted for its booking. Withdrawing is the safe direction, so unlike sharing
 * it is allowed through the forwardable recap link, and it is not refused for
 * a recap that is no longer open.
 *
 * Rate-limited by IP before the token is verified (CR-013), then per booking.
 */
export async function unshareRecapPhotoAction(token: string, formData: FormData) {
  const back = `/recap/${token}`;
  const ip = await clientIp();
  if (
    !(await checkRateLimit(rateLimitKey("recap-unshare-ip", ip), RATE_LIMITS.recapUnshareByIp))
      .allowed
  ) {
    redirect(`${back}?photo=error`);
  }
  const bookingId = verifyRecapToken(token);
  if (!bookingId) redirect(`${back}?photo=error`);
  if (
    !(
      await checkRateLimit(
        rateLimitKey("recap-unshare-booking", bookingId),
        RATE_LIMITS.recapUnshareByToken,
      )
    ).allowed
  ) {
    redirect(`${back}?photo=error`);
  }
  const parsed = parseForm(unshareForm, formData);
  if (!parsed.ok) redirect(`${back}?photo=error`);

  const outcome = await unshareRecapPhoto(await getDb(), {
    bookingId,
    photoId: parsed.data.photoId,
  }).catch(() => null);
  if (!outcome?.ok) redirect(`${back}?photo=error`);
  revalidateAndRedirect(back, `${back}?photo=unshared`);
}

/**
 * A diver leaves a tip from their own recap. Same authorization shape as the
 * photo upload above — the signed token is the only credential, and
 * `startTipCheckout` derives shop identity from the booking it resolves to,
 * never from anything the form itself supplies (docs ADR
 * 20260726-post-trip-tipping).
 */
export async function startTipAction(token: string, formData: FormData) {
  const back = `/recap/${token}`;
  const ip = await clientIp();
  if (!(await checkRateLimit(rateLimitKey("recap-tip-ip", ip), RATE_LIMITS.tipStart)).allowed) {
    redirect(`${back}?tip=error`);
  }
  const bookingId = verifyRecapToken(token);
  if (!bookingId) redirect(`${back}?tip=error`);
  if (
    !(await checkRateLimit(rateLimitKey("recap-tip-booking", bookingId), RATE_LIMITS.tipStart))
      .allowed
  ) {
    redirect(`${back}?tip=error`);
  }

  // A typed "Other" amount wins over a preset radio when both are present —
  // the two fields are named separately (rather than sharing "amount") so a
  // custom value can never be shadowed by whichever preset happens to be
  // checked in DOM order.
  //
  // A form that is not two strings reads as no amount at all, which the bounds
  // check below refuses as `invalid` — exactly where a non-number lands.
  const parsed = parseForm(tipForm, formData);
  const typed = parsed.ok
    ? Number(parsed.data.customAmount.trim() || parsed.data.amount)
    : Number.NaN;

  const db = await getDb();
  if (!(await isRecapOpen(db, bookingId))) redirect(`${back}?tip=error`);
  // The diver types a major-unit amount ("20"); what gets charged is an integer
  // count of the *shop currency's* minor unit. The conversion is the currency's
  // own, never a literal 100 — a ¥ tip of 20 is 20, not 2000 (docs ADR
  // 20260731-shop-currency). The currency comes from the booking, never from
  // the form. `startTipCheckout` re-derives and re-checks both, so a caller
  // that skipped this can't push an out-of-bounds amount through.
  const currency = await getTipCurrencyForBooking(db, bookingId);
  if (!currency) redirect(`${back}?tip=error`);
  const amountCents = Number.isFinite(typed) ? majorToMinor(typed, currency) : Number.NaN;
  const { minCents, maxCents } = tipBoundsCents(currency);
  if (!Number.isFinite(amountCents) || amountCents < minCents || amountCents > maxCents) {
    redirect(`${back}?tip=invalid`);
  }

  const origin = publicAppUrl();
  if (!origin) redirect(`${back}?tip=error`);

  const t = diverTranslator(await requestLocale());
  const outcome = await startTipCheckout(db, {
    bookingId,
    amountCents,
    successUrl: `${origin}${back}?tip=paid`,
    cancelUrl: `${origin}${back}?tip=cancelled`,
    // The words on the hosted Stripe line come from the diver's bundle, not
    // from `src/db` (docs ADR 20260731-domain-layer-copy-leaks).
    lineDescription: t("checkoutLine.tip"),
  }).catch(() => null);
  if (!outcome?.ok) redirect(`${back}?tip=error`);
  redirect(outcome.checkoutUrl);
}

/**
 * A diver rates the day they actually dived. The credential is the signed
 * recap token already in the URL — it resolves to the booking, and shop, trip,
 * and person are all derived from that row rather than accepted from the form.
 * That is what makes these reviews verified: there is no way to leave one
 * without having been on the boat (docs ADR 20260729-verified-diver-reviews).
 *
 * Rate-limited by IP before the token is verified, so this also throttles
 * brute-force token guessing rather than only abuse of a known-good link
 * (CR-013, same shape as the photo upload above).
 */
export async function submitReviewAction(token: string, formData: FormData) {
  const back = `/recap/${token}`;
  const ip = await clientIp();
  if (
    !(await checkRateLimit(rateLimitKey("recap-review-ip", ip), RATE_LIMITS.reviewSubmitByIp))
      .allowed
  ) {
    redirect(`${back}?review=error`);
  }
  const bookingId = verifyRecapToken(token);
  if (!bookingId) redirect(`${back}?review=error`);
  if (
    !(
      await checkRateLimit(
        rateLimitKey("recap-review-booking", bookingId),
        RATE_LIMITS.reviewSubmitByToken,
      )
    ).allowed
  ) {
    redirect(`${back}?review=error`);
  }

  const review = parseForm(reviewForm, formData);
  if (!review.ok) redirect(`${back}?review=error`);
  const rating = parseReviewRating(review.data.rating ?? null);
  if (rating === null) redirect(`${back}?review=error`);
  if (!(await isRecapOpen(await getDb(), bookingId))) redirect(`${back}?review=did_not_dive`);

  // Same first-hand signal as the photo upload above (docs ADR
  // 20260731-per-person-notification-locale) — the diver wrote this review
  // themselves, on their own device, through their own link.
  await recordDiverOwnLocaleForBooking(await getDb(), {
    bookingId,
    locale: await requestFirstHandLocale(),
  });

  const outcome = await submitTripReview(await getDb(), {
    bookingId,
    rating,
    comment: review.data.comment,
  }).catch(() => null);
  // A no-show/cancelled booking gets its own truthful notice — "pick a
  // rating and try again" is a lie when the real problem is there was no
  // dive to rate, and repeating the same rating forever would never fix it
  // (task 56).
  if (outcome?.ok === false && outcome.reason === "did_not_dive") {
    redirect(`${back}?review=did_not_dive`);
  }
  if (!outcome?.ok) redirect(`${back}?review=error`);

  revalidateAndRedirect(back, `${back}?review=${outcome.published ? "published" : "pending"}`);
}

/**
 * **A diver tells the shop, and only the shop, what to fix** (D40, issue
 * #1200).
 *
 * Same authorization shape as the review above and for the same reasons: the
 * signed recap token is the only credential, it resolves to a booking, and
 * `submitRecapPulse` derives shop, trip and person from that row rather than
 * accepting any of them from the form. A crafted post naming another shop's
 * trip changes nothing, because nothing in the form is read as identity.
 *
 * Rate-limited by IP **before** the token is verified, so this throttles
 * brute-force token guessing rather than only abuse of a known-good link
 * (CR-013), then per booking.
 *
 * An empty `category` list is the withdrawal — the "Take it back" control posts
 * a form with no checkboxes in it at all (`RecapPulse`), which is why there is
 * no separate intent field to forge.
 */
export async function submitRecapPulseAction(token: string, formData: FormData) {
  const back = `/recap/${token}`;
  const ip = await clientIp();
  if (
    !(await checkRateLimit(rateLimitKey("recap-pulse-ip", ip), RATE_LIMITS.recapPulseByIp)).allowed
  ) {
    redirect(`${back}?pulse=error`);
  }
  const bookingId = verifyRecapToken(token);
  if (!bookingId) redirect(`${back}?pulse=error`);
  if (
    !(
      await checkRateLimit(
        rateLimitKey("recap-pulse-booking", bookingId),
        RATE_LIMITS.recapPulseByToken,
      )
    ).allowed
  ) {
    redirect(`${back}?pulse=error`);
  }

  // Narrowed against the enum here and again in the writer; anything else the
  // form carries is dropped rather than refused, so a stale tab posting a
  // retired code still saves the codes it got right.
  const categories = parseRecapPulseCategories(formData.getAll("category"));
  const noteParse = parseForm(pulseNoteForm, formData);
  if (!(await isRecapOpen(await getDb(), bookingId))) redirect(`${back}?pulse=error`);

  // Same first-hand signal the review and the photo upload record (docs ADR
  // 20260731-per-person-notification-locale) — this diver, their own device,
  // their own link.
  await recordDiverOwnLocaleForBooking(await getDb(), {
    bookingId,
    locale: await requestFirstHandLocale(),
  });

  const outcome = await submitRecapPulse(await getDb(), {
    bookingId,
    categories,
    // A crafted multipart part that is a File reads as no note — the writer
    // trims and caps it, and stores null rather than an empty string.
    note: noteParse.ok ? noteParse.data.note : "",
  }).catch(() => null);
  // Each refusal keeps its own word. "That didn't send, try again" is a lie
  // when the booking never sailed or when nothing was chosen, and both would
  // send the diver round a loop that cannot succeed (task 56's rule).
  if (outcome?.ok === false) {
    const code =
      outcome.reason === "did_not_dive" || outcome.reason === "empty" ? outcome.reason : "error";
    redirect(`${back}?pulse=${code}`);
  }
  if (!outcome?.ok) redirect(`${back}?pulse=error`);

  revalidateAndRedirect(back, `${back}?pulse=${outcome.withdrawn ? "withdrawn" : "saved"}`);
}
