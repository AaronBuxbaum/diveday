"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { getCourseBySlug, setCoursePublished, updateCourseContent } from "@/db/courses";
import {
  isCoursePublishable,
  parseFaqs,
  parseLines,
  parseScheduleDays,
  splitCourseImageUrls,
} from "@/lib/courses";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { storeCourseImage } from "@/lib/storage";

/**
 * The course page saves as one document. Every field here is prose a diver
 * reads; pricing, the cert gate, and scheduling visibility deliberately live on
 * other screens, because those change what the shop *does*, not what it says.
 */
const contentSchema = z.object({
  summary: z.string().trim().max(200),
  overview: z.string().trim().max(6_000),
  heroImageUrl: z.string().trim().max(2_000),
  imageUrls: z.string().max(12_000),
  durationText: z.string().trim().max(120),
  groupSizeText: z.string().trim().max(120),
  // 8 is the youngest an agency certifies anyone for anything (Bubblemaker);
  // below that the field is a typo, not a policy. This is a floor, not
  // enforcement — see the note in the editor.
  minimumAge: z.union([z.literal(""), z.coerce.number().int().min(8).max(99)]),
  prerequisiteNote: z.string().trim().max(400),
  includes: z.string().max(2_000),
  excludes: z.string().max(2_000),
  scheduleDays: z.string().max(8_000),
  faqs: z.string().max(12_000),
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

  const hero = await uploadImage(formData.get("heroImageFile"));
  const gallery = await Promise.all(formData.getAll("galleryImageFiles").map(uploadImage));
  if (hero.failed || gallery.some((image) => image.failed)) redirect(`${base}?error=upload`);

  let imageUrls: string[];
  let heroImageUrl: string;
  try {
    // An upload appends to the gallery the staff member can already see and
    // edit, so removing a photo is deleting its line — no second control.
    imageUrls = splitCourseImageUrls(
      [value.imageUrls, ...gallery.map((image) => image.url ?? "")].join("\n"),
    );
    [heroImageUrl = ""] = splitCourseImageUrls(hero.url ?? value.heroImageUrl);
  } catch {
    redirect(`${base}?error=images`);
  }

  const saved = await updateCourseContent(db, staff.user.shopId, course.id, {
    summary: value.summary,
    overview: value.overview,
    heroImageUrl,
    imageUrls,
    durationText: value.durationText,
    groupSizeText: value.groupSizeText,
    minimumAge: value.minimumAge === "" ? null : value.minimumAge,
    prerequisiteNote: value.prerequisiteNote,
    includes: parseLines(value.includes),
    excludes: parseLines(value.excludes),
    scheduleDays: parseScheduleDays(value.scheduleDays),
    faqs: parseFaqs(value.faqs),
    relatedCourseIds: formData.getAll("relatedCourseIds").map(String).filter(Boolean),
  });
  // The page the diver reads is a different route from the one staff just
  // saved; both have to go stale or the edit looks like it did not take.
  revalidatePath(`/shop/${shopSlug}/courses/${slug}`);
  revalidateAndRedirect(base, `${base}?notice=${saved ? "saved" : "invalid"}`);
}

export async function setCoursePublishedAction(shopSlug: string, slug: string, formData: FormData) {
  const base = `/shop/${shopSlug}/courses/${slug}/edit`;
  const staff = await requireStaffSession();
  const publish = formData.get("published") === "true";
  const db = await getDb();
  const course = await getCourseBySlug(db, staff.user.shopId, slug);
  if (!course) redirect(`/shop/${shopSlug}/courses?notice=invalid`);
  // An empty page reads as a broken shop, not as a draft — refuse rather than
  // publish something with nothing on it.
  if (publish && !isCoursePublishable(course)) redirect(`${base}?error=incomplete`);
  await setCoursePublished(db, staff.user.shopId, course.id, publish);
  revalidateAndRedirect(
    `/shop/${shopSlug}/courses/${slug}`,
    `${base}?notice=${publish ? "published" : "unpublished"}`,
  );
}
