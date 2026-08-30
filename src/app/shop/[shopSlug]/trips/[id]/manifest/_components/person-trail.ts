import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatTime } from "@/lib/format";
import type { RollCallCheckpoint, RollCallRecord } from "@/lib/manifests";
import type { PersonTrailEntry } from "./PersonSheet";

function trailLabel(
  t: StaffTranslator,
  checkpoint: RollCallCheckpoint,
  state: PersonTrailEntry["state"],
): string {
  if (checkpoint === "departure") {
    return state === "aboard"
      ? t("manifest.personTrailBoardedAtDock")
      : t("manifest.personTrailNotBoardedAtDock");
  }
  const dive = Number(checkpoint.slice("after_dive_".length));
  return state === "aboard"
    ? t("manifest.personTrailBackAfterDive", { dive })
    : t("manifest.personTrailNotBackAfterDive", { dive });
}

/**
 * Keeps a row's current explicit event visible when a roll-call list is used
 * without the page-level history index (for example, the client component's
 * isolated render). The page normally supplies the complete trail; matching
 * the formatted detail prevents this local fallback from duplicating its
 * current event.
 */
export function personTrailWithCurrentRecord({
  trail,
  checkpoint,
  rollCall,
  locale,
  timezone,
  t,
}: {
  trail: readonly PersonTrailEntry[];
  checkpoint: RollCallCheckpoint;
  rollCall: RollCallRecord | undefined;
  locale: string;
  timezone: string;
  t: StaffTranslator;
}): readonly PersonTrailEntry[] {
  if (!rollCall || rollCall.implied) return trail;

  const detail = t("manifest.personTrailDetail", {
    time: formatTime(rollCall.occurredAt, locale, timezone),
    name: rollCall.recordedByName,
  });
  if (trail.some((entry) => entry.detail === detail && entry.note === rollCall.note)) {
    return trail;
  }

  const state: PersonTrailEntry["state"] =
    rollCall.state === "boarded" ? "aboard" : checkpoint === "departure" ? "ashore" : "notBack";
  return [
    ...trail,
    {
      label: trailLabel(t, checkpoint, state),
      detail,
      state,
      note: rollCall.note,
    },
  ];
}
