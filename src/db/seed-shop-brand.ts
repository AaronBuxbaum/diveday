import { and, eq, isNull } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { DEMO_SHOP_SLUG } from "./demo-shop";
import { shops } from "./schema";
import { DEMO_SHOP_BRAND_COLOR } from "./seed-identifiers";

const bundled = (file: string) => `/dive-sites/${encodeURIComponent(file)}`;

/**
 * **Blue Mantis's profile and brand: everything a trading shop fills in on
 * Settings → Shop profile & branding.** A tagline and an about line, a logo, a
 * colour and a display face, a cover photo, a badge wall and a photo strip.
 * The demo is what a prospect reads as "what my shop would look like", and a
 * profile page with half its fields blank told them the shop had not finished
 * setting up (Aaron, 2026-10-22).
 *
 * The logo is a drawn mark served from `public/demo-shop/`, not a photograph, so it
 * repeats no picture on the storefront (`seed-brand-photos.test.ts`). Every
 * photo is a bundled, credited Commons frame (`public/dive-sites/README.md`):
 * the fleet configures no media storage, and a demo that renders broken images
 * the first time a network hiccups is worse than none.
 */
export const DEMO_SHOP_BRAND = {
  // i18n-exempt: a shop types its own tagline and about line, like its packing list.
  tagline: "Small-boat reef and wreck diving out of Key Largo.",
  // i18n-exempt: shop-authored, as above.
  description:
    "Two boats, fourteen divers at most, and a crew that knows every mooring on the reef. We sail twice a day to Molasses, French and Pickles, and to the Spiegel Grove and the Duane when the current allows.",
  logoUrl: "/demo-shop/blue-mantis-logo.png",
  brandColor: DEMO_SHOP_BRAND_COLOR,
  brandDisplayFont: "outfit",
  brandHeroImageUrl: bundled("Elkhorn coral 8 Molasses Reef 20080309.jpg"),
  // i18n-exempt: a shop writes its own alt text, like its tagline.
  brandHeroImageAlt: "Elkhorn coral on Molasses Reef, sunlight from above",
  establishedYear: 1998,
  brandBadges: ["padi_5_star", "blue_star", "tripadvisor"],
  // The photo strip under the cover: the reef, and the divers on it.
  shopfrontPhotoUrls: [
    "Blue Parrotfish on Molasses Outer Reef, Key Largo (15274849398).jpg",
    "US flag with diver on USS Spiegel Grove (LSD-32) wreck in 2007.jpg",
    "French Angelfish Pickles Reef 20230713.jpg",
    "BORSTAR divers training in Panama City, Fla. (29842460786).jpg",
    "FGBNMS - nurse shark (27551309652).jpg",
    "Diver at USNS General Hoyt S. Vandenberg (T-AGM-10) wreck off Key West in January 2015.jpg",
    "Restored staghorn coral (Acropora cervicornis) at Looe Key reef (106714).jpg",
    "Sponge 06 Molasses Reef 20230714.jpg",
  ].map(bundled),
} satisfies Partial<typeof shops.$inferInsert>;

/**
 * Dress the canonical demo shop in {@link DEMO_SHOP_BRAND} when it has no logo
 * yet. The seed writes the brand at insert, but the canonical shop is seeded
 * once per database and never again (`demo-refresh.ts`), so a database seeded
 * before the brand existed would never wear it. Matched on `isDemo` as well as
 * the slug, so it can never touch a real tenant; keyed on a blank logo, so it
 * runs once and leaves the shop alone afterwards. Taking the demo's logo off
 * brings the whole profile back the next night, tagline and about line too.
 */
export async function syncDemoShopBrand(db: DbExecutor): Promise<void> {
  await db
    .update(shops)
    .set(DEMO_SHOP_BRAND)
    .where(and(eq(shops.slug, DEMO_SHOP_SLUG), eq(shops.isDemo, true), isNull(shops.logoUrl)));
}
