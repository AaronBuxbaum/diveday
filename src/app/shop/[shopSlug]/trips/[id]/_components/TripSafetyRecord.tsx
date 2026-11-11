import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { FormNotice } from "@/lib/staff-notices";
import { correctDiveSafetyRecord } from "../details-actions";
import { DecompressionField } from "./DetailsSection";

/** Correct the dive's safety evidence, never the closed departure plan. */
export function TripSafetyRecord({
  shopSlug,
  tripId,
  exceedsNoDecoLimits,
  flySafeTold,
  t,
  status,
}: {
  shopSlug: string;
  tripId: string;
  exceedsNoDecoLimits: boolean;
  flySafeTold: number;
  t: StaffTranslator;
  status?: FormNotice;
}) {
  return (
    <form action={correctDiveSafetyRecord.bind(null, shopSlug, tripId)} className="space-y-4">
      <input
        type="hidden"
        name="expectedExceedsNoDecoLimits"
        value={exceedsNoDecoLimits ? "yes" : "no"}
      />
      <DecompressionField t={t} checked={exceedsNoDecoLimits} flySafeTold={flySafeTold} />
      <FormStatus tone={status?.tone}>{status?.text}</FormStatus>
      <SubmitButton
        pendingLabel={t("words.busy.saving")}
        className={buttonClass({ variant: "primary", size: "sm" })}
      >
        {t("trips.details.saveChanges")}
      </SubmitButton>
    </form>
  );
}
