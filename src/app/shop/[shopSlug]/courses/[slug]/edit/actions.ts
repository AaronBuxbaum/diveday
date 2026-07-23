"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import {
  getCourseBySlug,
  setCourseVisibility,
  updateCourse,
  updateCourseContent,
} from "@/db/courses";
import { parseFaqs, parseLines, parseScheduleDays, splitCourseImageUrls } from "@/lib/courses";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { storeCourseImage } from "@/lib/storage";
import { MAX_NEW_GALLERY_IMAGES_PER_SUBMISSION } from "@/lib/storage/limits";

const money = z.union([z.literal(""), z.coerce.number().nonnegative().max(100_000)]);
const centsFromDollars = (value: number | "") => (value === "" ? null : Math.round(value * 100));

/**
 * The course page saves as one document: the prose a diver reads, the photos,
 * and the two prices. The cert gate and the agency's minimum age deliberately
 * stay out — those are admission facts the shop does not set.
 */
const contentSchema = z.object({
  summary: z.string().trim().max(200),
  overview: z.string().trim().max(6_000),
  durationText: z.string().trim().max(120),
  groupSizeText: z.string().trim().max(120),
  prerequisiteNote: z.string().trim().max(400),
  includes: z.string().max(2_000),
  excludes: z.string().max(2_000),
  scheduleDays: z.string().max(8_000),
  faqs: z.string().max(12_000),
  price: money,
  eLearningPrice: money,
});

/** Upload one picked file; an empty file input is "no change", not a failure. */
async function uploadImage(file: FormDataEntryValue | null) {
  if (!(file instanceof File) || file.size === 0) return { url: undefined };
  const stored = await storeCourseImage({
    filename: file.name,
    contentType: file.type,
    bytes: await file.arrayBuffer(),
  });
  return stored.status === "stored" ? { url: stored.url } : { failed: true as const };
}

export async function saveCourseContentAction(shopSlug: string, slug: string, formData: FormData) {
  const base = `/shop/${shopSlug}/courses/${slug}/edit`;
  const staff = await requireStaffSession();
  const parsed = contentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base}?error=invalid`);
  const value = parsed.data;

  const db = await getDb();
  const course = await getCourseBySlug(db, staff.user.shopId, slug);
  if (!course) redirect(`/shop/${shopSlug}/courses?notice=invalid`);

  const newGalleryFiles = formData
    .getAll("galleryImageFiles")
    .filter((file): file is File => file instanceof File && file.size > 0);
  if (newGalleryFiles.length > MAX_NEW_GALLERY_IMAGES_PER_SUBMISSION) {
    redirect(`${base}?error=too-many-photos`);
  }

  const hero = await uploadImage(formData.get("heroImageFile"));
  const gallery = await Promise.all(newGalleryFiles.map(uploadImage));
  if (hero.failed || gallery.some((image) => image.failed)) redirect(`${base}?error=upload`);

  // Photos are managed by upload now: new files append to the gallery, and the
  // remove checkboxes drop existing ones. No pasted URLs to parse.
  const removedGallery = new Set(formData.getAll("removeGalleryUrls").map(String));
  const keptGallery = course.imageUrls.filter((url) => !removedGallery.has(url));
  const addedGallery = gallery
    .map((image) => image.url)
    .filter((url): url is string => Boolean(url));
  let imageUrls: string[];
  try {
    imageUrls = splitCourseImageUrls([...keptGallery, ...addedGallery].join("\n"));
  } catch {
    redirect(`${base}?error=images`);
  }

  const removeHero = formData.get("removeHero") === "true";
  const heroImageUrl = hero.url ?? (removeHero ? "" : (course.heroImageUrl ?? ""));

  const saved = await updateCourseContent(db, staff.user.shopId, course.id, {
    summary: value.summary,
    overview: value.overview,
    heroImageUrl,
    imageUrls,
    durationText: value.durationText,
    groupSizeText: value.groupSizeText,
    prerequisiteNote: value.prerequisiteNote,
    includes: parseLines(value.includes),
    excludes: parseLines(value.excludes),
    scheduleDays: parseScheduleDays(value.scheduleDays),
    faqs: parseFaqs(value.faqs),
  });
  // Pricing is a separate concern from the marketing copy, but the editor saves
  // both in one submit, so both land together.
  await updateCourse(db, staff.user.shopId, course.id, {
    priceCents: centsFromDollars(value.price),
    eLearningPriceCents: centsFromDollars(value.eLearningPrice),
  });
  // The page the diver reads is a different route from the one staff just
  // saved; both have to go stale or the edit looks like it did not take.
  revalidatePath(`/shop/${shopSlug}/courses/${slug}`);
  revalidateAndRedirect(base, `${base}?notice=${saved ? "saved" : "invalid"}`);
}

export async function setCourseVisibilityAction(
  shopSlug: string,
  slug: string,
  formData: FormData,
) {
  const base = `/shop/${shopSlug}/courses/${slug}/edit`;
  const staff = await requireStaffSession();
  const visible = formData.get("visible") === "true";
  const db = await getDb();
  const course = await getCourseBySlug(db, staff.user.shopId, slug);
  if (!course) redirect(`/shop/${shopSlug}/courses?notice=invalid`);
  await setCourseVisibility(db, staff.user.shopId, course.id, visible);
  revalidateAndRedirect(
    `/shop/${shopSlug}/courses/${slug}`,
    `${base}?notice=${visible ? "shown" : "hidden"}`,
  );
}
