"use server";

import { redirect } from "next/navigation";
import { uploadRecapPhotos } from "@/app/recap/[token]/photo-upload";
import { signRecapToken } from "@/lib/recap-links";
import { bounceTarget, contextFor } from "./action-helpers";

/**
 * **A recap photo from the diver's own readiness link, the one door that may
 * share it with the boat** (H-129; security review of layer r5-4, F3).
 *
 * The verified readiness token names the booking, and a held seat shares
 * nothing (its holder may not be the person whose name the photo would carry).
 * The upload itself is the recap's own (`uploadRecapPhotos`), bound to a recap
 * token minted for that booking, so it lands where every recap action lands:
 * on `/recap/<token>`, which renders this same surface. The forwardable recap
 * link's own upload never honors the tick.
 */
export async function uploadRecapPhotoFromReadyAction(token: string, formData: FormData) {
  const context = await contextFor(token);
  if (!context.ok) redirect(bounceTarget(token, context.reason));
  if (context.data.identityHeld) redirect(bounceTarget(token, "invalid"));
  await uploadRecapPhotos(signRecapToken(context.bookingId), formData, {
    // The sharer's own tick, off unless sent: only the literal "on" a checkbox
    // posts shares a photo with the rest of the boat.
    shareWithBoat: formData.get("shareWithBoat") === "on",
  });
}
