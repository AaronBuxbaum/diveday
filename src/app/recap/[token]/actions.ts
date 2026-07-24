"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { addRecapPhoto, canAddRecapPhoto } from "@/db/recap";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { verifyRecapToken } from "@/lib/recap-links";
import { clientIp } from "@/lib/request-ip";
import { deleteStoredImage, storeRecapImage } from "@/lib/storage";

/**
 * A diver attaches a photo to their own recap. The only credential is the
 * signed recap token already in the URL — it resolves to the booking the photo
 * scopes to, and shop/trip are derived from that booking, never trusted from the
 * form. The endpoint is public, so the booking/cancelled/cap gate runs *before*
 * bytes are stored (no orphaned blob on a rejected upload), and only a lost race
 * against the cap can leave a stored object — which is then cleaned up
 * best-effort. An unconfigured provider or a rejected file surfaces as a notice.
 */
export async function uploadRecapPhotoAction(token: string, formData: FormData) {
  const back = `/recap/${token}`;
  // Checked before verifying the token, so this also throttles brute-force
  // token guessing, not just abuse of a link already known to be valid
  // (CR-013).
  const ip = await clientIp();
  if (!checkRateLimit(rateLimitKey("recap-upload-ip", ip), RATE_LIMITS.recapUploadByIp).allowed) {
    redirect(`${back}?photo=error`);
  }
  const bookingId = verifyRecapToken(token);
  if (!bookingId) redirect(`${back}?photo=error`);
  if (
    !checkRateLimit(rateLimitKey("recap-upload-booking", bookingId), RATE_LIMITS.recapUploadByToken)
      .allowed
  ) {
    redirect(`${back}?photo=error`);
  }
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) redirect(`${back}?photo=none`);
  const caption = String(formData.get("caption") ?? "");
  const db = await getDb();

  // Gate before the expensive side effect: refuse a cancelled or capped booking
  // without ever writing to blob storage.
  const eligibility = await canAddRecapPhoto(db, bookingId);
  if (!eligibility.ok) {
    redirect(`${back}?photo=${eligibility.reason === "limit" ? "limit" : "error"}`);
  }

  const stored = await storeRecapImage({
    filename: file.name,
    contentType: file.type,
    bytes: await file.arrayBuffer(),
  });
  if (stored.status !== "stored") {
    redirect(`${back}?photo=${stored.status === "not_configured" ? "unconfigured" : "error"}`);
  }

  const result = await addRecapPhoto(db, { bookingId, imageUrl: stored.url, caption });
  if (!result.ok) {
    // Only reachable if a concurrent upload filled the cap after the pre-check —
    // the object we just stored is now orphaned, so clean it up.
    await deleteStoredImage(stored.url);
    redirect(`${back}?photo=${result.reason === "limit" ? "limit" : "error"}`);
  }
  revalidatePath(back);
  redirect(`${back}?photo=added`);
}
