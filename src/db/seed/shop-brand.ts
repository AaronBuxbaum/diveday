import { and, eq, isNull, or, sql } from "drizzle-orm";
import { demoIllustration } from "@/content/demo-illustrations";
import type { DbExecutor } from "../client";
import { DEMO_SHOP_SLUG } from "../demo-shop";
import { shops } from "../schema";
import { DEMO_SHOP_BRAND_COLOR } from "./identifiers";
import { DEMO_SHOP_REPLY_NOTES } from "./reply-notes";
import { seedShopPick } from "./shop-pick";
import { seedStaffProfilesByEmail } from "./staff-profiles";

/**
 * **Blue Mantis's profile and brand: everything a trading shop fills in on
 * Settings → Shop profile & branding.** A tagline and an about line, a logo, a
 * colour and a display face, a cover photo and a photo strip.
 * The demo is what a prospect reads as "what my shop would look like", and a
 * profile page with half its fields blank told them the shop had not finished
 * setting up (Aaron, 2026-10-22).
 *
 * The logo is a drawn mark served from `public/demo-shop/`, not a photograph, so it
 * repeats no picture on the storefront (`brand-photos.test.ts`). Generated
 * demo-only illustrations are recorded in `src/content/photo-records.json`:
 * the fleet configures no media storage, and a demo that renders broken images
 * the first time a network hiccups is worse than none.
 */
const ORIGINAL_PHOTO_STRIP = (["dock", "briefing", "student", "reef", "oxygen"] as const).map(
  (scene) => demoIllustration(scene).url,
);

export const DEMO_SHOP_BRAND = {
  // i18n-exempt: a shop types its own tagline and about line, like its packing list.
  tagline: "Small-boat reef and wreck diving out of Key Largo.",
  // i18n-exempt: shop-authored, as above.
  description:
    "Two boats, fourteen divers at most, and a crew that knows every mooring on the reef. We sail twice a day to Molasses, French and Pickles, and to the Spiegel Grove and the Duane when the current allows.",
  logoUrl: "/demo-shop/blue-mantis-logo.png",
  brandColor: DEMO_SHOP_BRAND_COLOR,
  brandDisplayFont: "outfit",
  brandHeroImageUrl: demoIllustration("sunset-boat").url,
  // i18n-exempt: a shop writes its own alt text, like its tagline.
  brandHeroImageAlt: demoIllustration("sunset-boat").alt,
  establishedYear: 1998,
  // **The owner's voice and the shop's word of the day** (#4928): the signed welcome under the
  // heading and one posted notice, so the demo shows the features that
  // put a person and a fact in front of a diver who has not booked. Shop-authored, one wording.
  // i18n-exempt: the owner's own welcome, like the tagline above.
  welcomeText:
    "We opened in 1998 with one boat and a love of Molasses Reef. Fourteen divers at most, a briefing on every boat, and a captain who will call a dive off when the water says so. Come dive with us.",
  // i18n-exempt: the owner signs in her own name.
  welcomeSigner: "Dana Reyes, owner",
  // i18n-exempt: shop-authored notice line, true to the schedule the demo seeds.
  noticeText:
    "Wreck trips to the Spiegel Grove and the Duane go when the current allows, and we make the call the evening before.",
  // Fictional examples, labelled as such wherever a demo renders them.
  brandBadges: ["padi_5_star", "padi_idc", "green_fins", "blue_star", "dan_partner", "tripadvisor"],
  // Fictional demo scenes, never claimed as photographs of the operator.
  shopfrontPhotoUrls: [
    ...ORIGINAL_PHOTO_STRIP,
    demoIllustration("shopfront").url,
    demoIllustration("porch").url,
    demoIllustration("boat").url,
  ],
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
 * Give a demo database seeded before the welcome and the notice existed the
 * same warmth, once: keyed on a blank welcome, so a shop owner who clears or rewrites it in the
 * demo is left alone afterwards. The pick is set with the schedule (`shop-pick.ts`), because a
 * reset replaces the courses it points at.
 */
export async function syncDemoShopWelcome(db: DbExecutor): Promise<void> {
  const { welcomeText, welcomeSigner, noticeText } = DEMO_SHOP_BRAND;
  const [shop] = await db
    .update(shops)
    .set({ welcomeText, welcomeSigner, noticeText })
    .where(and(eq(shops.slug, DEMO_SHOP_SLUG), eq(shops.isDemo, true), isNull(shops.welcomeText)))
    .returning({ id: shops.id });
  if (!shop) return;
  await seedShopPick(db, shop.id);
  await seedStaffProfilesByEmail(db, shop.id);
}

// i18n-exempt: the fictional shop's own packing suggestion; one wording for a boat day and a course day.
const LIGHT_LAYER = "A light layer for after your dive";

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
    LIGHT_LAYER,
    "Refillable water bottle",
  ],
  // i18n-exempt: a review link is a URL the shop pastes in.
  reviewUrl: "https://g.page/r/blue-mantis-divers/review",
  // i18n-exempt: the shop's own rental terms, printed on its tickets.
  rentalTerms:
    "Gear is due back at the dock when the boat ties up. A late return is $15 per day. A lost or damaged unit is charged at replacement cost.",
} satisfies Partial<typeof shops.$inferInsert>;

/**
 * Correct known demo defaults without replacing a shop's own checklist or notes. The list is one
 * for the whole shop, so it names no boat: a course day reads it too, and the seasickness line
 * the demo once carried belongs in the boat-day reminder, not on a pool morning.
 */
export async function syncDemoShopPackingCopy(db: DbExecutor): Promise<void> {
  // i18n-exempt: exact previously seeded shop-authored words, not rendered copy.
  const timedMedicine = "Seasickness tablets, taken the night before";
  // i18n-exempt: exact previously seeded shop-authored words, as above.
  const optionalSupplies = "Seasickness supplies, if you use them";
  // i18n-exempt: exact previously seeded shop-authored words, as above.
  const rideBackLayer = "Light layer for the ride back";
  // i18n-exempt: exact previously seeded shop-authored words, as above.
  const combinedCardAndLogbook = "Your certification card and logbook";
  // i18n-exempt: exact previously seeded shop-authored words, as above.
  const timedReply = " Seasick divers should take medicine the night before.";
  await db
    .update(shops)
    .set({
      packingList: sql`coalesce((select jsonb_agg(case when item.value = ${rideBackLayer} then ${LIGHT_LAYER} else item.value end order by item.ordinality) from jsonb_array_elements_text(${shops.packingList}) with ordinality as item(value, ordinality) where item.value <> ${combinedCardAndLogbook} and item.value <> ${timedMedicine} and item.value <> ${optionalSupplies}), '[]'::jsonb)`,
      replyNotes: sql`replace(${shops.replyNotes}, ${timedReply}, '')`,
    })
    .where(
      and(
        eq(shops.slug, DEMO_SHOP_SLUG),
        eq(shops.isDemo, true),
        or(
          sql`${shops.packingList} ? ${timedMedicine}`,
          sql`${shops.packingList} ? ${optionalSupplies}`,
          sql`${shops.packingList} ? ${rideBackLayer}`,
          sql`${shops.packingList} ? ${combinedCardAndLogbook}`,
          sql`strpos(coalesce(${shops.replyNotes}, ''), ${timedReply}) > 0`,
        ),
      ),
    );
}
