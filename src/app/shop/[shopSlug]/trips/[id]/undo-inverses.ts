import { revalidatePath } from "next/cache";
import { recordCourseTeachingNote } from "@/db/course-pulse";
import { recordTripConservation } from "@/db/trip-conservation";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireShopSurface } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import type { UndoOfferOf } from "@/lib/undo";

/** Registry-only inverses: every store rechecks the live audience, feature and CAS. */
export async function restoreConservationRecord(
  shopSlug: string,
  offer: UndoOfferOf<"trip-conservation">,
): Promise<never> {
  const { session: staff, db } = await requireShopSurface(shopSlug);
  const result = await recordTripConservation(db, {
    shopId: staff.user.shopId,
    personId: staff.user.personId,
    tripId: offer.undoTrip,
    operation: "restore",
    id: offer.undoRecord,
    revision: Number(offer.undoRevision),
  });
  const base = shopPath(shopSlug, "trips", offer.undoTrip);
  revalidatePath("/ready/[token]", "page");
  revalidatePath("/recap/[token]", "page");
  revalidateAndRedirect(
    base,
    result.ok
      ? `${base}?view=details`
      : noticeUrl(base, "conservation-undo-failed", { view: "details" }),
  );
}

export async function restoreTeachingNote(
  shopSlug: string,
  offer: UndoOfferOf<"course-teaching-note">,
): Promise<never> {
  const { session: staff, db } = await requireShopSurface(shopSlug);
  const result = await recordCourseTeachingNote(db, {
    shopId: staff.user.shopId,
    personId: staff.user.personId,
    tripId: offer.undoTrip,
    note: "",
    expectedNote: null,
    restoreRevision: Number(offer.undoRevision),
  });
  const base = shopPath(shopSlug, "trips", offer.undoTrip);
  revalidateAndRedirect(base, result.ok ? base : noticeUrl(base, "teaching-note-undo-failed"));
}
