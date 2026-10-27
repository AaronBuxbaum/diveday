import { StatusMark } from "@/components/ui/StatusMark";
import type { StaffTranslator } from "@/i18n/staff-messages";

/** A prompt to check the actual plan, never a group assignment or clearance. */
export function MixedTrainingDepthWarning({ show, t }: { show: boolean; t: StaffTranslator }) {
  if (!show) return null;
  return (
    <div className="mt-3 flex gap-2 rounded-lg bg-warning-tint px-3 py-2 text-base text-warning-strong">
      <StatusMark variant="warning" size="md" />
      <p>{t("manifest.mixedTrainingDepthWarning")}</p>
    </div>
  );
}
