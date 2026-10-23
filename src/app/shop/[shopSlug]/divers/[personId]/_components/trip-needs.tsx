import {
  CERTIFICATION_LEVEL_KEYS,
  readinessBlockerText,
  SPECIALTY_KEYS,
} from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { DiverStatusRow } from "@/lib/diver-status";
import type { ReadinessBlocker } from "@/lib/readiness";

/**
 * The blockers that mean the diver does not hold a card the trip asks for, as
 * opposed to one the shop has not looked at yet. Any of them makes the row say
 * "Not certified for this trip" and nothing more (Aaron, 2026-10-23): three
 * run-on sentences under one row was a paragraph a staffer had to parse to
 * learn one fact. The reasons stay one tap away, behind the group's door.
 */
const NOT_HELD = new Set<ReadinessBlocker["code"]>([
  "certification_missing",
  "certification_insufficient",
  "specialty_missing",
  "nitrox_missing",
]);

/** Every certification blocker a status row carries, the first one first. */
function blockersOf(row: DiverStatusRow | undefined): ReadinessBlocker[] {
  if (!row || !("blocker" in row.sentence)) return [];
  return [row.sentence.blocker, ...(row.alsoBlockers ?? [])];
}

/** Whether the row has a card the diver does not hold, so it collapses to one line. */
export function saysNotCertified(row: DiverStatusRow | undefined): boolean {
  return blockersOf(row).some((blocker) => NOT_HELD.has(blocker.code));
}

/**
 * One short line per requirement the diver does not meet, for the list behind
 * the door. A card that is only waiting for a look keeps its own full sentence,
 * because that sentence is its fix.
 */
export function tripNeedsLines(t: StaffTranslator, row: DiverStatusRow | undefined): string[] {
  return blockersOf(row).map((blocker) => {
    const params = blocker.params;
    switch (blocker.code) {
      case "certification_insufficient":
        if (params?.requiredLevel && params.heldLevel) {
          return t("divers.certifications.tripNeeds.levelHeld", {
            level: t(CERTIFICATION_LEVEL_KEYS[params.requiredLevel]),
            held: t(CERTIFICATION_LEVEL_KEYS[params.heldLevel]),
          });
        }
        return params?.requiredLevel
          ? t("divers.certifications.tripNeeds.level", {
              level: t(CERTIFICATION_LEVEL_KEYS[params.requiredLevel]),
            })
          : t("divers.certifications.tripNeeds.card");
      case "certification_missing":
        return t("divers.certifications.tripNeeds.card");
      case "specialty_missing":
        return params?.specialty
          ? t("divers.certifications.tripNeeds.specialty", {
              specialty: t(SPECIALTY_KEYS[params.specialty]),
            })
          : readinessBlockerText(t, blocker);
      case "nitrox_missing":
        return t("divers.certifications.tripNeeds.nitrox");
      default:
        return readinessBlockerText(t, blocker);
    }
  });
}

/**
 * **What the trip needs, one line each**, at the top of the open group. The row
 * above it says only "Not certified for this trip"; this is the detail a
 * staffer clicks in for, and the list a diver on the phone gets read.
 */
export function TripNeedsRow({ t, lines }: { t: StaffTranslator; lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <li className="px-5 py-4 sm:px-6">
      <p className="font-medium">{t("divers.certifications.tripNeeds.heading")}</p>
      <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-danger-strong">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </li>
  );
}
