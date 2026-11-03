import { diverTranslator } from "@/i18n/messages";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";

// i18n-exempt-file: the terminal renderer for the answers to a reply keyword
// (`C`, `M`, `LATE` and a confirmation code), on the same footing as
// `./desk-notes.ts`: nothing downstream picks words for a sent answer, so this
// resolves its own words in the diver's locale (ADR 20260731-notification-locale).
// `src/db/reply-keywords.ts` decides what happened and hands over a code.

/** The departure an answer names. */
export type ReplyKeywordDeparture = { tripTitle: string; startsAt: Date; endsAt: Date };

/** What a keyword's answer says, as a code with its facts. */
export type ReplyKeywordAnswer =
  | { code: "codeMismatch" }
  | { code: "cancelRefused" }
  | { code: "cancelled"; departure: ReplyKeywordDeparture; refunded: boolean }
  | { code: "moveHandoff" }
  | { code: "lateNothing" }
  | { code: "lateNoted" }
  | { code: "nothingToCancel" }
  | { code: "ambiguous" }
  | {
      code: "confirmCancel";
      departure: ReplyKeywordDeparture;
      confirmationCode: string;
      /** Unclaimed party seats that go with the lead's; 0 for none. */
      partySeats: number;
    };

/** The answer in the diver's own language. */
export function replyKeywordText(
  shop: { name: string; timezone: string; locale: string },
  answer: ReplyKeywordAnswer,
): string {
  const t = diverTranslator(shop.locale);
  const shopName = shop.name;
  const departure = (booking: ReplyKeywordDeparture) => ({
    tripTitle: booking.tripTitle,
    date: formatShortDate(booking.startsAt, shop.locale, shop.timezone),
    time: formatTimeRangeTz(booking.startsAt, booking.endsAt, shop.locale, shop.timezone),
  });
  switch (answer.code) {
    case "codeMismatch":
      return t("notifications.replyKeyword.codeMismatch", { shopName });
    case "cancelRefused":
      return t("notifications.replyKeyword.cancelRefused", { shopName });
    case "cancelled": {
      const cancelled = t("notifications.replyKeyword.cancelled", departure(answer.departure));
      return answer.refunded
        ? `${cancelled} ${t("notifications.replyKeyword.refundOnItsWay")}`
        : cancelled;
    }
    case "moveHandoff":
      return t("notifications.replyKeyword.moveHandoff", { shopName });
    case "lateNothing":
      return t("notifications.replyKeyword.lateNothing", { shopName });
    case "lateNoted":
      return t("notifications.replyKeyword.lateNoted", { shopName });
    case "nothingToCancel":
      return t("notifications.replyKeyword.nothingToCancel", { shopName });
    case "ambiguous":
      return t("notifications.replyKeyword.ambiguous", { shopName });
    case "confirmCancel":
      return answer.partySeats > 0
        ? t("notifications.replyKeyword.confirmCancelParty", {
            ...departure(answer.departure),
            code: answer.confirmationCode,
            count: answer.partySeats,
          })
        : t("notifications.replyKeyword.confirmCancel", {
            ...departure(answer.departure),
            code: answer.confirmationCode,
          });
  }
}
