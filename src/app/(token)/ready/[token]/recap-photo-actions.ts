"use server";

import { redirect } from "next/navigation";
import { uploadRecapPhotos } from "@/app/(token)/recap/[token]/photo-upload";
import { getDb } from "@/db/client";
import { recapTokenFor } from "@/db/recap-links";
import { bounceTarget, contextFor } from "./action-helpers";

/**
 * **A recap photo from the diver's own readiness link, the one door that may
 * share it with the boat** (H-20261014-share-photo-with-boat; security review of layer r5-4, F3).
 *
 * The verified readiness token names the booking, and a held seat shares
 * nothing (its holder may not be the person whose name the photo would carry).
 * Any other readiness link shares, the one a booking redirects to included
 * (#4059).
 * The upload itself is the recap's own (`uploadRecapPhotos`), bound to a recap
 * token minted for that booking, so it lands where every recap action lands:
 * on `/recap/<token>`, which renders this same surface. The forwardable recap
 * link's own upload never honors the tick.
 */
export async function uploadRecapPhotoFromReadyAction(token: string, formData: FormData) {
  const context = await contextFor(token);
  if (!context.ok) redirect(bounceTarget(token, context.reason));
  if (context.data.identityHeld) redirect(bounceTarget(token, "invalid"));
  // At the booking's current recap epoch (issue #3982).
  const recapToken = await recapTokenFor(await getDb(), context.bookingId);
  if (!recapToken) redirect(bounceTarget(token, "invalid"));
  await uploadRecapPhotos(recapToken, formData, {
    // The sharer's own tick, off unless sent: only the literal "on" a checkbox
    // posts shares a photo with the rest of the boat.
    shareWithBoat: formData.get("shareWithBoat") === "on",
  });
}
