"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { getCourseBySlug, updateCourse, updateCourseContent } from "@/db/courses";
import { queueAndAttemptMediaDeletion } from "@/db/media-deletions";
import { getShopById } from "@/db/shops";
import {
  courseDepthPlaceholderIssues,
  parseFaqs,
  parseLines,
  sanitizeScheduleDays,
  splitCourseImageUrls,
} from "@/lib/courses";
import { majorToMinor, maxPriceMajor, toShopCurrency } from "@/lib/money";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { storeCourseImage } from "@/lib/storage";
import { MAX_NEW_GALLERY_IMAGES_PER_SUBMISSION } from "@/lib/storage/limits";

/**
 * A typed price, empty meaning "not priced". The ceiling is currency-relative
 * (`MAX_PRICE_MINOR_UNITS`) — a flat 100,000 would refuse an ordinary
 * ¥150,000 course while allowing an absurd $100,000 one.
 */
const moneyFor = (currency: string) =>
  z.union([z.literal(""), z.coerce.number().nonnegative().max(maxPriceMajor(currency))]);
/**
 * A price a shop typed → stored minor units, empty meaning "not priced".
 * The multiplier comes from the shop's currency, so 5000 in a JPY shop's box
 * stores ¥5,000 rather than a hundredfold ¥500,000 (`src/lib/money.ts`).
 */
const centsFromAmount = (value: number | "", currency: string) =>
  value === "" ? null : majorToMinor(value, currency);

/**
 * The course page saves as one document: the prose a diver reads, the photos,
 * and the two prices. The cert gate and the agency's minimum age deliberately
 * stay out — those are admission facts the shop does not set.
 */
const contentSchemaFor = (currency: string) =>
  z.object({
    summary: z.string().trim().max(200),
    overview: z.string().trim().max(6_000),
    durationText: z.string().trim().max(120),
    groupSizeText: z.string().trim().max(120),
    prerequisiteNote: z.string().trim().max(400),
    includes: z.string().max(2_000),
    excludes: z.string().max(2_000),
    scheduleDaysJson: z.string().max(20_000),
    faqs: z.string().max(12_000),
    price: moneyFor(currency),
    eLearningPrice: moneyFor(currency),
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

  const db = await getDb();
  const course = await getCourseBySlug(db, staff.user.shopId, slug);
  if (!course) redirect(`/shop/${shopSlug}/courses?notice=invalid`);
  // Loaded before parsing, not after: the shop's own currency is what decides
  // both what the numbers in the price boxes mean and how large one may be.
  const shop = await getShopById(db, staff.user.shopId);
  if (!shop) redirect(`/shop/${shopSlug}/courses?notice=invalid`);
  const currency = toShopCurrency(shop.currency);

  const parsed = contentSchemaFor(currency).safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    // The first failing field, so the page can anchor and highlight it rather
    // than leaving a fifteen-input form to one generic "check the fields"
    // message with no clue which one.
    const field = parsed.error.issues[0]?.path[0];
    redirect(`${base}?error=invalid${typeof field === "string" ? `&field=${field}` : ""}`);
  }
  const value = parsed.data;

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
  const keptGallery = course.galleryPhotos
    .map((photo) => photo.url)
    .filter((url) => !removedGallery.has(url));
  const addedGallery = gallery
    .map((image) => image.url)
    .filter((url): url is string => Boolean(url));
  let imageUrls: string[];
  try {
    imageUrls = splitCourseImageUrls([...keptGallery, ...addedGallery].join("\n"));
  } catch {
    redirect(`${base}?error=images`);
  }

  // On the wire the captions still arrive as two same-length lists (one hidden
  // input per existing photo's URL, one text input for its caption) rather than
  // one input keyed by the URL, so a URL never has to survive being an HTML
  // attribute value. They are paired back up *here*, by URL and not by index,
  // and stored as one object per photo — a browser that posts the two lists
  // out of step can no longer put a caption under someone else's photo
  // (DATA-L4). A freshly-uploaded photo has no caption input yet: it starts
  // blank and falls back to the generated "{title} — photo {n}" until edited.
  const altUrls = formData.getAll("galleryAltUrls").map(String);
  const altValues = formData.getAll("galleryAltValues").map(String);
  const altByUrl = new Map(altUrls.map((url, index) => [url, altValues[index]?.trim() ?? ""]));
  const galleryPhotos = imageUrls.map((url) => ({ url, alt: altByUrl.get(url) ?? "" }));

  const removeHero = formData.get("removeHero") === "true";
  const heroImageUrl = hero.url ?? (removeHero ? "" : (course.heroImageUrl ?? ""));
  // A freshly-uploaded or removed hero has no caption input on screen yet —
  // starts blank rather than carrying over the previous photo's caption.
  const heroImageAlt =
    hero.url || removeHero ? "" : String(formData.get("heroImageAlt") ?? "").trim();

  let scheduleDays: ReturnType<typeof sanitizeScheduleDays>;
  try {
    scheduleDays = sanitizeScheduleDays(JSON.parse(value.scheduleDaysJson));
  } catch {
    scheduleDays = null;
  }
  if (scheduleDays === null) redirect(`${base}?error=invalid&field=scheduleDaysJson`);

  // Depth markers, checked before anything is written.
  //
  // This is the one place shop-editable prose is also a small message format,
  // and the failure it guards is silent by construction: a half-edited
  // `{depth 18}` parses as ordinary text everywhere downstream and simply
  // renders its own braces to a diver. Deleting a marker outright is *not* an
  // error — that is a shop choosing to write the depth in its own words, which
  // is what this content is for. Only a broken attempt is refused, and the
  // whole save is refused rather than partially applied, so what staff see on
  // the form is still exactly what is stored.
  const depthChecked: Array<[field: string, text: string]> = [
    ["summary", value.summary],
    ["overview", value.overview],
    ["durationText", value.durationText],
    ["groupSizeText", value.groupSizeText],
    ["prerequisiteNote", value.prerequisiteNote],
    ["includes", value.includes],
    ["excludes", value.excludes],
    ["faqs", value.faqs],
    ...scheduleDays.flatMap<[string, string]>((day) =>
      [day.title, ...day.items].map((text) => ["scheduleDaysJson", text] as [string, string]),
    ),
  ];
  const broken = depthChecked.find(([, text]) => courseDepthPlaceholderIssues(text).length > 0);
  if (broken) redirect(`${base}?error=depth-placeholder&field=${broken[0]}`);

  const saved = await updateCourseContent(db, staff.user.shopId, course.id, {
    summary: value.summary,
    overview: value.overview,
    heroImageUrl,
    heroImageAlt,
    galleryPhotos,
    durationText: value.durationText,
    groupSizeText: value.groupSizeText,
    prerequisiteNote: value.prerequisiteNote,
    includes: parseLines(value.includes),
    excludes: parseLines(value.excludes),
    scheduleDays,
    faqs: parseFaqs(value.faqs),
  });
  // Pricing and the nitrox answer are the shop's own decisions rather than
  // marketing copy, but the editor saves everything in one submit, so they land
  // together with the page.
  await updateCourse(db, staff.user.shopId, course.id, {
    priceCents: centsFromAmount(value.price, currency),
    eLearningPriceCents: centsFromAmount(value.eLearningPrice, currency),
    nitroxCompatible: formData.get("nitroxCompatible") === "true",
  });

  // Once the content row is durably saved, any photo it no longer references
  // (replaced hero, removed gallery photo) is queued for provider deletion —
  // never blocked on storage, retried/owner-visible if it fails (CR-012).
  if (saved) {
    const supersededUrls = [
      ...(course.heroImageUrl && course.heroImageUrl !== heroImageUrl ? [course.heroImageUrl] : []),
      ...course.galleryPhotos.map((photo) => photo.url).filter((url) => !imageUrls.includes(url)),
    ];
    for (const url of supersededUrls) {
      await queueAndAttemptMediaDeletion(db, {
        shopId: staff.user.shopId,
        kind: "course_photo",
        url,
      });
    }
  }

  // The page the diver reads is a different route from the one staff just
  // saved; both have to go stale or the edit looks like it did not take.
  revalidatePath(`/shop/${shopSlug}/courses/${slug}`);
  revalidateAndRedirect(base, `${base}?notice=${saved ? "saved" : "invalid"}`);
}
