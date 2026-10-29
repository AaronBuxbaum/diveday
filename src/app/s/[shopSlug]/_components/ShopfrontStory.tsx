import type { shopBySlugCached } from "@/db/shops-cached";
import type { DiverTranslator } from "@/i18n/messages";
import { parseBrandBadges } from "@/lib/brand";
import type { ReviewAggregate } from "@/lib/reviews";
import { ShopfrontHero } from "./ShopfrontHero";
import { ShopPhotoStrip } from "./ShopPhotoStrip";

/** A name is still shown elsewhere in the public shell; this story earns its
 * space only when the shop has contributed something beyond that identity. */
export function hasShopfrontStoryContent({
  tagline,
  description,
  heroImageUrl,
  photoUrls,
  reviewCount,
  badges,
  establishedYear,
}: {
  tagline: string | null;
  description: string | null;
  heroImageUrl: string | null;
  photoUrls: readonly string[];
  reviewCount: number;
  badges: readonly string[];
  establishedYear: number | null;
}): boolean {
  return Boolean(
    tagline?.trim() ||
      description?.trim() ||
      heroImageUrl ||
      photoUrls.length ||
      reviewCount > 0 ||
      badges.length ||
      establishedYear,
  );
}

/** Shop marketing stays on screen; the printed schedule keeps operational facts. */
export function ShopfrontStory({
  shop,
  aggregate,
  locale,
  t,
  className,
}: {
  shop: NonNullable<Awaited<ReturnType<typeof shopBySlugCached>>>;
  aggregate: ReviewAggregate;
  locale: string;
  t: DiverTranslator;
  className: string;
}) {
  if (
    !hasShopfrontStoryContent({
      tagline: shop.tagline,
      description: shop.description,
      heroImageUrl: shop.brandHeroImageUrl,
      photoUrls: shop.shopfrontPhotoUrls,
      reviewCount: aggregate.count,
      badges: parseBrandBadges(shop.brandBadges),
      establishedYear: shop.establishedYear,
    })
  ) {
    return null;
  }

  return (
    <section className={`${className} print:hidden`} aria-label={shop.name}>
      <ShopfrontHero
        headingLevel="h2"
        name={shop.name}
        tagline={shop.tagline}
        description={shop.description}
        aggregate={aggregate}
        heroImage={
          shop.brandHeroImageUrl
            ? { url: shop.brandHeroImageUrl, alt: shop.brandHeroImageAlt ?? "" }
            : null
        }
        badges={parseBrandBadges(shop.brandBadges)}
        establishedYear={shop.establishedYear}
        locale={locale}
        t={t}
      />
      {shop.shopfrontPhotoUrls.length > 0 ? (
        <div className="mt-8 print:hidden">
          <ShopPhotoStrip urls={shop.shopfrontPhotoUrls} label={t("schedule.shopPhotos")} />
        </div>
      ) : null}
    </section>
  );
}
