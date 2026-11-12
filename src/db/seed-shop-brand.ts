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
  brandBadges: ["padi_5_star", "padi_idc", "green_fins", "blue_star", "dan_partner", "tripadvisor"],
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

/**
 * **What Blue Mantis tells its AI drafts and its rental counter**, in the
 * shop's own words (Settings → Features → Notes for AI; Rent out). Policies,
 * tone, what a trip includes, where to meet, cancellations and weather, gear and the
 * questions the desk answers every week: the facts a good reply quotes, with
 * nothing about a diver. The numbers match what the demo's schedule and
 * prices already say, since a draft may quote any number written here.
 */
export const DEMO_SHOP_DESK = {
  // i18n-exempt: a shop types its own notes for AI, like its packing list.
  replyNotes: `Tone: warm, brief and plain. We are a small crew who knows our regulars by name. Sign off with "See you on the water" and the crew member's first name.

Meeting spot: the Blue Mantis dock behind 100 Ocean Drive, Key Largo. Park behind the shop by the tank racks; the gate opens at 7:15. Check in 45 minutes before departure. The boat leaves on time.

What a trip includes: tanks, weights, a certified guide, water and fruit. Nitrox is a $12 fill. A full rental set is $45; singles are priced on the rental page. Towels and a reef-safe sunscreen are on the packing list.

Certification and medical: we need a valid card or a proof of certification from the diver. Anyone who answers yes to a medical question brings a doctor's note on the day. Do not give medical advice in a reply; point them to the waiver and the doctor.

Cancellations and weather: the captain decides by 6:00 the evening before. If we cancel for wind or seas, the diver picks another date or a full refund, no fee. If the diver cancels more than 48 hours ahead, we move the booking or refund it. Inside 48 hours we move it once.

Beginners: Discover Scuba runs in the pool first, then the reef. No certification needed; ages 10 and up. Open Water takes three days.

Common questions: we dive Molasses, French, Pickles, Christ of the Abyss and Benwood, and the Spiegel Grove when the current allows. Water is 78 to 84°F. We rent GoPros. Seasick divers should take medicine the night before.`,
  // i18n-exempt: the shop's own packing list, like its notes for AI.
  packingList: [
    "Swimsuit and towel",
    "Reef-safe sun protection",
    "Light layer for the ride back",
    "Seasickness tablets, taken the night before",
    "Refillable water bottle",
    "Your certification card and logbook",
  ],
  // i18n-exempt: a review link is a URL the shop pastes in.
  reviewUrl: "https://g.page/r/blue-mantis-divers/review",
  // i18n-exempt: the shop's own rental terms, printed on its tickets.
  rentalTerms:
    "Gear is due back at the dock when the boat ties up. A late return is $15 per day. A lost or damaged unit is charged at replacement cost.",
} satisfies Partial<typeof shops.$inferInsert>;
