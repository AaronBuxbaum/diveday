"use server";

/**
 * **"Dive N not made", and its undo** (issue #4681), from Wrapped up. The
 * safety contract lives in `recordDiveNotMade` (`src/db/dive-not-made.ts`),
 * which re-checks every condition under the trip's lock; the shop and the
 * person come off the session, never the form. Each outcome lands back on
 * Wrapped up with its notice.
 */
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { type DiveNotMadeOutcome, recordDiveNotMade, undoDiveNotMade } from "@/db/dive-not-made";
import { revalidateAndRedirect } from "@/features/navigation";
import { requireShopSurface } from "@/features/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";

export async function recordDiveNotMadeAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
): Promise<void> {
  await act(shopSlug, tripId, formData, "record");
}

export async function undoDiveNotMadeAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
): Promise<void> {
  await act(shopSlug, tripId, formData, "undo");
}

async function act(
  shopSlug: string,
  tripId: string,
  formData: FormData,
  which: "record" | "undo",
): Promise<void> {
  const session = (await requireShopSurface(shopSlug)).session;
  const page = shopPath(shopSlug, "trips", tripId);
  const back = `${page}?phase=wrapped`;
  const dive = Number(formData.get("dive"));
  if (!uuidParam(tripId) || !Number.isInteger(dive)) {
    revalidateAndRedirect(page, noticeUrl(back, "dive-not-made-stale"));
  }
  const input = {
    shopId: session.user.shopId,
    tripId,
    diveNumber: dive,
    personId: session.user.personId,
  };
  const db = await getDb();
  const outcome =
    which === "record" ? await recordDiveNotMade(db, input) : await undoDiveNotMade(db, input);
  revalidatePath(shopPath(shopSlug, "trips", tripId, "manifest"));
  revalidateAndRedirect(page, noticeUrl(back, noticeFor(outcome, which)));
}

function noticeFor(outcome: DiveNotMadeOutcome, which: "record" | "undo"): string {
  if (outcome.ok) return which === "record" ? "dive-not-made" : "dive-not-made-undone";
  switch (outcome.reason) {
    case "not_crew":
      return "dive-not-made-not-crew";
    case "dive_counted":
      return "dive-not-made-counted";
    case "dive_logged":
      return "dive-not-made-logged";
    case "boat_not_left":
      return "dive-not-made-not-left";
    default:
      // Already said, already undone, a dive the plan no longer holds, a
      // departure no longer there: the page as it stands now says which.
      return "dive-not-made-stale";
  }
}
