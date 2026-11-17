import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { TONE_PANEL_CLASS } from "@/components/ui/card";
import { FormStatus } from "@/components/ui/form";
import { ITEM_TITLE_CLASS } from "@/components/ui/typography";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import type { FormNotice } from "@/lib/staff-notices";
import { reinstateTripAction } from "../details-actions";
import { blowoutPath } from "./blowout/blowout-path";

/**
 * **A cancelled trip says so first** (ADR 20261117-trip-page-clock): one plain
 * sentence of what happened and when, what it was scheduled for, then its
 * doors: Reinstate for whoever may configure the trip (the action keeps its
 * own gate), the cancellation record when the weather or a stopped run called
 * it off. Roll call keeps its door on every cancelled trip, in the header. On
 * every phase of a cancelled trip, for every staffer.
 */
export function TripCancellation({
  cancelled,
  canConfigure,
  blowoutCalled,
  lifecycleStatus,
  cancelledAt,
  scheduledFor,
  shopSlug,
  tripId,
  locale,
  timeZone,
  t,
}: {
  cancelled: boolean;
  canConfigure: boolean;
  blowoutCalled: string | null;
  lifecycleStatus?: FormNotice;
  /** When it was cancelled (`trips.cancelled_at`, stamped by `setTripStatus`). */
  cancelledAt: Date | null;
  /** "Was scheduled for …", from the trip's sentence. */
  scheduledFor: string | null;
  shopSlug: string;
  tripId: string;
  locale: string;
  timeZone: string;
  t: StaffTranslator;
}) {
  if (!cancelled) return null;
  const sentence = cancelledAt
    ? t("trips.clock.cancelledOn", {
        cause: blowoutCalled ?? "none",
        date: formatShortDate(cancelledAt, locale, timeZone),
      })
    : t("trips.clock.sentence.cancelled");
  return (
    <section
      data-trip-cancelled=""
      className={`${TONE_PANEL_CLASS} space-y-3 border-danger/40 bg-danger/10`}
    >
      <FormStatus tone={lifecycleStatus?.tone}>{lifecycleStatus?.text}</FormStatus>
      <div>
        <p className={`${ITEM_TITLE_CLASS} text-pretty`}>{sentence}</p>
        {scheduledFor ? <p className="text-sm text-muted">{scheduledFor}</p> : null}
      </div>
      {canConfigure || blowoutCalled ? (
        <div className="flex flex-wrap items-center gap-3">
          {canConfigure ? (
            <form action={reinstateTripAction.bind(null, shopSlug, tripId)}>
              <SubmitButton pendingLabel={t("trips.detail.reinstating")} className={buttonClass()}>
                {t("trips.detail.reinstate")}
              </SubmitButton>
            </form>
          ) : null}
          {blowoutCalled ? (
            <Link
              href={blowoutPath(shopSlug, tripId)}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("trips.detail.viewBlowout", { cause: blowoutCalled })}
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
