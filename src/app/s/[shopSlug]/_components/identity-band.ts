import type { DiverTranslator } from "@/i18n/messages";

/**
 * How the storefront's identity band lays out: how many panels it has, and
 * whether they sit beside the shop's name or under it.
 *
 * The count is counted rather than inferred from the rendered children,
 * because a grid wrapper around three conditionals still draws its own top
 * margin when every one of them is false — an empty 24px band above the
 * schedule on the commonest shop of all, the one with no next boat.
 *
 * **Beside only when the shop's side has a body.** A photograph or a
 * description stands as tall as the next-boat card; a name and a rating alone
 * left a 20rem card beside a 300px-tall empty column, the first screen's most
 * valuable room (Aaron, 2026-10-23). Without one, the band stacks under the
 * name and a lone next boat lies flat as one strip.
 */
export function identityBand(
  quiet: boolean,
  nextBoat: boolean,
  shop: { brandHeroImageUrl: string | null; description: string | null },
) {
  const heroImageUrl = shop.brandHeroImageUrl;
  const description = shop.description;
  const panels = (quiet ? 1 : 0) + (nextBoat ? 1 : 0);
  const beside = panels > 0 && (heroImageUrl !== null || Boolean(description));
  return { identityPanels: panels, panelsBeside: beside, nextBoatFlat: !beside && panels === 1 };
}

/**
 * The month rail's two sides: the schedule a month either way, filters kept.
 * Never in the frame, so neither link carries `embed=1`.
 */
export function monthRailSides(
  previousKey: string | null,
  nextKey: string | null,
  monthHref: (monthKey: string) => string,
  t: DiverTranslator,
) {
  const side = (key: string | null, label: string) =>
    key ? { href: monthHref(key), label } : null;
  return {
    previous: side(previousKey, t("schedule.previousMonth")),
    next: side(nextKey, t("schedule.nextMonth")),
  };
}
