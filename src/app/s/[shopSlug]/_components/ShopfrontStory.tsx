import type { shopBySlugCached } from "@/db/shops-cached";
import type { DiverTranslator } from "@/i18n/messages";
import { parseBrandBadges } from "@/lib/brand";
import type { ReviewAggregate } from "@/lib/reviews";
import { ShopfrontHero } from "./ShopfrontHero";
import { ShopPhotoStrip } from "./ShopPhotoStrip";

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
