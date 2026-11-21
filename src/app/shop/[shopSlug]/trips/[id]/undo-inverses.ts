import { revalidatePath } from "next/cache";
import { requireShopSurface } from "@/features/accounts/session";
import { revalidateAndRedirect } from "@/features/platform/navigation";
import type { UndoOfferOf } from "@/features/platform/undo";
import { recordTripConservation } from "@/features/sites/conservation";
import { recordCourseTeachingNote } from "@/features/training/course-pulse";
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
    // The record is kept under Wrapped up's More, which its hash opens.
    result.ok
      ? `${base}?phase=wrapped#conservation`
      : noticeUrl(`${base}#conservation`, "conservation-undo-failed", { phase: "wrapped" }),
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
