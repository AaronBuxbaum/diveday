"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { issueAndDeliverWaiver } from "@/db/waiver-issue";
import { requireStaffSession } from "@/lib/session";

/**
 * One-tap waiver send, shared by the Today queue and the Blockers page (the two
 * surfaces where a diver's worst blocker is an unsent/pending/expired waiver).
 * It runs the same issue-and-deliver path as the trip roster, so a waiver is
 * never sent by a different rule depending on where staff tapped. Auth and shop
 * ownership are re-checked server-side; the caller only supplies booking ids.
 *
 * Batch is the same action with several `bookingId` values, so "Send waiver" and
 * "Send all 9 waivers" are one code path with one summary.
 */

/** Where the send happened, so the right route is revalidated after it lands. */
export type WaiverSendSurface = "today" | "blockers";

/** A private fallback link staff must hand over when email did not go out. */
export type WaiverFallbackLink = { name: string; token: string };

export type WaiverSendState = {
  status: "idle" | "done";
  /** Divers the email actually reached. */
  sent: string[];
  /** Divers with no email / no delivery configured — link shown to copy. */
  links: WaiverFallbackLink[];
  /** Divers who already have a signed waiver; nothing was reissued. */
  alreadyDone: string[];
  /** Divers whose send failed outright (no current booking/template). */
  errors: string[];
};

export const IDLE_WAIVER_SEND_STATE: WaiverSendState = {
  status: "idle",
  sent: [],
  links: [],
  alreadyDone: [],
  errors: [],
};

const SURFACE_PATH: Record<WaiverSendSurface, (shopSlug: string) => string> = {
  today: (shopSlug) => `/shop/${shopSlug}`,
  blockers: (shopSlug) => `/shop/${shopSlug}/blockers`,
};

export async function sendWaiversAction(
  shopSlug: string,
  surface: WaiverSendSurface,
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
      state.links.push({ name: result.diverName, token: result.token });
    }
  }

  // The blocked row itself moves to its awaiting state (a fresh link is now
  // pending) once the server data refreshes.
  revalidatePath(SURFACE_PATH[surface](shopSlug));
  return state;
}
