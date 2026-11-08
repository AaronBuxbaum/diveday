"use server";

import { z } from "zod";
import { setShopReviewUrl } from "@/db/shops";
import { setShopDeskHours } from "@/features/desk-pings";
import { formValue, text } from "@/features/form-parse";
import { defineAction, land } from "@/features/server-action";
import { parseDeskHours } from "@/lib/desk-hours";
import { SETTINGS_GATE } from "./action-gates";

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

/** The review form as posted; `reviewUrlSchema` holds the link to its shape. */
const reviewUrlForm = z.object({ reviewUrl: formValue(), from: text() });

/** Where the post-trip recap's "leave us a review" link sends a diver. */
export const saveReviewUrlAction = defineAction({
  gate: [SETTINGS_GATE],
  input: reviewUrlForm,
  async run({ db, shopId, path }, form) {
    // The Reviews page's empty state offers the same box in place (fifth-loop
    // ideas, item 59), and its save lands back there.
    const fromReviews = form.from === "reviews";
    const back = fromReviews ? path("reviews") : path("settings");
    const extra = fromReviews ? {} : { saved: "reviewLink" };
    const parsed = reviewUrlSchema.safeParse({ reviewUrl: form.reviewUrl });
    if (!parsed.success) return land(back, "review-url-invalid", { extra });
    await setShopReviewUrl(db, shopId, parsed.data.reviewUrl);
    return land(back, "review-url-saved", { extra });
  },
});

const deskHoursForm = z.object({ deskOpens: formValue(), deskCloses: formValue() });

/**
 * When somebody is at the desk: one window every day, in the shop's own zone.
 * A diver message outside it pings the staff who asked (`src/lib/desk-hours.ts`).
 */
export const saveDeskHoursAction = defineAction({
  gate: [SETTINGS_GATE],
  input: deskHoursForm,
  async run({ db, shopId, path }, { deskOpens, deskCloses }) {
    const settings = path("settings");
    const hours = parseDeskHours(deskOpens, deskCloses);
    if (!hours) return land(settings, "desk-hours-invalid", { extra: { saved: "deskHours" } });
    await setShopDeskHours(db, shopId, hours);
    return land(settings, "desk-hours-saved", { extra: { saved: "deskHours" } });
  },
});
