import { diverTranslator } from "@/i18n/messages";

// i18n-exempt-file: the terminal renderer for the waiver-link text, on the same
// footing as `./desk-notes.ts`: nothing downstream picks words for a sent text,
// so this resolves its own words in the recipient's locale
// (docs ADR 20260731-notification-locale). `src/db/waiver-issue.ts` decides who
// gets the link and hands over the facts.

export type WaiverLinkTextInput = {
  locale: string | null | undefined;
  shopName: string;
  tripTitle?: string;
  completionUrl: string;
  /** The course-forms text rather than the release's (ADR 20261008-course-forms). */
  courseForms?: boolean;
};

/** The text a diver reads on their phone: the shop, the departure, and the one link. */
export function waiverLinkText(input: WaiverLinkTextInput): string {
  const t = diverTranslator(input.locale);
  if (input.courseForms && input.tripTitle) {
    return t("notifications.sms.courseForms", {
      shopName: input.shopName,
      tripTitle: input.tripTitle,
      url: input.completionUrl,
    });
  }
  return input.tripTitle
    ? t("notifications.sms.waiverForTrip", {
        shopName: input.shopName,
        tripTitle: input.tripTitle,
        url: input.completionUrl,
      })
    : t("notifications.sms.waiver", { shopName: input.shopName, url: input.completionUrl });
}
