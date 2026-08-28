"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import {
  type WaiverSendChannel as DbWaiverSendChannel,
  issueAndDeliverPersonWaiver,
  issueAndDeliverWaiver,
} from "@/db/waiver-issue";
import { trackEvent } from "@/lib/analytics";
import { requireStaffSession } from "@/lib/session";
import {
  isWaiverSendChannel,
  type WaiverSendChannel,
  type WaiverSendState,
  type WaiverSendSurface,
} from "./waiver-send-types";

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
  check_in: (shopSlug) => `/shop/${shopSlug}/check-in`,
  roster: (shopSlug, tripId) => `/shop/${shopSlug}/trips/${tripId}/guests`,
  diver: (shopSlug, _tripId) => `/shop/${shopSlug}/divers`,
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
  const personId = String(formData.get("personId") ?? "").trim() || undefined;
  // The diver record's three delivery buttons are three submitters on **one**
  // form, so the channel arrives as the submitter's own name/value pair. An
  // unrecognised (or absent) value is email — the behaviour of every caller
  // that predates the channel, and the safe default for a stray submit.
  const rawChannel = formData.get("channel");
  const channel: WaiverSendChannel = isWaiverSendChannel(rawChannel) ? rawChannel : "email";
  // The two unions are declared separately (see `waiver-send-types`); this
  // assignment is what fails the build if they ever drift apart.
  const dbChannel: DbWaiverSendChannel = channel;
  const db = await getDb();

  const state: WaiverSendState = {
    status: "done",
    channel,
    sent: [],
    links: [],
    alreadyDone: [],
    errors: [],
    // Only the roster's bulk control (checkbox-sourced selection) can ever
    // submit with zero ids — every other surface's bookingIds prop is fixed
    // and non-empty, so this can't misfire there.
    emptySelection: bookingIds.length === 0 && !personId,
  };
  const results: Array<
    { kind: "booking"; bookingId: string } | { kind: "person"; personId: string }
  > = bookingIds.map((bookingId) => ({ kind: "booking", bookingId }));
  if (personId) results.push({ kind: "person" as const, personId });
  for (const target of results) {
    const result =
      target.kind === "person"
        ? await issueAndDeliverPersonWaiver(db, session.user.shopId, target.personId, {
            channel: dbChannel,
          })
        : await issueAndDeliverWaiver(db, session.user.shopId, target.bookingId, {
            channel: dbChannel,
          });
    if (!result.ok) {
      if (result.reason === "already_completed") {
        state.alreadyDone.push(result.diverName ?? "A diver");
      } else {
        state.errors.push(result.diverName ?? "A diver");
      }
      continue;
    }
    if (result.delivery === "sent") {
      // A successful send gets the "✅ Waiver sent to …" line and nothing else.
      // It used to also hand back the link for the diver record to print; that
      // page now reaches the link the way anyone else does, by asking for it.
      state.sent.push(result.diverName);
    } else {
      state.links.push({ name: result.diverName, token: result.token, reason: result.delivery });
    }
  }

  // The blocked row itself moves to its awaiting state (a fresh link is now
  // pending) once the server data refreshes.
  let path: string | undefined;
  switch (surface) {
    case "today":
      path = SURFACE_PATH.today(shopSlug);
      break;
    case "check_in":
      path = SURFACE_PATH.check_in(shopSlug);
      break;
    case "roster":
      path = SURFACE_PATH.roster(shopSlug, tripId);
      break;
    case "diver":
      path = `${SURFACE_PATH.diver(shopSlug)}${personId ? `/${personId}` : ""}`;
      break;
    default:
      path = undefined;
  }
  if (path) revalidatePath(path);
  if (state.sent.length > 0) {
    await trackEvent({ name: "staff_recovery", kind: "waiver_sent", surface });
  }
  return state;
}
