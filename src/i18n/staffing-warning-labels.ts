import { formatCalendarDate } from "@/lib/calendar-date";
import { formatWeekdayTime } from "@/lib/format";
import { LONG_DAY_HOURS, type StaffingWarning } from "@/lib/staffing-warnings";
import type { StaffTranslator } from "./staff-messages";

/**
 * The one sentence each staffing-week warning renders as
 * (`src/lib/staffing-warnings.ts`). The lib hands back codes; this is the only
 * place they become words, so the week and anything that reads these next
 * cannot say them two ways.
 *
 * `credentialWord` is the credential kind's own label, which the team settings
 * already owns (`settings/team/credential-kinds.ts`); the caller resolves it.
 */
export function staffingWarningText(
  t: StaffTranslator,
  warning: StaffingWarning,
  context: { locale: string; timeZone: string; credentialWord: (kind: string) => string },
): string {
  switch (warning.code) {
    case "missing_aboard": {
      const values = {
        title: warning.title,
        when: formatWeekdayTime(warning.startsAt, context.locale, context.timeZone),
      };
      return warning.kind === "oxygen_provider"
        ? t("desk.staffingWarnings.missingOxygen", values)
        : t("desk.staffingWarnings.missingFirstAid", values);
    }
    case "long_day":
      return t("desk.staffingWarnings.longDay", {
        name: warning.name,
        hours: LONG_DAY_HOURS,
        day: formatCalendarDate(warning.day, context.locale),
      });
    case "credential_not_yet_issued":
      return t("desk.staffingWarnings.credentialNotYetIssued", {
        name: warning.name,
        title: warning.title,
        credential: context.credentialWord(warning.kind),
        date: formatCalendarDate(warning.issuedAt, context.locale),
      });
    case "credential_expired": {
      // The kind labels are list headings ("Liability insurance"), so the
      // sentence sets one off after a colon rather than splicing it into a
      // possessive; "Other" names nothing and is said as "a credential".
      const values = {
        name: warning.name,
        date: formatCalendarDate(warning.renewsAt, context.locale),
        title: warning.title,
      };
      return warning.kind === "other"
        ? t("desk.staffingWarnings.credentialExpiredOther", values)
        : t("desk.staffingWarnings.credentialExpired", {
            ...values,
            credential: context.credentialWord(warning.kind),
          });
    }
  }
}
