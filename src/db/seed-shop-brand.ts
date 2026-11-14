import { and, eq, isNull, or, sql } from "drizzle-orm";
import { demoIllustration } from "@/content/demo-illustrations";
import type { DbExecutor } from "./client";
import { DEMO_SHOP_SLUG } from "./demo-shop";
import { boats, shops } from "./schema";
import { DEMO_SHOP_BRAND_COLOR } from "./seed-identifiers";
import { DEMO_SHOP_REPLY_NOTES } from "./seed-reply-notes";

/**
 * **Blue Mantis's profile and brand: everything a trading shop fills in on
 * Settings → Shop profile & branding.** A tagline and an about line, a logo, a
 * colour and a display face, a cover photo and a photo strip.
 * The demo is what a prospect reads as "what my shop would look like", and a
 * profile page with half its fields blank told them the shop had not finished
 * setting up (Aaron, 2026-10-22).
 *
 * The logo is a drawn mark served from `public/demo-shop/`, not a photograph, so it
 * repeats no picture on the storefront (`seed-brand-photos.test.ts`). Generated
 * demo-only illustrations are recorded in `src/content/photo-records.json`:
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
  brandHeroImageUrl: demoIllustration("boat").url,
  // i18n-exempt: a shop writes its own alt text, like its tagline.
  brandHeroImageAlt: demoIllustration("boat").alt,
  establishedYear: 1998,
  // The shop is fictional; third-party accreditation would imply real membership.
  brandBadges: [],
  // Fictional demo scenes, never claimed as photographs of the operator.
  shopfrontPhotoUrls: (["dock", "briefing", "student", "reef", "oxygen"] as const).map(
    (scene) => demoIllustration(scene).url,
  ),
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
  const [demo] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(and(eq(shops.slug, DEMO_SHOP_SLUG), eq(shops.isDemo, true)))
    .limit(1);
  if (demo) {
    for (const [name, scene] of [
      ["Mantis I", "fleet"],
      ["Mantis II", "boat"],
    ] as const) {
      await db
        .update(boats)
        .set({ photoUrl: demoIllustration(scene).url })
        .where(and(eq(boats.shopId, demo.id), eq(boats.name, name), isNull(boats.photoUrl)));
    }
  }
  // Remove only the original fictional defaults, never a real shop's badges or
  // a demo visitor's own selection. They imply affiliations the shop cannot hold.
  await db
    .update(shops)
    .set({ brandBadges: [] })
    .where(
      and(
        eq(shops.slug, DEMO_SHOP_SLUG),
        eq(shops.isDemo, true),
        sql`${shops.brandBadges} = ${JSON.stringify(["padi_5_star", "padi_idc", "green_fins", "blue_star", "dan_partner", "tripadvisor"])}::jsonb`,
      ),
    );
  await db
    .update(shops)
    .set(DEMO_SHOP_BRAND)
    .where(and(eq(shops.slug, DEMO_SHOP_SLUG), eq(shops.isDemo, true), isNull(shops.logoUrl)));
}

// i18n-exempt: the fictional shop's own packing suggestion.
const OPTIONAL_SEASICKNESS_SUPPLIES = "Seasickness supplies, if you use them";

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
  replyNotes: DEMO_SHOP_REPLY_NOTES,
  // i18n-exempt: the shop's own packing list, like its notes for AI.
  packingList: [
    "Swimsuit and towel",
    "Reef-safe sun protection",
    "Light layer for the ride back",
    OPTIONAL_SEASICKNESS_SUPPLIES,
    "Refillable water bottle",
  ],
  // i18n-exempt: a review link is a URL the shop pastes in.
  reviewUrl: "https://g.page/r/blue-mantis-divers/review",
  // i18n-exempt: the shop's own rental terms, printed on its tickets.
  rentalTerms:
    "Gear is due back at the dock when the boat ties up. A late return is $15 per day. A lost or damaged unit is charged at replacement cost.",
} satisfies Partial<typeof shops.$inferInsert>;

/** Correct known demo defaults without replacing a shop's own checklist or notes. */
export async function syncDemoShopPackingCopy(db: DbExecutor): Promise<void> {
  // i18n-exempt: exact previously seeded shop-authored words, not rendered copy.
  const timedMedicine = "Seasickness tablets, taken the night before";
  // i18n-exempt: exact previously seeded shop-authored words, as above.
  const combinedCardAndLogbook = "Your certification card and logbook";
  // i18n-exempt: exact previously seeded shop-authored words, as above.
  const timedReply = " Seasick divers should take medicine the night before.";
  await db
    .update(shops)
    .set({
      packingList: sql`coalesce((select jsonb_agg(case when item.value = ${timedMedicine} then ${OPTIONAL_SEASICKNESS_SUPPLIES} else item.value end order by item.ordinality) from jsonb_array_elements_text(${shops.packingList}) with ordinality as item(value, ordinality) where item.value <> ${combinedCardAndLogbook}), '[]'::jsonb)`,
      replyNotes: sql`replace(${shops.replyNotes}, ${timedReply}, '')`,
    })
    .where(
      and(
        eq(shops.slug, DEMO_SHOP_SLUG),
        eq(shops.isDemo, true),
        or(
          sql`${shops.packingList} ? ${timedMedicine}`,
          sql`${shops.packingList} ? ${combinedCardAndLogbook}`,
          sql`strpos(coalesce(${shops.replyNotes}, ''), ${timedReply}) > 0`,
        ),
      ),
    );
}
