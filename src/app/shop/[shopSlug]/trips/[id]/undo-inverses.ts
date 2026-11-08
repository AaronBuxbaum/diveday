import { revalidatePath } from "next/cache";
import { recordTripConservation } from "@/features/conservation";
import { recordCourseTeachingNote } from "@/features/course-pulse";
import { revalidateAndRedirect } from "@/features/navigation";
import { requireShopSurface } from "@/features/session";
import type { UndoOfferOf } from "@/features/undo";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

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
