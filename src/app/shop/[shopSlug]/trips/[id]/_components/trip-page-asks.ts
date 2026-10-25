import type { AppDb } from "@/db/client";
import { previewPartyPayment } from "@/db/payment-marks";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { readMarkRetry, readPartyAsk } from "@/lib/payment-marks";
import { type FormNotice, noticeForForm } from "@/lib/staff-notices";
import { deskFormNotice } from "../_arrivals/notices";
import type { PartyPreview } from "./roster-model";
import { resolveTripNotice } from "./TripNoticeBanner";
import { pageNoticesFor } from "./trip-notice-tabs";
import type { TripPageSearchParams } from "./trip-search-params";

/**
 * **The page's one resolution of `?notice=`**, handed to the section it
 * belongs to. Whatever no rendered section claims, a page-level permission
 * refusal or a section this staffer's role means we never rendered, falls
 * through to the banner. The desk's own refusals and walk-in outcomes
 * (`_arrivals/notices.ts`) are page-level: they have no form on the roster to
 * sit beside, and a code the roster's own vocabulary also speaks is the
 * roster's.
 */
export function tripPageNotices(
  input: Parameters<typeof resolveTripNotice>[0] & { t: StaffTranslator },
) {
  const { notice, t } = input;
  const tripNotice: FormNotice | undefined = resolveTripNotice(input) ?? deskFormNotice(notice, t);
  return {
    tripNotice,
    lifecycleStatus: noticeForForm(tripNotice, "lifecycle"),
    ...pageNoticesFor(tripNotice),
  };
}

/**
 * The held retime notice a details save carries back (`?held=`), read only
 * beside that save's own notice: a plain save, or one whose fly-safe
 * corrections (#2927) did not all go.
 */
export function savedHeld(notice: string | undefined, held: string | undefined) {
  return notice === "saved" || notice?.startsWith("saved-fly-safe") ? held : undefined;
}

/**
 * **What a refused or half-done Paid mark carries back to the roster.**
 *
 * A refused Paid mark reopens the seat's sheet holding what was typed (issue
 * #2607), and a previewed party payment shows the server's split before it is
 * taken (issue #2605). Both are read off the query string, each value
 * validated on its own, and the split is worked out again here from the
 * database, never read off the URL.
 */
export async function paymentAsks(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    notice: string | undefined;
    bookingId: string | undefined;
    params: TripPageSearchParams;
  },
): Promise<{
  paymentMarkRetry:
    | ({ bookingId: string } & NonNullable<ReturnType<typeof readMarkRetry>>)
    | undefined;
  partyPreview: PartyPreview | undefined;
}> {
  const { notice, bookingId, params } = input;
  const retry = notice?.startsWith("payment-")
    ? readMarkRetry({
        status: params.markStatus,
        amount: params.markAmount,
        method: params.markMethod,
      })
    : null;
  const ask =
    notice === "party-preview"
      ? readPartyAsk({
          lead: params.partyLead,
          amount: params.partyAmount,
          method: params.partyMethod,
        })
      : null;
  const split = ask
    ? await previewPartyPayment(db, {
        shopId: input.shopId,
        tripId: input.tripId,
        leadBookingId: ask.leadBookingId,
        amountCents: ask.amountCents,
      })
    : null;
  return {
    paymentMarkRetry: retry && bookingId ? { bookingId, ...retry } : undefined,
    partyPreview:
      ask && split?.kind === "split"
        ? {
            ...ask,
            shares: split.shares,
            unspentCents: split.unspentCents,
            owedCents: split.owedCents,
          }
        : undefined,
  };
}
