import { diverTranslator } from "@/i18n/messages";
import { toDiverLocale } from "@/i18n/settings";
import { formatShortDate } from "@/lib/format";

// i18n-exempt-file: the terminal renderer for the seat-confirmation text, on
// the same footing as `./waiver-text.ts`: nothing downstream picks words for a
// sent text, so this resolves its own words in the recipient's locale (docs ADR
// 20260731-notification-locale). `src/features/bookings/seat-confirmation-text.ts` decides who
// is texted and hands over the facts.

export type SeatConfirmationTextInput = {
  locale: string | null | undefined;
  shopName: string;
  startsAt: Date;
  timezone: string;
  /** The seat's own readiness link: the waiver, cert card and sizes are all on it. */
  readinessUrl: string;
};

/**
 * **The text a staff-seated diver gets** ("Try it Saturday", item 3): the
 * shop, the day and the one link. The email carries everything else.
 *
 * **Two SMS segments, not one** (measured 2026-11-24): the ready link is
 * ~100 characters and the STOP line `sendCourtesyMessage` adds is 24, which
 * leaves ~35 of a single segment's 160 for the shop's name and the day. So the
 * text stays GSM-7 and inside two concatenated segments (306 characters): it
 * names no trip title, which may carry a dash outside GSM-7, and the English
 * has no curly apostrophe. Either would send it as UCS-2, 67 characters a
 * segment, four segments.
 *
 * The date's units are joined by a plain space here, not the no-break space
 * `keepUnitsWhole` puts in for a screen: a text does not wrap the way a page
 * does, and one U+00A0 is UCS-2 too.
 */
export function seatConfirmationText(input: SeatConfirmationTextInput): string {
  const locale = toDiverLocale(input.locale);
  const t = diverTranslator(locale);
  const date = formatShortDate(input.startsAt, locale, input.timezone).replace(/\u00a0/g, " ");
  return t("notifications.sms.seated", {
    shopName: input.shopName,
    date,
    url: input.readinessUrl,
  });
}
