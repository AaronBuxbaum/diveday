import { DAY_MS } from "@/lib/clock";
import { formatDateWithYear, formatShortDate } from "@/lib/format";
import type { SiteHistory } from "@/lib/site-history";
import type { StaffTranslator } from "./staff-messages";

/** Past this, "Mon, Oct 12" leaves a reader guessing the year. */
const YEAR_SAYS_MORE_AFTER_MS = 180 * DAY_MS;

/**
 * **One planned site's last visit, as a row summary** (fifth-loop ideas, item 6):
 * "Molasses: last dived Mon, Oct 12 (Sal Moretti): visibility 40 ft, current
 * light, to the north" or "Molasses: moved to French Reef last time (Mon, Oct
 * 12)". The Details tab and the manifest's plan read the same words. These
 * standalone fragments have no final period; they do not join another sentence.
 *
 * The visibility and current are the crew's own, as typed on the dive log.
 */
export function siteHistoryText(
  t: StaffTranslator,
  input: { site: string; history: SiteHistory; locale: string; timeZone: string; now: Date },
): string {
  const { site, history, locale, timeZone, now } = input;
  const date =
    now.getTime() - history.divedAt.getTime() > YEAR_SAYS_MORE_AFTER_MS
      ? formatDateWithYear(history.divedAt, locale, timeZone)
      : formatShortDate(history.divedAt, locale, timeZone);
  if (history.kind === "moved") {
    return t("trips.siteHistory.moved", { site, actual: history.actualSiteName, date });
  }
  const { visibility, current, recordedByName: name } = history;
  const conditions =
    visibility && current
      ? t("trips.siteHistory.both", { visibility, current })
      : visibility
        ? t("trips.siteHistory.visibility", { visibility })
        : current
          ? t("trips.siteHistory.current", { current })
          : null;
  if (conditions) {
    return name
      ? t("trips.siteHistory.divedWith", { site, date, name, conditions })
      : t("trips.siteHistory.divedWithNoName", { site, date, conditions });
  }
  return name
    ? t("trips.siteHistory.dived", { site, date, name })
    : t("trips.siteHistory.divedNoName", { site, date });
}
