"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { canPersonConfigureTrips } from "@/db/authz";
import { getDb } from "@/db/client";
import {
  getCourseBySlug,
  pullCourseTemplateUpdates,
  setCourseVisibility,
  updateCourse,
  updateCourseContent,
} from "@/db/courses";
import { queueAndAttemptMediaDeletion } from "@/db/media-deletions";
import { getShopById } from "@/db/shops";
import {
  COURSE_CONTENT_LIMITS,
  courseDepthPlaceholderIssues,
  parseLines,
  readLearningMaterials,
  sanitizeFaqs,
  sanitizeLearningMaterials,
  sanitizeScheduleDays,
  splitCourseImageUrls,
} from "@/lib/courses";
import { checkbox, formValue, readForm, text, trimmedText } from "@/lib/form-parse";
import { majorToMinor, maxPriceMajor, toShopCurrency } from "@/lib/money";
import { revalidateAndRedirect } from "@/lib/navigation";
import { publicCoursePath } from "@/lib/public-routes";
import { requireShopSurface, requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { storeCourseImage } from "@/lib/storage";
import { MAX_NEW_GALLERY_IMAGES_PER_SUBMISSION } from "@/lib/storage/limits";
import { planSpanishBoxes, writeSpanishBoxes } from "../../../dive-sites/spanish-boxes";
import {
  planCourseFormRequirements,
  writeCourseFormRequirements,
} from "./course-form-requirements";

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
    // Lengths come from COURSE_CONTENT_LIMITS, which the published templates
    // are tested against — a ceiling the seeded content violates is one that
    // only ever fires on words the shop never wrote (ADR 20260814-course-depth-markers's
    // sibling lesson: Wreck Diver's 510-character note could not be saved at all).
    summary: z.string().trim().max(COURSE_CONTENT_LIMITS.summary),
    overview: z.string().trim().max(COURSE_CONTENT_LIMITS.overview),
    durationText: z.string().trim().max(COURSE_CONTENT_LIMITS.durationText),
    groupSizeText: z.string().trim().max(COURSE_CONTENT_LIMITS.groupSizeText),
    prerequisiteNote: z.string().trim().max(COURSE_CONTENT_LIMITS.prerequisiteNote),
    includes: z.string().max(COURSE_CONTENT_LIMITS.includes),
    excludes: z.string().max(COURSE_CONTENT_LIMITS.excludes),
    scheduleDaysJson: z.string().max(COURSE_CONTENT_LIMITS.scheduleDaysJson),
    faqsJson: z.string().max(COURSE_CONTENT_LIMITS.faqsJson),
    // Optional on the wire: a page rendered by the release before this
    // section existed posts no field, and that is "no materials typed", never
    // a refusal (AGENTS.md's expand/contract rule). Its absence keeps what the
    // row already holds rather than clearing it — see below.
    learningMaterialsJson: z.string().max(COURSE_CONTENT_LIMITS.learningMaterialsJson).optional(),
    price: moneyFor(currency),
    eLearningPrice: moneyFor(currency),
    privatePrice: moneyFor(currency),
  });

/**
 * The course form's photo, concurrency and nitrox fields, read as
 * `FormData.get` read them; `contentSchemaFor` holds the words and prices.
 */
const courseExtrasForm = z.object({
  heroImageFile: formValue(),
  removeHero: checkbox("true"),
  heroImageAlt: trimmedText(),
  expectedVersion: text(),
  nitroxCompatible: checkbox("true"),
  gearIncluded: checkbox("true"),
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
  const base = shopPath(shopSlug, "courses", slug, "edit");
  const courses = shopPath(shopSlug, "courses");
  const staff = (await requireShopSurface(shopSlug)).session;

  const db = await getDb();
  const course = await getCourseBySlug(db, staff.user.shopId, slug);
  if (!course) redirect(noticeUrl(courses, "invalid"));
  // Loaded before parsing, not after: the shop's own currency is what decides
  // both what the numbers in the price boxes mean and how large one may be.
  const shop = await getShopById(db, staff.user.shopId);
  if (!shop) redirect(noticeUrl(courses, "invalid"));
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

  const extras = readForm(courseExtrasForm, formData);
  const hero = await uploadImage(extras.heroImageFile);
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

  const removeHero = extras.removeHero;
  const heroImageUrl = hero.url ?? (removeHero ? "" : (course.heroImageUrl ?? ""));
  // A freshly-uploaded or removed hero has no caption input on screen yet —
  // starts blank rather than carrying over the previous photo's caption.
  const heroImageAlt = hero.url || removeHero ? "" : extras.heroImageAlt;

  let scheduleDays: ReturnType<typeof sanitizeScheduleDays>;
  try {
    scheduleDays = sanitizeScheduleDays(JSON.parse(value.scheduleDaysJson));
  } catch {
    scheduleDays = null;
  }
  if (scheduleDays === null) redirect(`${base}?error=invalid&field=scheduleDaysJson`);

  let faqs: ReturnType<typeof sanitizeFaqs>;
  try {
    faqs = sanitizeFaqs(JSON.parse(value.faqsJson));
  } catch {
    faqs = null;
  }
  if (faqs === null) redirect(`${base}?error=faq-incomplete&field=faqsJson`);

  // What students work through before day 1 (ADR
  // 20261008-course-learning-materials). A link that is not https is refused in
  // its own words — the one refusal the writer cannot see from the boxes.
  let learningMaterials = readLearningMaterials(course.learningMaterials);
  if (value.learningMaterialsJson !== undefined) {
    let materials: ReturnType<typeof sanitizeLearningMaterials>;
    try {
      materials = sanitizeLearningMaterials(JSON.parse(value.learningMaterialsJson));
    } catch {
      materials = { ok: false, reason: "invalid" };
    }
    if (!materials.ok) {
      redirect(
        `${base}?error=${materials.reason === "link" ? "materials-link" : "materials-incomplete"}&field=learningMaterialsJson`,
      );
    }
    learningMaterials = materials.materials;
  }

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
    ...faqs.flatMap<[string, string]>((faq) =>
      [faq.question, faq.answer].map((text) => ["faqsJson", text] as [string, string]),
    ),
    ...scheduleDays.flatMap<[string, string]>((day) =>
      [day.title, ...day.items].map((text) => ["scheduleDaysJson", text] as [string, string]),
    ),
    ...learningMaterials.flatMap<[string, string]>((material) =>
      [material.name, material.note ?? ""].map(
        (text) => ["learningMaterialsJson", text] as [string, string],
      ),
    ),
  ];
  const broken = depthChecked.find(([, text]) => courseDepthPlaceholderIssues(text).length > 0);
  if (broken) redirect(`${base}?error=depth-placeholder&field=${broken[0]}`);

  // **The course page's one Save writes its forms and its Spanish too**
  // (visual review 2026-10-24, A11). Both are asked here, before a single
  // byte is written, so a refusal of either refuses the whole save while the
  // course is still as it was. The forms list is read only when the page
  // drew it (`formsSection`): a reader who was not shown the list has not
  // asked for "no forms".
  const formsPlan = formData.has("formsSection")
    ? await planCourseFormRequirements(db, staff.user, course.id, formData)
    : null;
  if (formsPlan && !formsPlan.ok) redirect(noticeUrl(`${base}#forms`, formsPlan.notice));
  const spanish = await planSpanishBoxes(
    db,
    staff.user.shopId,
    { kind: "course", id: course.id },
    { summary: { text: value.summary, maxLength: 200 } },
    formData,
  );
  if (!spanish.ok) {
    redirect(`${base}?error=${spanish.reason === "stale" ? "spanish-stale" : "spanish-refused"}`);
  }

  // The row's edit generation as this page last saw it. Absent means the page
  // was rendered by a release that did not send one — see `updateCourseContent`.
  // A non-numeric value is treated as absent rather than thrown: this page is
  // the only thing that writes the field, so a bad one means an old release or
  // a hand-crafted post, and neither is worth a 500 over an input that can only
  // ever tighten the write.
  const expectedVersion = Number.parseInt(extras.expectedVersion, 10);

  const saved = await updateCourseContent(
    db,
    staff.user.shopId,
    course.id,
    {
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
      faqs,
      learningMaterials,
    },
    { expectedVersion: Number.isNaN(expectedVersion) ? null : expectedVersion },
  );
  // **Refused, and the page keeps what you typed.** Returning rather than
  // redirecting is the whole point: a redirect re-renders the form from the
  // database, which would throw away the very work this refusal exists to
  // protect (issue #820). Nothing else has been written at this point — the
  // pricing update below and the photo cleanup both come after.
  if (!saved.ok && saved.reason === "conflict") {
    return { ok: false as const, reason: "conflict" as const };
  }
  // The course is gone — deleted from another tab, or never this shop's. There
  // is nothing to price and nothing to revalidate, and carrying on would tell
  // the staffer their edit saved. `notFound()` is what the page itself does
  // when the row disappears out from under it.
  if (!saved.ok) notFound();
  // Pricing and the nitrox answer are the shop's own decisions rather than
  // marketing copy, but the editor saves everything in one submit, so they land
  // together with the page.
  await updateCourse(db, staff.user.shopId, course.id, {
    priceCents: centsFromAmount(value.price, currency),
    eLearningPriceCents: centsFromAmount(value.eLearningPrice, currency),
    privatePriceCents: centsFromAmount(value.privatePrice, currency),
    nitroxCompatible: extras.nitroxCompatible,
    gearIncluded: extras.gearIncluded,
  });

  if (formsPlan?.ok) {
    const refused = await writeCourseFormRequirements(db, formsPlan.write);
    if (refused) redirect(noticeUrl(`${base}#forms`, refused));
    // Every roster and prep page reading this course's readiness changes with it.
    revalidatePath(shopPath(staff.user.shopSlug), "layout");
  }
  await writeSpanishBoxes(db, staff.user.shopId, { kind: "course", id: course.id }, spanish.boxes);

  // Once the content row is durably saved, any photo it no longer references
  // (replaced hero, removed gallery photo) is queued for provider deletion —
  // never blocked on storage, retried/owner-visible if it fails (CR-012).
  {
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
  revalidatePath(base);
  revalidateAndRedirect(base, noticeUrl(base, "saved"));
}

/**
 * Pull a newer code-owned template revision into one shop course. The mode is
 * bound into the form action, so a browser cannot turn the safe button into a
 * replace without submitting a different, visibly labelled form.
 */
export async function pullCourseTemplateUpdatesAction(
  shopSlug: string,
  slug: string,
  mode: "preserve-shop-edits" | "replace-template-copy",
  _formData: FormData,
) {
  const base = shopPath(shopSlug, "courses", slug, "edit");
  const staff = (await requireShopSurface(shopSlug)).session;
  const db = await getDb();
  const course = await getCourseBySlug(db, staff.user.shopId, slug);
  if (!course) redirect(noticeUrl(shopPath(shopSlug, "courses"), "invalid"));

  const parsedMode = z.enum(["preserve-shop-edits", "replace-template-copy"]).safeParse(mode);
  if (!parsedMode.success) redirect(noticeUrl(base, "template-update-unavailable"));
  const result = await pullCourseTemplateUpdates(db, staff.user.shopId, course.id, parsedMode.data);
  if (result.status !== "updated") redirect(noticeUrl(base, "template-update-unavailable"));

  revalidatePath(`/shop/${shopSlug}/courses/${slug}`);
  revalidatePath(publicCoursePath(shopSlug, course.slug));
  revalidateAndRedirect(
    base,
    noticeUrl(
      base,
      parsedMode.data === "preserve-shop-edits" ? "template-updated" : "template-replaced",
    ),
  );
}

/**
 * Take the course off the diver-facing catalog, or put it back.
 *
 * It lives on the editor rather than on the roster because it is rare and the
 * roster is not: a Hide button on every one of 55 rows was 55 standing controls
 * for an act a shop performs a handful of times a year, on a list whose job is
 * to be read. Here it is one control, on the page that already says whether
 * this course is live and where.
 *
 * No redirect and no notice: the header line and the button's own word both
 * flip on the render this revalidation causes, and a same-page redirect would
 * reset scroll to the top of a four-thousand-pixel form.
 *
 * **Both arguments are claims.** The page binds the slug and the course id it
 * rendered; bound arguments travel through the client unencrypted (a closure's
 * captures did not, which is what this was until the 2026-10-11 review moved it
 * here to be testable). So the tenant is the session's own `shopId`, the course
 * is re-read by slug inside that shop, and a slug that no longer names the
 * bound id is refused rather than toggled. `setCourseVisibility` matches on the
 * session's `shopId` as well, which is the layer that must never be the only one
 * (ADR-0006).
 *
 * **"Is this course for sale" is trip-definition work** (what the dive is and
 * who it admits; H-20260724-staff-role-reach, ADR 20260724-role-authorization), so the action re-checks
 * live roles rather than settling for "is staff". The page draws the control on
 * the same answer, but the gate is here: a form that is not rendered is not a
 * form that cannot be posted.
 *
 * **The live row decides the flip, not the render's snapshot.** Binding
 * `course.isActive` meant a tab left open while a colleague hid the course
 * posted "make it hidden" a second time and put it back on the catalog. Only the
 * id is bound; the standing is read here.
 */
export async function setCourseVisibilityAction(slug: string, courseId: string) {
  const staff = await requireStaffSession();
  const db = await getDb();
  const refusal = `${shopPath(staff.user.shopSlug, "courses", slug, "edit")}?error=not-authorized`;
  if (!(await canPersonConfigureTrips(db, staff.user.shopId, staff.user.personId))) {
    redirect(refusal);
  }
  const live = await getCourseBySlug(db, staff.user.shopId, slug);
  if (!live || live.id !== courseId) notFound();
  await setCourseVisibility(db, staff.user.shopId, courseId, !live.isActive);
  revalidatePath(`/shop/${staff.user.shopSlug}/courses/${slug}/edit`);
  revalidatePath(`/shop/${staff.user.shopSlug}/courses`);
}
