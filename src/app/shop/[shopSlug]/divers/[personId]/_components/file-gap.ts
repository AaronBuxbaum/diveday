import { readinessBlockerText } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatShortDate, formatTime } from "@/lib/format";
import type { DiverStatusRow } from "../_lib/status";

/** What a file row wears when the status has a gap for its kind. */
export type FileGap = {
  tone: "warning" | "danger";
  detail?: string;
  /** A gap that keeps the diver off a departure opens its door on arrival. */
  open: boolean;
};

/**
 * **A status row, said by the file row for its kind** (`splitDiverStatus`).
 *
 * The row's own fact stays the summary — "Not signed", "No emergency
 * contact" — and the gap adds only what that fact cannot carry: the ink of
 * its consequence, the departure it blocks, and the status sentence when the
 * fact does not already say it (`factSaysIt`). "Not signed" under a Waiver
 * label needs no "Waiver has not been sent." beneath it; "PADI Advanced Open
 * Water" beside a trip that needs Deep does.
 */
export function fileGap(
  row: DiverStatusRow | undefined,
  {
    t,
    locale,
    timezone,
    factSaysIt,
  }: { t: StaffTranslator; locale: string; timezone: string; factSaysIt: boolean },
): FileGap | undefined {
  if (!row) return undefined;
  const sentence = factSaysIt
    ? null
    : "blocker" in row.sentence
      ? readinessBlockerText(t, row.sentence.blocker)
      : t(row.sentence.key, row.sentence.values);
  const departure = row.tripContext
    ? // A danger gap is a consequence, not a deadline: a physician's "no"
      // will not clear before Friday, and "Needed for" would suggest it might.
      t(row.tone === "danger" ? "divers.file.cantBoard" : "divers.file.neededFor", {
        when: `${formatShortDate(row.tripContext.startsAt, locale, timezone)} · ${formatTime(
          row.tripContext.startsAt,
          locale,
          timezone,
        )}`,
      })
    : null;
  const detail = [sentence, departure].filter(Boolean).join(" ");
  return { tone: row.tone, detail: detail || undefined, open: row.tone === "danger" };
}
