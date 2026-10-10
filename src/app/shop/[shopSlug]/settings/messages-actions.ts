"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { setShopDeskHours } from "@/db/desk-pings";
import { setShopReviewUrl } from "@/db/shops";
import { parseDeskHours } from "@/lib/desk-hours";
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
  const parsed = reviewUrlSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(noticeUrl(settings, "review-url-invalid", { saved: "reviewLink" }));
  await setShopReviewUrl(await getDb(), session.user.shopId, parsed.data.reviewUrl);
  revalidateAndRedirect(settings, noticeUrl(settings, "review-url-saved", { saved: "reviewLink" }));
}

/**
 * When somebody is at the desk: one window every day, in the shop's own zone.
 * A diver message outside it pings the staff who asked (`src/lib/desk-hours.ts`).
 */
export async function saveDeskHoursAction(formData: FormData) {
  const session = await requireStaffSession();
  const settings = shopPath(session.user.shopSlug, "settings");
  await settingsBlock(session);
  const hours = parseDeskHours(formData.get("deskOpens"), formData.get("deskCloses"));
  if (!hours) redirect(noticeUrl(settings, "desk-hours-invalid", { saved: "deskHours" }));
  await setShopDeskHours(await getDb(), session.user.shopId, hours);
  revalidateAndRedirect(settings, noticeUrl(settings, "desk-hours-saved", { saved: "deskHours" }));
}
