"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { setShopDeskHours } from "@/db/desk-pings";
import { setShopReviewUrl } from "@/db/shops";
import { parseDeskHours } from "@/lib/desk-hours";
import { formValue, readForm } from "@/lib/form-parse";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { settingsBlock } from "./action-helpers";

const reviewUrlSchema = z.object({
  // Empty clears it — the recap flow simply skips the review ask when unset,
  // rather than guessing a platform. z.url() alone accepts any scheme
  // (data:, mailto:, ftp:, even plain http:); this renders directly as a
  // public `target="_blank"` link on the recap page, so only https is safe.
  reviewUrl: z.union([
    z.literal(""),
    z
      .url()
      .max(500)
      .refine((value) => value.startsWith("https://"), {
        error: "Review link must start with https://",
      }),
  ]),
});

/** Where the post-trip recap's "leave us a review" link sends a diver. */
export async function saveReviewUrlAction(formData: FormData) {
  const session = await requireStaffSession();
  const settings = shopPath(session.user.shopSlug, "settings");
  await settingsBlock(session);
  // The Reviews page's empty state offers the same box in place (fifth-loop
  // ideas, item 59), and its save lands back there.
  const fromReviews = formData.get("from") === "reviews";
  const back = fromReviews ? shopPath(session.user.shopSlug, "reviews") : settings;
  const saved = fromReviews ? {} : { saved: "reviewLink" };
  const parsed = reviewUrlSchema.safeParse({ reviewUrl: formData.get("reviewUrl") });
  if (!parsed.success) redirect(noticeUrl(back, "review-url-invalid", saved));
  await setShopReviewUrl(await getDb(), session.user.shopId, parsed.data.reviewUrl);
  revalidateAndRedirect(back, noticeUrl(back, "review-url-saved", saved));
}

const deskHoursForm = z.object({ deskOpens: formValue(), deskCloses: formValue() });

/**
 * When somebody is at the desk: one window every day, in the shop's own zone.
 * A diver message outside it pings the staff who asked (`src/lib/desk-hours.ts`).
 */
export async function saveDeskHoursAction(formData: FormData) {
  const session = await requireStaffSession();
  const settings = shopPath(session.user.shopSlug, "settings");
  await settingsBlock(session);
  const { deskOpens, deskCloses } = readForm(deskHoursForm, formData);
  const hours = parseDeskHours(deskOpens, deskCloses);
  if (!hours) redirect(noticeUrl(settings, "desk-hours-invalid", { saved: "deskHours" }));
  await setShopDeskHours(await getDb(), session.user.shopId, hours);
  revalidateAndRedirect(settings, noticeUrl(settings, "desk-hours-saved", { saved: "deskHours" }));
}
