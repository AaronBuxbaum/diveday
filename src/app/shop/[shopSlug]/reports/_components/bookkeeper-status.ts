import type { BookkeeperSetting } from "@/db/bookkeeper";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateWithYear } from "@/lib/format";

/**
 * **The one line under the bookkeeper's field**: who stands behind the
 * address and when (security review F1), then the most pressing of what is
 * wrong with it. A setter who can no longer export the shop's data holds every
 * send; a bounced address (issue #2798) is the next thing to fix; an inbox not
 * yet confirmed (B1) waits on the bookkeeper. Plain when none of them holds.
 */
export function bookkeeperStatusLine(
  setting: BookkeeperSetting,
  context: { setterCanExport: boolean; t: StaffTranslator; locale: string; timeZone: string },
): { tone: "warning" | "muted"; text: string } {
  const { t } = context;
  const date = formatDateWithYear(setting.setAt, context.locale, context.timeZone);
  const setBy = setting.setByName
    ? t("reports.bookkeeper.setBy", { name: setting.setByName, date })
    : t("reports.bookkeeper.setByGone", { date });
  if (!context.setterCanExport) {
    return { tone: "warning", text: `${setBy} ${t("reports.bookkeeper.setterLapsed")}` };
  }
  if (setting.bouncedAt) {
    return {
      tone: "warning",
      text: `${setBy} ${t("reports.bookkeeper.bounced", { email: setting.email })}`,
    };
  }
  if (!setting.confirmedAt) {
    return {
      tone: "warning",
      text: `${setBy} ${t("reports.bookkeeper.waiting", { email: setting.email })}`,
    };
  }
  return { tone: "muted", text: setBy };
}
