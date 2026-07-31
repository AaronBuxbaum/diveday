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
import { COURSE_INQUIRY_EXPERIENCE } from "@/lib/course-inquiry";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

const inquirySchema = z.object({
  name: z.string().trim().max(120).optional(),
  email: z.email().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
  timing: z.string().trim().max(200).optional(),
  divers: z.coerce.number().int().min(1).max(12).optional(),
  experience: z.enum(COURSE_INQUIRY_EXPERIENCE),
  message: z.string().trim().max(1500).optional(),
});

export type CourseInquiryFormState = { error?: string; success?: boolean };

/**
 * Records the public course page's "get in touch" composer server-side and
 * best-effort notifies the shop's own contact inbox — the diver's `mailto:`
 * composer (course-inquiry.ts) stays available beside this as a fallback that
 * needs no server round trip at all (docs/product/assessments/
 * ux-personas-20260730.md task 7).
 *
 * `shopSlug`/`courseSlug` are bound server-side from the page's own URL
 * params, never taken from the submitted form — the same discipline
 * `joinLastMinuteListAction` uses for `shopSlug`.
 */
export async function submitCourseInquiryAction(
  shopSlug: string,
  courseSlug: string,
  _prev: CourseInquiryFormState,
  formData: FormData,
): Promise<CourseInquiryFormState> {
  // Resolved here, not passed back as a code: this state reaches
  // CourseInquiry.tsx straight off `useActionState`, with no Server
  // Component render in between to translate it first.
  const t = diverTranslator(await requestLocale());
  const ip = await clientIp();
  if (!checkRateLimit(rateLimitKey("course-inquiry", ip), RATE_LIMITS.courseInquiry).allowed) {
    return { error: t("common.rateLimited") };
  }

  const parsed = inquirySchema.safeParse({
    name: formData.get("name") || undefined,
    email: formData.get("email") || undefined,
    phone: formData.get("phone") || undefined,
    timing: formData.get("timing") || undefined,
    divers: formData.get("divers") || undefined,
    experience: formData.get("experience") || undefined,
    message: formData.get("message") || undefined,
  });
  if (!parsed.success) return { error: t("inquiry.errors.invalid") };

  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) return { error: t("inquiry.errors.unavailable") };
  const course = await getCourseBySlug(db, shop.id, courseSlug);
  if (!course) return { error: t("inquiry.errors.unavailable") };

  const { name, email, phone, timing, divers, experience, message } = parsed.data;
  const record = await recordCourseInquiry(db, {
    shopId: shop.id,
    courseId: course.id,
    name,
    email,
    phone,
    experienceLevel: experience,
    timing,
    divers,
    message,
  });

  // Best-effort: a stalled or failed Resend call must never risk timing out
  // the response the diver is waiting on for their submitted-inquiry state
  // (same deferral onboardAction uses for its own founder/welcome sends).
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
        courseTitle: course.title,
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
