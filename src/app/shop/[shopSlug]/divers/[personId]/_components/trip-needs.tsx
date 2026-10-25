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

/** Whether every reason is a card not held, so nothing behind the door waits for a look. */
export function onlyNotHeld(row: DiverStatusRow | undefined): boolean {
  const blockers = blockersOf(row);
  return blockers.length > 0 && blockers.every((blocker) => NOT_HELD.has(blocker.code));
}

/** One requirement behind the door: its words, and whether it is a card not held. */
export type TripNeedsLine = { text: string; notHeld: boolean };

/**
 * One short line per requirement the diver does not meet, for the list behind
 * the door. A card that is only waiting for a look keeps its own full sentence,
 * because that sentence is its fix, and is not drawn in danger ink: it is a
 * verify task, not a missing card (dive-domain review, 2026-10-23).
 */
export function tripNeedsLines(
  t: StaffTranslator,
  row: DiverStatusRow | undefined,
): TripNeedsLine[] {
  return blockersOf(row).map((blocker) => ({
    text: needText(t, blocker),
    notHeld: NOT_HELD.has(blocker.code),
  }));
}

function needText(t: StaffTranslator, blocker: ReadinessBlocker): string {
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
}

/** The list itself, shared by the file row and the status ledger. */
export function TripNeedsList({ lines }: { lines: TripNeedsLine[] }) {
  return (
    <ul className="mt-2 list-disc space-y-1 ps-5 text-sm">
      {lines.map((line) => (
        <li key={line.text} className={line.notHeld ? "text-danger" : "text-muted"}>
          {line.text}
        </li>
      ))}
    </ul>
  );
}

/**
 * **What the trip needs, one line each**, at the top of the open group. The row
 * above it says only "Not certified for this trip"; this is the detail a
 * staffer clicks in for, and the list a diver on the phone gets read.
 */
export function TripNeedsRow({ t, lines }: { t: StaffTranslator; lines: TripNeedsLine[] }) {
  if (lines.length === 0) return null;
  return (
    <li className="px-5 py-4 sm:px-6">
      <p className="font-medium">{t("divers.certifications.tripNeeds.heading")}</p>
      <TripNeedsList lines={lines} />
    </li>
  );
}

/**
 * The same list on the status ledger, folded: the ledger row says "Not
 * certified for this trip" and its fix, and the reasons open under it on a tap
 * (Aaron, 2026-10-23). A level the diver is below lands here rather than in
 * the file, because its fix is a different seat.
 */
export function TripNeedsDisclosure({ t, lines }: { t: StaffTranslator; lines: TripNeedsLine[] }) {
  if (lines.length === 0) return null;
  return (
    <details className="group text-sm">
      <summary className="cursor-pointer text-muted hover:text-foreground">
        {t("divers.certifications.tripNeeds.heading")}
      </summary>
      <TripNeedsList lines={lines} />
    </details>
  );
}
