"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { addRecapPhoto } from "@/db/recap";
import { verifyRecapToken } from "@/lib/recap-links";
import { storeRecapImage } from "@/lib/storage";

/**
 * A diver attaches a photo to their own recap. The only credential is the
 * signed recap token already in the URL — it resolves to the booking the photo
 * scopes to, and shop/trip are derived from that booking, never trusted from the
 * form. The image goes through the shared storage seam; an unconfigured provider
 * or a rejected file surfaces as a notice rather than a silent no-op.
 */
export async function uploadRecapPhotoAction(token: string, formData: FormData) {
  const back = `/recap/${token}`;
  const bookingId = verifyRecapToken(token);
  if (!bookingId) redirect(`${back}?photo=error`);
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) redirect(`${back}?photo=none`);
  const caption = String(formData.get("caption") ?? "");

  const stored = await storeRecapImage({
    filename: file.name,
    contentType: file.type,
    bytes: await file.arrayBuffer(),
  });
  if (stored.status !== "stored") {
    redirect(`${back}?photo=${stored.status === "not_configured" ? "unconfigured" : "error"}`);
  }

  const result = await addRecapPhoto(await getDb(), {
    bookingId,
    imageUrl: stored.url,
    caption,
  });
  if (!result.ok) {
    redirect(`${back}?photo=${result.reason === "limit" ? "limit" : "error"}`);
  }
  revalidatePath(back);
  redirect(`${back}?photo=added`);
}
