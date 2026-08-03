"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { issueAndDeliverWaiver } from "@/db/waiver-issue";
import { trackEvent } from "@/lib/analytics";
import { requireStaffSession } from "@/lib/session";
import type { WaiverSendState, WaiverSendSurface } from "./waiver-send-types";

/**
 * One-tap waiver send, shared by the Today queue, the Blockers page, and
 * check-in (the surfaces where a diver's worst blocker is an unsent/pending/
 * expired waiver). It runs the same issue-and-deliver path as the trip
 * roster, so a waiver is never sent by a different rule depending on where
 * staff tapped. Auth and shop ownership are re-checked server-side; the
 * caller only supplies booking ids.
 *
 * Batch is the same action with several `bookingId` values, so "Send waiver" and
 * "Send all 9 waivers" are one code path with one summary.
 *
 * State shapes live in `./waiver-send-types` — a `"use server"` file may only
 * export async functions.
 */

const SURFACE_PATH: Record<WaiverSendSurface, (shopSlug: string, tripId?: string) => string> = {
  today: (shopSlug) => `/shop/${shopSlug}`,
  // The by-departure view lives *on* the shop home now, so revalidating it is
  // revalidating that path — the `?view=` query selects a view of the same
  // route, and `revalidatePath` is keyed on the route, not the query.
  blockers: (shopSlug) => `/shop/${shopSlug}`,
  check_in: (shopSlug) => `/shop/${shopSlug}/check-in`,
  roster: (shopSlug, tripId) => `/shop/${shopSlug}/trips/${tripId}/guests`,
};

export async function sendWaiversAction(
  shopSlug: string,
  surface: WaiverSendSurface,
  /** Only meaningful (and required) for the "roster" surface — which trip's guests page to revalidate. */
  tripId: string | undefined,
  _prev: WaiverSendState,
  formData: FormData,
): Promise<WaiverSendState> {
  const session = await requireStaffSession();
  const bookingIds = [...new Set(formData.getAll("bookingId").map(String).filter(Boolean))];
  const db = await getDb();

  const state: WaiverSendState = {
    status: "done",
    sent: [],
    links: [],
    alreadyDone: [],
    errors: [],
    // Only the roster's bulk control (checkbox-sourced selection) can ever
    // submit with zero ids — every other surface's bookingIds prop is fixed
    // and non-empty, so this can't misfire there.
    emptySelection: bookingIds.length === 0,
  };

  for (const bookingId of bookingIds) {
    const result = await issueAndDeliverWaiver(db, session.user.shopId, bookingId);
    if (!result.ok) {
      if (result.reason === "already_completed") {
        state.alreadyDone.push(result.diverName ?? "A diver");
      } else {
        state.errors.push(result.diverName ?? "A diver");
      }
      continue;
    }
    if (result.delivery === "sent") {
      state.sent.push(result.diverName);
    } else {
      state.links.push({ name: result.diverName, token: result.token, reason: result.delivery });
    }
  }

  // The blocked row itself moves to its awaiting state (a fresh link is now
  // pending) once the server data refreshes.
  revalidatePath(SURFACE_PATH[surface](shopSlug, tripId));
  if (state.sent.length > 0) {
    await trackEvent({ name: "staff_recovery", kind: "waiver_sent", surface });
  }
  return state;
}
