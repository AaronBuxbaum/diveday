import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { recordDiverOwnLocaleForBooking } from "@/db/people";
import {
  addRecapPhoto,
  canAddRecapPhoto,
  isRecapOpen,
  MAX_RECAP_PHOTOS_PER_BOOKING,
} from "@/db/recap";
import { requestFirstHandLocale } from "@/i18n/request";
import { parseForm } from "@/lib/form-parse";
import { revalidateAndRedirect } from "@/lib/navigation";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { verifyRecapToken } from "@/lib/recap-links";
import { clientIp } from "@/lib/request-ip";
import { deleteStoredImage, storeRecapImage } from "@/lib/storage";

/**
 * The recap photo upload, shared by the two doors that take one: the recap
 * link's own action (`actions.ts`) and the readiness link's
 * (`ready/[token]/recap-photo-actions.ts`), which alone may share with the
 * boat. Not a `"use server"` module: nothing here is callable from the client.
 */

/** A photo's caption; the photos themselves are read with `getAll` below. */
const captionForm = z.object({ caption: z.string().default("") });

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
 *
 * `shareWithBoat` is the caller's to decide, never the form's alone: the
 * recap link passes false whatever was posted, and only the readiness link's
 * action passes the diver's tick through (security review r5-4, F3).
 */
export async function uploadRecapPhotos(
  token: string,
  formData: FormData,
  options: { shareWithBoat: boolean },
): Promise<void> {
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
  const captionParse = parseForm(captionForm, formData);
  const caption = captionParse.ok ? captionParse.data.caption : "";
  const { shareWithBoat } = options;
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
  // A recap the page would not show takes no photo either (security review of
  // #2123): a held recap, a held seat, a diver left at the dock.
  if (!(await isRecapOpen(db, bookingId))) redirect(`${back}?photo=cancelled`);
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

    const result = await addRecapPhoto(db, {
      bookingId,
      imageUrl: stored.url,
      caption,
      shareWithBoat,
    });
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
    revalidateAndRedirect(back, `${back}?photo=added`);
  }
  if (unconfigured) redirect(`${back}?photo=unconfigured`);
  if (hitCancelled) redirect(`${back}?photo=cancelled`);
  if (hitLimit) redirect(`${back}?photo=limit`);
  redirect(`${back}?photo=error`);
}
