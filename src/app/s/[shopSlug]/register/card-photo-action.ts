"use server";

import { shopAssist } from "@/db/assist-shop";
import { getDb } from "@/db/client";
import { shopBySlugCached } from "@/db/shops-cached";
import { diverTranslator } from "@/i18n/messages";
import { DIVER_CERT_LEVEL_KEYS } from "@/i18n/next-dive-labels";
import {
  CERT_SCAN_FEATURE,
  certScanCall,
  certScanFields,
  parseCardImage,
  scanCard,
} from "@/lib/assists/cert-scan";
import { checkRateLimitFailClosed, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { SELF_DECLARED_AGENCIES, SELF_DECLARED_LEVELS } from "@/lib/self-registration";

/**
 * **The walk-up form's card photo** (`certscan`). The photo answers the three
 * boxes the diver would type (agency, level, number) and nothing else: no row
 * is written, the image is not kept, and what the diver then submits is still
 * filed as their own word, never as evidence. A card it cannot read fills
 * nothing, and the diver types it as before.
 *
 * Anonymous, so it is bucketed like the registration itself: the address
 * first, then the shop, so one address cannot spend a counter's allowance. The
 * shop's bucket is a daily one well under the monthly cap, both fail closed,
 * and a photo Haiku says is not a card is never sent on to Sonnet
 * (`scanCard`), so the public cannot spend the staff's assists dark.
 */
export async function readCardPhotoAtShopAction(
  shopSlug: string,
  image: { data: string; mediaType: string },
): Promise<Record<string, string> | null> {
  const parsed = parseCardImage(image?.data, image?.mediaType);
  if (!parsed) return null;
  // Every pass is a paid call on the shop's own cap, so both buckets fail
  // closed: a store outage reads no card, and the diver types it as before.
  const ip = await clientIp();
  if (
    !(await checkRateLimitFailClosed(rateLimitKey("card-scan-ip", ip), RATE_LIMITS.cardScanByIp))
      .allowed
  ) {
    return null;
  }
  const shop = await shopBySlugCached(shopSlug);
  if (!shop) return null;
  // A daily slice of the shop's monthly cap, keyed on the shop itself: the
  // public can never spend more of the staff's budget than this.
  if (
    !(
      await checkRateLimitFailClosed(
        rateLimitKey("card-scan-shop", shop.id),
        RATE_LIMITS.cardScanByShop,
      )
    ).allowed
  ) {
    return null;
  }
  const db = await getDb();
  // The card options in the shop's own language: the model reads the card's
  // words against these labels, and the shop's language is the likeliest match.
  const words = diverTranslator(shop.defaultLocale);
  const options = {
    agencies: SELF_DECLARED_AGENCIES,
    cards: SELF_DECLARED_LEVELS.map(
      (level) => [level, words(DIVER_CERT_LEVEL_KEYS[level])] as const,
    ),
  };
  const value = await scanCard((model) =>
    shopAssist(db, {
      shopId: shop.id,
      feature: CERT_SCAN_FEATURE,
      call: certScanCall(parsed, options, model),
    }),
  );
  const fields = certScanFields(value);
  const values: Record<string, string> = {};
  if (fields.agency) values.agency = fields.agency;
  if (fields.card) values.level = fields.card;
  if (fields.cardNumber) values.identifier = fields.cardNumber;
  return Object.keys(values).length > 0 ? values : null;
}
