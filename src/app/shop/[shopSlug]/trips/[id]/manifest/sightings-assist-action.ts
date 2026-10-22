"use server";

import { runAssist } from "@/db/assists";
import { marineLifeCatalogCards } from "@/i18n/marine-life-labels";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import {
  SIGHTINGS_MATCH_FEATURE,
  SIGHTINGS_MAX_SAID,
  type SightingMatch,
  sightingMatches,
  sightingsMatchCall,
} from "@/lib/assists/sightings-match";
import { requireShopSurface } from "@/lib/session";
import type { SightingActionContext } from "./actions";

/**
 * **sightings**: what the crew said, matched to the chips this reef offers.
 * It proposes and logs nothing; "Add these" is the chips' own tap, once per
 * sighting, through the same write and the same checks.
 *
 * The chip slugs come from the page, so each is checked against DiveDay's
 * catalog and named from it here: the prompt never carries a word the browser
 * made up, and the answer can only name a chip that was offered.
 */
export async function matchSightingsAction(
  ctx: SightingActionContext,
  offeredSlugs: readonly string[],
  rawSaid: string,
): Promise<SightingMatch[] | null> {
  const said = typeof rawSaid === "string" ? rawSaid.trim().slice(0, SIGHTINGS_MAX_SAID) : "";
  if (!said) return null;
  const { db, shop } = await requireShopSurface(ctx.shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const offered = new Set(offeredSlugs);
  const chips = marineLifeCatalogCards(diverTranslator(locale))
    .filter((card) => offered.has(card.slug))
    .map((card) => ({ slug: card.slug, name: card.name }));
  if (chips.length === 0) return null;
  const value = await runAssist(db, {
    shopId: shop.id,
    feature: SIGHTINGS_MATCH_FEATURE,
    call: sightingsMatchCall(said, chips),
  });
  return value ? sightingMatches(value, chips) : null;
}
