"use server";

import { after } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { recordCourseInquiry } from "@/db/course-inquiries";
import { getCourseBySlug } from "@/db/courses";
import { sendNotification } from "@/db/notifications";
import { getShopBySlug } from "@/db/shops";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { toDiverLocale } from "@/i18n/settings";
import { isValidCalendarDate } from "@/lib/calendar-date";
import { COURSE_INQUIRY_EXPERIENCE, type InquiryFormState } from "@/lib/course-inquiry";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

/** A `<input type="date">` value, refused unless it is a date that exists. */
const calendarDate = z.string().refine(isValidCalendarDate);

const inquirySchema = z.object({
  interest: z.string().trim().max(200).optional(),
  name: z.string().trim().max(120).optional(),
  email: z.email().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
  preferredDate: calendarDate.optional(),
  alternateDate: calendarDate.optional(),
  dateFlexible: z.boolean(),
  timing: z.string().trim().max(200).optional(),
  divers: z.coerce.number().int().min(1).max(12).optional(),
  experience: z.enum(COURSE_INQUIRY_EXPERIENCE),
  message: z.string().trim().max(1500).optional(),
});

/**
 * A lead the shop cannot answer is not a lead. The composer asks for both an
 * email and a phone and requires neither on its own, because a diver on a dock
 * may have only one of the two — but one of them has to be there, or the row
 * records a question with no way back to whoever asked it. Enforced here as
 * well as in the composer: the client guard is the courtesy, this is the rule.
 */
function hasReplyPath(input: { email?: string; phone?: string }): boolean {
  return Boolean(input.email?.trim() || input.phone?.trim());
}

export type { InquiryFormState };

/**
 * Records a diver's request for a date, from either surface that asks for one:
 * a course page (`courseSlug` bound from its URL) or the shop's schedule page
 * (`courseSlug` null, and the request says what it is about in `interest`).
 *
 * Shared rather than duplicated because the two differ in exactly one field,
 * and because the either-or below — a request names a course *or* an interest
 * — has to hold identically on both, or the check constraint on
 * `course_inquiries` becomes the thing a diver meets instead of a sentence.
 *
 * `shopSlug`/`courseSlug` are bound server-side from the calling page's own URL
 * params, never taken from the submitted form — the same discipline
 * `joinLastMinuteListAction` uses for `shopSlug`.
 */
export async function submitInquiryAction(
  shopSlug: string,
  courseSlug: string | null,
  _prev: InquiryFormState,
  formData: FormData,
): Promise<InquiryFormState> {
  // Resolved here, not passed back as a code: this state reaches
  // DateRequestForm.tsx straight off the transition, with no Server Component
  // render in between to translate it first.
  const t = diverTranslator(await requestLocale());
  const ip = await clientIp();
  if (
    !(await checkRateLimit(rateLimitKey("course-inquiry", ip), RATE_LIMITS.courseInquiry)).allowed
  ) {
    return { error: t("common.rateLimited") };
  }

  const parsed = inquirySchema.safeParse({
    interest: formData.get("interest") || undefined,
    name: formData.get("name") || undefined,
    email: formData.get("email") || undefined,
    phone: formData.get("phone") || undefined,
    preferredDate: formData.get("preferredDate") || undefined,
    alternateDate: formData.get("alternateDate") || undefined,
    dateFlexible: Boolean(formData.get("dateFlexible")),
    timing: formData.get("timing") || undefined,
    divers: formData.get("divers") || undefined,
    experience: formData.get("experience") || undefined,
    message: formData.get("message") || undefined,
  });
  if (!parsed.success) return { error: t("inquiry.errors.invalid") };
  if (!hasReplyPath(parsed.data)) return { error: t("inquiry.errors.contactRequired") };

  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) return { error: t("inquiry.errors.unavailable") };

  const course = courseSlug ? await getCourseBySlug(db, shop.id, courseSlug) : null;
  // A hidden course isn't offered anymore, from a diver's point of view —
  // the form itself only renders on the visible page, so reaching here for one
  // means the slug was guessed or the shop hid it mid-submit.
  if (courseSlug && !course?.isActive) return { error: t("inquiry.errors.unavailable") };

  const {
    interest,
    name,
    email,
    phone,
    preferredDate,
    alternateDate,
    dateFlexible,
    timing,
    divers,
    experience,
    message,
  } = parsed.data;
  // The either-or, in the diver's own words rather than as a constraint
  // violation: a request with no course in the URL and nothing typed into
  // "what would you like to dive?" is about nothing.
  if (!course && !interest) return { error: t("inquiry.errors.interestRequired") };

  const record = await recordCourseInquiry(db, {
    shopId: shop.id,
    courseId: course?.id ?? null,
    interest: course ? null : interest,
    name,
    email,
    phone,
    experienceLevel: experience,
    timing,
    preferredDate,
    alternateDate,
    dateFlexible,
    divers,
    message,
  });

  // Best-effort: a stalled or failed send must never risk timing out the
  // response the diver is waiting on for their submitted state (the same
  // deferral onboardAction uses for its own founder/welcome sends).
  const contactEmail = shop.contactEmail;
  if (contactEmail) {
    after(async () => {
      await sendNotification(await getDb(), {
        kind: "course_inquiry",
        courseInquiryId: record.id,
        shopId: shop.id,
        to: contactEmail,
        locale: toDiverLocale(shop.defaultLocale),
        shopName: shop.name,
        // With no course, what the diver typed is what the mail is about.
        courseTitle: course?.title ?? (interest as string),
        inquirerName: name,
        inquirerEmail: email,
        inquirerPhone: phone,
        experience,
        timing,
        divers,
        message,
      }).catch(() => ({ status: "failed" as const }));
    });
  }

  return { success: true };
}
