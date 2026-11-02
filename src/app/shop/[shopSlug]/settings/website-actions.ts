"use server";

import { z } from "zod";
import { queueAndAttemptMediaDeletion } from "@/db/media-deletions";
import {
  getShopById,
  replaceShopfrontPhotos,
  setShopProfile,
  setShopSearchListing,
} from "@/db/shops";
import { defineAction, land, type NoticeOf } from "@/features/server-action";
import { isBrandDisplayFontCode, parseBrandBadges, parseBrandColor } from "@/lib/brand";
import { allValues, checkbox, formValue, text, trimmedText } from "@/lib/form-parse";
import { publicSchedulePath } from "@/lib/public-routes";
import { storeShopHeroImage, storeShopLogoImage } from "@/lib/storage";
import { MAX_NEW_SHOPFRONT_PHOTOS_PER_SAVE, MAX_SHOPFRONT_PHOTOS } from "@/lib/storage/limits";
import { SETTINGS_GATE } from "./action-gates";

const profileSchema = z.object({
  tagline: z.string().trim().max(120),
  description: z.string().trim().max(1000),
  brandHeroImageAlt: z.string().trim().max(200),
  // Blank is "not set"; a year outside the schema's check is refused here so
  // the form gets a notice rather than the database a 23514.
  establishedYear: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : Number(value)))
    .pipe(z.number().int().min(1900).max(2100).nullable()),
});

/** The profile form as posted; `profileSchema` and the brand parsers hold it to its bounds. */
const profileForm = z.object({
  tagline: trimmedText(),
  description: trimmedText(),
  brandHeroImageAlt: trimmedText(),
  establishedYear: text(),
  brandColor: formValue(),
  brandDisplayFont: text(),
  logoFile: formValue(),
  removeLogo: checkbox("true"),
  brandHeroFile: formValue(),
  removeHero: checkbox("true"),
  badge: allValues(),
});
/** The photo strip as posted: what to take off, and the files picked. */
const shopPhotosForm = z.object({
  removeShopPhotoUrls: allValues(),
  shopPhotoFiles: allValues(),
});
const searchListingForm = z.object({ searchListed: checkbox() });

/**
 * Shop profile & branding — tagline, about/description, the logo, and the
 * brand the storefront wears (Harbor, ADR 20260901-diveday-reimagined,
 * decision 2): colour, display face, hero photograph, badges, opening year.
 * The colour is stored as typed and checked at render; only its shape is
 * refused here.
 */
export const saveProfileAction = defineAction({
  gate: [SETTINGS_GATE],
  input: profileForm,
  async run({ db, shopId, shopSlug, path }, form) {
    const page = path("settings", "profile");
    const parsed = profileSchema.safeParse({
      tagline: form.tagline,
      description: form.description,
      brandHeroImageAlt: form.brandHeroImageAlt,
      establishedYear: form.establishedYear,
    });
    if (!parsed.success) return land(page, "profile-invalid");
    const brandColor = parseBrandColor(form.brandColor);
    if (!brandColor.valid) return land(page, "profile-invalid");
    const fontInput = form.brandDisplayFont;
    const brandDisplayFont = isBrandDisplayFontCode(fontInput) ? fontInput : null;
    const brandBadges = parseBrandBadges(form.badge);

    const shop = await getShopById(db, shopId);
    if (!shop) return land(page, "profile-invalid");

    let logoUrl: string | null | undefined;
    if (form.removeLogo) {
      logoUrl = null;
    } else if (form.logoFile instanceof File && form.logoFile.size > 0) {
      const stored = await storeShopLogoImage({
        filename: form.logoFile.name,
        contentType: form.logoFile.type,
        bytes: await form.logoFile.arrayBuffer(),
      });
      if (stored.status !== "stored") return land(page, "profile-invalid");
      logoUrl = stored.url;
    }

    let brandHeroImageUrl: string | null | undefined;
    if (form.removeHero) {
      brandHeroImageUrl = null;
    } else if (form.brandHeroFile instanceof File && form.brandHeroFile.size > 0) {
      const stored = await storeShopHeroImage({
        filename: form.brandHeroFile.name,
        contentType: form.brandHeroFile.type,
        bytes: await form.brandHeroFile.arrayBuffer(),
      });
      if (stored.status !== "stored") return land(page, "profile-invalid");
      brandHeroImageUrl = stored.url;
    }

    await setShopProfile(db, shopId, {
      tagline: parsed.data.tagline,
      description: parsed.data.description,
      ...(logoUrl !== undefined ? { logoUrl } : {}),
      brandColor: brandColor.value,
      brandDisplayFont,
      brandHeroImageAlt: parsed.data.brandHeroImageAlt,
      establishedYear: parsed.data.establishedYear,
      brandBadges,
      ...(brandHeroImageUrl !== undefined ? { brandHeroImageUrl } : {}),
    });

    if (logoUrl !== undefined && shop.logoUrl && shop.logoUrl !== logoUrl) {
      await queueAndAttemptMediaDeletion(db, { shopId, kind: "shop_logo", url: shop.logoUrl });
    }
    if (
      brandHeroImageUrl !== undefined &&
      shop.brandHeroImageUrl &&
      shop.brandHeroImageUrl !== brandHeroImageUrl
    ) {
      await queueAndAttemptMediaDeletion(db, {
        shopId,
        kind: "shop_hero",
        url: shop.brandHeroImageUrl,
      });
    }

    return land(page, "profile-saved", { also: [publicSchedulePath(shopSlug)] });
  },
});

/** What `/settings/profile` can be told after a save (`profileNoticeMessages`). */
export type ProfileNotice = NoticeOf<typeof saveProfileAction>;

/**
 * The storefront's photo strip: keep what was not ticked, add what was picked.
 *
 * Its own form rather than a field on the profile, because the profile already
 * posts a logo and a cover, and three more photos beside them would push one
 * save past the Server Action body limit (`MAX_NEW_SHOPFRONT_PHOTOS_PER_SAVE`).
 * Both caps are checked before a byte is stored. A refusal after storing (one
 * file of three rejected, or another save landing first) queues what it stored
 * for deletion, so it leaves no object behind; a photo taken off is queued for
 * deletion only once the row is saved (CR-012).
 */
export const saveShopPhotosAction = defineAction({
  gate: [SETTINGS_GATE],
  input: shopPhotosForm,
  async run({ db, shopId, shopSlug, path }, form) {
    const settings = path("settings");
    const refused = land(settings, "shop-photos-invalid", { extra: { saved: "shopPhotos" } });

    const shop = await getShopById(db, shopId);
    if (!shop) return refused;

    const removed = new Set(form.removeShopPhotoUrls.map(String));
    const kept = shop.shopfrontPhotoUrls.filter((url) => !removed.has(url));
    const picked = form.shopPhotoFiles.filter(
      (file): file is File => file instanceof File && file.size > 0,
    );
    if (
      picked.length > MAX_NEW_SHOPFRONT_PHOTOS_PER_SAVE ||
      kept.length + picked.length > MAX_SHOPFRONT_PHOTOS
    ) {
      return refused;
    }

    const stored = await Promise.all(
      picked.map(async (file) =>
        storeShopHeroImage({
          filename: file.name,
          contentType: file.type,
          bytes: await file.arrayBuffer(),
        }),
      ),
    );
    const added = stored.flatMap((result) => (result.status === "stored" ? [result.url] : []));
    const forget = async (urls: string[]) => {
      for (const url of urls) {
        await queueAndAttemptMediaDeletion(db, { shopId, kind: "shop_hero", url });
      }
    };
    if (added.length !== picked.length) {
      await forget(added);
      return refused;
    }

    const saved = await replaceShopfrontPhotos(db, shopId, shop.shopfrontPhotoUrls, [
      ...kept,
      ...added,
    ]);
    if (!saved) {
      await forget(added);
      return refused;
    }
    await forget(shop.shopfrontPhotoUrls.filter((url) => removed.has(url)));

    return land(settings, "shop-photos-saved", {
      extra: { saved: "shopPhotos" },
      also: [publicSchedulePath(shopSlug)],
    });
  },
});

/**
 * Whether this shop is listed in search engines. One checkbox, checked by
 * default, because a shop is listed by default — the box states the current
 * setting rather than asking the shop to opt in to something it already has
 * (ADR 20260813-search-listing-is-a-choice).
 */
export const saveSearchListingAction = defineAction({
  gate: [SETTINGS_GATE],
  input: searchListingForm,
  async run({ db, shopId, path }, { searchListed }) {
    await setShopSearchListing(db, shopId, searchListed);
    return land(path("settings"), searchListed ? "search-listing-on" : "search-listing-off", {
      extra: { saved: "searchListing" },
    });
  },
});
