import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { TONE_PANEL_CLASS } from "@/components/ui/card";
import { FormStatus } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { FormNotice } from "@/lib/staff-notices";
import { reinstateTripAction } from "../details-actions";
import { blowoutPath } from "./blowout/blowout-path";

/** Cancellation controls keep the same visibility and action gates on either tab. */
export function TripCancellation({
  cancelled,
  canConfigure,
  blowoutCalled,
  lifecycleStatus,
  shopSlug,
  tripId,
  t,
}: {
  cancelled: boolean;
  canConfigure: boolean;
  blowoutCalled: string | null;
  lifecycleStatus?: FormNotice;
  shopSlug: string;
  tripId: string;
  t: StaffTranslator;
}) {
  if (!cancelled || !(canConfigure || blowoutCalled || lifecycleStatus)) return null;
  return (
    <section className={`${TONE_PANEL_CLASS} border-danger/40 bg-danger/10`}>
      <FormStatus tone={lifecycleStatus?.tone} className="mb-3">
        {lifecycleStatus?.text}
      </FormStatus>
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
    </section>
  );
}
