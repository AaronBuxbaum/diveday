import type { DiverTranslator } from "@/i18n/messages";
import { cachedListFormat } from "@/lib/intl-cache";

/**
 * The Sites row's words. Consecutive dives at the same site are one run, so a
 * two-tank day on one reef reads "Molasses Reef, two dives" rather than the
 * site twice, which looked like a data error on the card a diver screenshots
 * (UX audit #14). Only *consecutive* repeats collapse: a day that goes A, B,
 * then back to A still reads in the order it runs.
 */
export function siteRunsLine(sites: readonly string[], locale: string, t: DiverTranslator): string {
  const runs: { site: string; dives: number }[] = [];
  for (const site of sites) {
    const last = runs.at(-1);
    if (last && last.site === site) last.dives += 1;
    else runs.push({ site, dives: 1 });
  }
  const [only] = runs;
  if (runs.length === 1 && only && only.dives > 1) {
    return t("trip.arrivalSiteRun", { site: only.site, count: only.dives });
  }
  return cachedListFormat(locale, { style: "long", type: "unit" }).format(
    runs.map(({ site, dives }) =>
      dives > 1 ? t("trip.arrivalSiteRunInList", { site, count: dives }) : site,
    ),
  );
}
