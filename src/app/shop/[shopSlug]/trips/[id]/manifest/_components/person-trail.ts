import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatTime } from "@/lib/format";
import type { RollCallCheckpoint, RollCallRecord, TripManifest } from "@/lib/manifests";
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

/**
 * The person sheet's Today section is a small audit trail, not a second
 * current-state calculation. It reads the same latest record each checkpoint
 * already uses and omits carried-forward rows, so an ashore-at-the-dock result
 * appears once instead of being repeated after every dive.
 */
export function personTrailIndex(
  manifests: readonly TripManifest[],
  locale: string,
  timezone: string,
  t: StaffTranslator,
): ReadonlyMap<string, readonly PersonTrailEntry[]> {
  const index = new Map<string, PersonTrailEntry[]>();
  const add = (
    id: string,
    checkpoint: RollCallCheckpoint,
    rollCall: TripManifest["divers"][number]["rollCall"],
  ) => {
    if (!rollCall || rollCall.implied) return;
    const state: PersonTrailEntry["state"] =
      rollCall.state === "boarded" ? "aboard" : checkpoint === "departure" ? "ashore" : "notBack";
    const entries = index.get(id) ?? [];
    entries.push({
      label: trailLabel(t, checkpoint, state),
      detail: t("manifest.personTrailDetail", {
        time: formatTime(rollCall.occurredAt, locale, timezone),
        name: rollCall.recordedByName,
      }),
      state,
      note: rollCall.note,
    });
    index.set(id, entries);
  };

  for (const snapshot of manifests) {
    for (const diver of snapshot.divers) add(diver.bookingId, snapshot.checkpoint, diver.rollCall);
    for (const member of snapshot.crew) add(member.id, snapshot.checkpoint, member.rollCall);
  }
  return index;
}
