import type { shopBySlugCached } from "@/features/shops-cached";
import type { DiverTranslator } from "@/i18n/messages";
import { parseBrandBadges } from "@/lib/brand";
import type { ReviewAggregate } from "@/lib/reviews";
import { ShopfrontHero } from "./ShopfrontHero";
import { ShopPhotoStrip } from "./ShopPhotoStrip";
import { hasShopWelcomeContent } from "./ShopWelcome";

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
  // The welcome already introduces the shop. Below the board keep its full
  // description and additional photos, without repeating its rating or cover.
  const welcomeShown = hasShopWelcomeContent(shop);
  if (welcomeShown && !shop.description?.trim() && shop.shopfrontPhotoUrls.length === 0) {
    return null;
  }
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
    <section className={className} aria-label={shop.name}>
      <ShopfrontHero
        headingLevel="h2"
        name={shop.name}
        tagline={welcomeShown ? null : shop.tagline}
        description={shop.description}
        aggregate={welcomeShown ? null : aggregate}
        heroImage={
          !welcomeShown && shop.brandHeroImageUrl
            ? { url: shop.brandHeroImageUrl, alt: shop.brandHeroImageAlt ?? "" }
            : null
        }
        badges={welcomeShown ? [] : parseBrandBadges(shop.brandBadges)}
        isDemo={shop.isDemo}
        establishedYear={welcomeShown ? null : shop.establishedYear}
        locale={locale}
        t={t}
      />
      {shop.shopfrontPhotoUrls.length > 0 ? (
        <div className="mt-8">
          <ShopPhotoStrip urls={shop.shopfrontPhotoUrls} label={t("schedule.shopPhotos")} t={t} />
        </div>
      ) : null}
    </section>
  );
}
