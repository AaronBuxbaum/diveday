"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { recordDiverOwnLocaleForBooking } from "@/db/people";
import { addRecapPhoto, canAddRecapPhoto, MAX_RECAP_PHOTOS_PER_BOOKING } from "@/db/recap";
import { submitTripReview } from "@/db/reviews";
import { getTipCurrencyForBooking, startTipCheckout, tipBoundsCents } from "@/db/tips";
import { diverTranslator } from "@/i18n/messages";
import { requestFirstHandLocale, requestLocale } from "@/i18n/request";
import { majorToMinor } from "@/lib/money";
import { publicAppUrl } from "@/lib/notifications";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { verifyRecapToken } from "@/lib/recap-links";
import { clientIp } from "@/lib/request-ip";
import { parseReviewRating } from "@/lib/reviews";
import { deleteStoredImage, storeRecapImage } from "@/lib/storage";

/**
 * A diver attaches one or more photos to their own recap in a single submit
 * (task 55 — one page reload for a whole pick, not one per photo). The only
 * credential is the signed recap token already in the URL — it resolves to
 * the booking the photos scope to, and shop/trip are derived from that
 * booking, never trusted from the form. The endpoint is public, so the
 * booking/cancelled/cap gate runs *before* bytes are stored (no orphaned blob
 * on a rejected upload), and only a lost race against the cap can leave a
 * stored object — which is then cleaned up best-effort. Every file shares the
 * one caption field the form offers; an unconfigured provider or a rejected
 * file surfaces as a notice.
 */
export async function uploadRecapPhotoAction(token: string, formData: FormData) {
  const back = `/recap/${token}`;
  // Checked before verifying the token, so this also throttles brute-force
  // token guessing, not just abuse of a link already known to be valid
  // (CR-013).
  const ip = await clientIp();
  if (
    !(await checkRateLimit(rateLimitKey("recap-upload-ip", ip), RATE_LIMITS.recapUploadByIp))
      .allowed
  ) {
    redirect(`${back}?photo=error`);
  }
  const bookingId = verifyRecapToken(token);
  if (!bookingId) redirect(`${back}?photo=error`);
  if (
    !(
      await checkRateLimit(
        rateLimitKey("recap-upload-booking", bookingId),
        RATE_LIMITS.recapUploadByToken,
      )
    ).allowed
  ) {
    redirect(`${back}?photo=error`);
  }
  // Bounded to the cap regardless of how many files a crafted request
  // claims — every insert below still re-checks the cap atomically, this
  // just keeps an abusive submit from driving MAX+N storage round trips.
  const files = formData
    .getAll("photo")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0)
    .slice(0, MAX_RECAP_PHOTOS_PER_BOOKING);
  if (files.length === 0) redirect(`${back}?photo=none`);
  const caption = String(formData.get("caption") ?? "");
  const db = await getDb();
  // The recap link is the diver's own, and this is a form they just submitted
  // from their own device — first-hand evidence of the language they read
  // (docs ADR 20260731-per-person-notification-locale).
  await recordDiverOwnLocaleForBooking(db, {
    bookingId,
    locale: await requestFirstHandLocale(),
  });

  // Gate before the expensive side effect: refuse a cancelled/no-show or
  // already-capped booking without ever writing to blob storage. A cancelled
  // booking gets its own notice — "that photo didn't upload, try a smaller
  // file" is a lie when the real reason is there's nothing to add a photo to
  // (task 56).
  const eligibility = await canAddRecapPhoto(db, bookingId);
  if (!eligibility.ok) {
    redirect(
      `${back}?photo=${eligibility.reason === "limit" ? "limit" : eligibility.reason === "cancelled" ? "cancelled" : "error"}`,
    );
  }

  let added = 0;
  let hitLimit = false;
  let hitCancelled = false;
  let unconfigured = false;

  for (const file of files) {
    const stored = await storeRecapImage({
      filename: file.name,
      contentType: file.type,
      bytes: await file.arrayBuffer(),
    });
    if (stored.status !== "stored") {
      if (stored.status === "not_configured") {
        // A shop-wide config gap — the next file in the batch won't fare
        // any differently, so stop trying.
        unconfigured = true;
        break;
      }
      continue; // this one file failed (wrong type/too big); keep trying the rest
    }

    const result = await addRecapPhoto(db, { bookingId, imageUrl: stored.url, caption });
    if (!result.ok) {
      // Only reachable if a concurrent upload filled the cap (or the booking
      // was cancelled) mid-batch — the object we just stored is now
      // orphaned, so clean it up.
      await deleteStoredImage(stored.url);
      if (result.reason === "limit") {
        hitLimit = true;
        break; // no room for the rest of the batch either
      }
      if (result.reason === "cancelled") {
        hitCancelled = true;
        break;
      }
      continue;
    }
    added += 1;
  }

  if (added > 0) {
    revalidatePath(back);
    redirect(`${back}?photo=added`);
  }
  if (unconfigured) redirect(`${back}?photo=unconfigured`);
  if (hitCancelled) redirect(`${back}?photo=cancelled`);
  if (hitLimit) redirect(`${back}?photo=limit`);
  redirect(`${back}?photo=error`);
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
  const custom = String(formData.get("customAmount") ?? "").trim();
  const typed = Number(custom || formData.get("amount"));

  const db = await getDb();
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

  const rating = parseReviewRating(formData.get("rating"));
  if (rating === null) redirect(`${back}?review=error`);

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
    // `normalizeReviewComment` refuses a non-string, but keep the File case
    // from reaching it as a type error at all.
    comment: String(formData.get("comment") ?? ""),
  }).catch(() => null);
  // A no-show/cancelled booking gets its own truthful notice — "pick a
  // rating and try again" is a lie when the real problem is there was no
  // dive to rate, and repeating the same rating forever would never fix it
  // (task 56).
  if (outcome?.ok === false && outcome.reason === "did_not_dive") {
    redirect(`${back}?review=did_not_dive`);
  }
  if (!outcome?.ok) redirect(`${back}?review=error`);

  revalidatePath(back);
  redirect(`${back}?review=${outcome.published ? "published" : "pending"}`);
}
