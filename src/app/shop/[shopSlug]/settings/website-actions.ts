"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { queueAndAttemptMediaDeletion } from "@/db/media-deletions";
import {
  getShopById,
  replaceShopfrontPhotos,
  setShopProfile,
  setShopSearchListing,
} from "@/db/shops";
import { isBrandDisplayFontCode, parseBrandBadges, parseBrandColor } from "@/lib/brand";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { storeShopHeroImage, storeShopLogoImage } from "@/lib/storage";
import { MAX_NEW_SHOPFRONT_PHOTOS_PER_SAVE, MAX_SHOPFRONT_PHOTOS } from "@/lib/storage/limits";
import { settingsBlock } from "./action-helpers";

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

/**
 * Shop profile & branding — tagline, about/description, the logo, and the
 * brand the storefront wears (Harbor, ADR 20260901-diveday-reimagined,
 * decision 2): colour, display face, hero photograph, badges, opening year.
 * The colour is stored as typed and checked at render; only its shape is
 * refused here.
 */
export async function saveProfileAction(formData: FormData) {
  const session = await requireStaffSession();
  const page = shopPath(session.user.shopSlug, "settings", "profile");
  await settingsBlock(session);

  const parsed = profileSchema.safeParse({
    tagline: String(formData.get("tagline") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim(),
    brandHeroImageAlt: String(formData.get("brandHeroImageAlt") ?? "").trim(),
    establishedYear: String(formData.get("establishedYear") ?? ""),
  });
  if (!parsed.success) redirect(noticeUrl(page, "profile-invalid"));
  const brandColor = parseBrandColor(formData.get("brandColor"));
  if (!brandColor.valid) redirect(noticeUrl(page, "profile-invalid"));
  const fontInput = String(formData.get("brandDisplayFont") ?? "");
  const brandDisplayFont = isBrandDisplayFontCode(fontInput) ? fontInput : null;
  const brandBadges = parseBrandBadges(formData.getAll("badge"));

  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) redirect(noticeUrl(page, "profile-invalid"));

  const logoFile = formData.get("logoFile");
  const removeLogo = formData.get("removeLogo") === "true";

  let logoUrl: string | null | undefined;

  if (removeLogo) {
    logoUrl = null;
  } else if (logoFile instanceof File && logoFile.size > 0) {
    const stored = await storeShopLogoImage({
      filename: logoFile.name,
      contentType: logoFile.type,
      bytes: await logoFile.arrayBuffer(),
    });
    if (stored.status === "stored") {
      logoUrl = stored.url;
    } else {
      redirect(noticeUrl(page, "profile-invalid"));
    }
  }

  const heroFile = formData.get("brandHeroFile");
  const removeHero = formData.get("removeHero") === "true";
  let brandHeroImageUrl: string | null | undefined;
  if (removeHero) {
    brandHeroImageUrl = null;
  } else if (heroFile instanceof File && heroFile.size > 0) {
    const stored = await storeShopHeroImage({
      filename: heroFile.name,
      contentType: heroFile.type,
      bytes: await heroFile.arrayBuffer(),
    });
    if (stored.status === "stored") {
      brandHeroImageUrl = stored.url;
    } else {
      redirect(noticeUrl(page, "profile-invalid"));
    }
  }

  await setShopProfile(db, session.user.shopId, {
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
    await queueAndAttemptMediaDeletion(db, {
      shopId: session.user.shopId,
      kind: "shop_logo",
      url: shop.logoUrl,
    });
  }
  if (
    brandHeroImageUrl !== undefined &&
    shop.brandHeroImageUrl &&
    shop.brandHeroImageUrl !== brandHeroImageUrl
  ) {
    await queueAndAttemptMediaDeletion(db, {
      shopId: session.user.shopId,
      kind: "shop_hero",
      url: shop.brandHeroImageUrl,
    });
  }

  revalidatePath(`/s/${session.user.shopSlug}`);
  revalidateAndRedirect(page, noticeUrl(page, "profile-saved"));
}

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
export async function saveShopPhotosAction(formData: FormData) {
  const session = await requireStaffSession();
  const settings = shopPath(session.user.shopSlug, "settings");
  await settingsBlock(session);
  const refuse: () => never = () =>
    redirect(noticeUrl(settings, "shop-photos-invalid", { saved: "shopPhotos" }));

  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) refuse();

  const removed = new Set(formData.getAll("removeShopPhotoUrls").map(String));
  const kept = shop.shopfrontPhotoUrls.filter((url) => !removed.has(url));
  const picked = formData
    .getAll("shopPhotoFiles")
    .filter((file): file is File => file instanceof File && file.size > 0);
  if (
    picked.length > MAX_NEW_SHOPFRONT_PHOTOS_PER_SAVE ||
    kept.length + picked.length > MAX_SHOPFRONT_PHOTOS
  ) {
    refuse();
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
      await queueAndAttemptMediaDeletion(db, {
        shopId: session.user.shopId,
        kind: "shop_hero",
        url,
      });
    }
  };
  if (added.length !== picked.length) {
    await forget(added);
    refuse();
  }

  const saved = await replaceShopfrontPhotos(db, session.user.shopId, shop.shopfrontPhotoUrls, [
    ...kept,
    ...added,
  ]);
  if (!saved) {
    await forget(added);
    refuse();
  }
  await forget(shop.shopfrontPhotoUrls.filter((url) => removed.has(url)));

  revalidatePath(`/s/${session.user.shopSlug}`);
  revalidatePath(settings);
  revalidateAndRedirect(
    settings,
    noticeUrl(settings, "shop-photos-saved", { saved: "shopPhotos" }),
  );
}

/**
 * Whether this shop is listed in search engines. One checkbox, checked by
 * default, because a shop is listed by default — the box states the current
 * setting rather than asking the shop to opt in to something it already has
 * (ADR 20260813-search-listing-is-a-choice).
 */
export async function saveSearchListingAction(formData: FormData) {
  const session = await requireStaffSession();
  const settings = shopPath(session.user.shopSlug, "settings");
  await settingsBlock(session);
  const listed = formData.get("searchListed") === "on";
  await setShopSearchListing(await getDb(), session.user.shopId, listed);
  const notice = listed ? "search-listing-on" : "search-listing-off";
  revalidateAndRedirect(settings, noticeUrl(settings, notice, { saved: "searchListing" }));
}
