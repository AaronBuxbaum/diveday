import type { SimilarDiver } from "@/db/divers";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate } from "@/lib/calendar-date";
import { displayStoredPhoneWhole } from "@/lib/forgiving-fields";
import { formatShortDate } from "@/lib/format";
import { candidateBirthDate } from "@/lib/name-match-evidence";

/**
 * What one candidate on the counter's "is this the same person?" prompt
 * carries after its name: the contact on file, the date of birth (H-79, issue
 * #1698) and the last dive day this shop can put behind the name (issue
 * #1556). Shared by the trip's Add-diver section and `/divers/new`; the seat
 * panel says the same three facts through its own copy props, because it holds
 * no translator.
 *
 * Each fact prints only when it has a value, so a candidate with nothing on
 * file adds no empty parenthesis and no stray separator. Whether a missing
 * dive day is said is the caller's (`noDiveDayNeedsSaying`).
 */
export function NameMatchCandidateFacts({
  match,
  sayNoDiveDay,
  t,
  locale,
  timeZone,
  size,
}: {
  match: SimilarDiver;
  sayNoDiveDay: boolean;
  t: StaffTranslator;
  locale: string;
  /** The shop's own zone, so the last dive day is dated in it. */
  timeZone: string;
  size: "xs" | "sm";
}) {
  const factClass = size === "xs" ? "text-muted text-xs ms-1" : "text-muted text-sm ms-1";
  const dateOfBirth = candidateBirthDate(match);
  return (
    <>
      {match.email || match.phone ? (
        <span className={factClass}>
          ({[match.email, displayStoredPhoneWhole(match.phone)].filter(Boolean).join(", ")})
        </span>
      ) : null}
      {dateOfBirth ? (
        <span className={factClass}>
          {t("divers.page.confirmMatchesBorn", { date: formatCalendarDate(dateOfBirth, locale) })}
        </span>
      ) : null}
      {match.lastDiveDayAt ? (
        <span className={factClass}>
          {t("divers.page.confirmMatchesLastDive", {
            date: formatShortDate(match.lastDiveDayAt, locale, timeZone),
          })}
        </span>
      ) : sayNoDiveDay ? (
        <span className={factClass}>{t("divers.page.confirmMatchesNoDiveDay")}</span>
      ) : null}
    </>
  );
}
