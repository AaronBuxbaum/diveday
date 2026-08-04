"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { checkInBooking } from "@/db/check-in";
import { getDb } from "@/db/client";
import { recordInPersonWaiver } from "@/db/waivers";
import { requireStaffSession } from "@/lib/session";

export async function checkInAction(shopSlug: string, formData: FormData) {
  const session = await requireStaffSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  const back = `/shop/${shopSlug}/check-in`;
  if (!bookingId) redirect(`${back}?notice=invalid`);

  const outcome = await checkInBooking(await getDb(), {
    shopId: session.user.shopId,
    bookingId,
    recordedByPersonId: session.user.personId,
  });
  revalidatePath(back);
  if (outcome.ok) {
    redirect(`${back}?notice=${outcome.duplicate ? "already_checked_in" : "checked_in"}`);
  }
  // `not_ready` carries the diver's booking/trip so the notice can link
  // straight to their guest row instead of just naming the problem.
  if (outcome.reason === "not_ready" && outcome.tripId) {
    redirect(`${back}?notice=not_ready&bid=${bookingId}&tid=${outcome.tripId}`);
  }
  redirect(`${back}?notice=${outcome.reason}`);
}

/**
 * The counter's version of the roster's "signed on paper" control — the diver
 * is standing right here holding the release, and until now the only way to
 * clear that blocker was to leave the queue for their trip's guest list.
 *
 * Same single write path as the roster (`recordInPersonWaiver`), so the record
 * is the same immutable, staff-attested one however it was reached; the
 * medical attestation is required there, not here, and a missing checkbox
 * comes back as its own notice rather than a generic failure.
 */
export async function markWaiverInPersonFromCheckIn(shopSlug: string, formData: FormData) {
  const session = await requireStaffSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  const back = `/shop/${shopSlug}/check-in`;
  if (!bookingId) redirect(`${back}?notice=invalid`);

  const outcome = await recordInPersonWaiver(await getDb(), {
    shopId: session.user.shopId,
    bookingId,
    recordedByPersonId: session.user.personId,
    medicalAttested: formData.get("medicalAttested") === "on",
  });
  revalidatePath(back);
  redirect(
    `${back}?notice=${
      outcome.ok
        ? "waiver_in_person"
        : outcome.reason === "medical_attestation_required"
          ? "waiver_medical_attestation"
          : "waiver_error"
    }`,
  );
}
