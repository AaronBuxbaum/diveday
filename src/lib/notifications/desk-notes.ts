import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { formatDateTimeTz, formatShortDate } from "@/lib/format";
import { escapeHtml } from "@/lib/html";
import type { NotificationEmail } from "./email";
import { notificationGreeting } from "./greeting";

// i18n-exempt-file: the terminal renderer for two desk messages to a diver
// (batch 4: a note to a whole departure, J4; something found aboard, J2), on
// the same footing as `./email.ts` and `./work-order-emails.ts` — no React
// component picks words for a sent message, so this resolves its own text
// through `diverTranslator` in the recipient's locale. Every dynamic value is
// escaped for the html body, and the staffer's own words are only ever a
// value, never a message template.

export type DepartureNoteMessageInput = {
  locale: DiverLocale;
  diverName: string;
  shopName: string;
  tripTitle: string;
  startsAt: Date;
  timezone: string;
  /** The staffer's note, already checked (`departureNoteProblem`) and on one line. */
  body: string;
  /** The diver's own `/ready` link — the one link this message may carry. */
  readinessUrl?: string;
};

/** "A note about Saturday's reef trip", the note, and the diver's own booking link. */
export function departureNoteEmail(input: DepartureNoteMessageInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const greeting = notificationGreeting(t, input.diverName);
  const date = formatDateTimeTz(input.startsAt, input.locale, input.timezone);
  const intro = t("notifications.departureNote.intro", {
    shopName: input.shopName,
    tripTitle: input.tripTitle,
    date,
  });
  const introHtml = t("notifications.departureNote.intro", {
    shopName: escapeHtml(input.shopName),
    tripTitle: escapeHtml(input.tripTitle),
    date: escapeHtml(date),
  });
  const link = t("notifications.departureNote.readyLink");
  const linkText = input.readinessUrl ? `\n\n${link}:\n${input.readinessUrl}` : "";
  const linkHtml = input.readinessUrl
    ? `<p><a href="${escapeHtml(input.readinessUrl)}">${escapeHtml(link)}</a></p>`
    : "";
  return {
    subject: t("notifications.departureNote.subject", { tripTitle: input.tripTitle }),
    text: `${greeting.text}\n\n${intro}\n\n${input.body}${linkText}\n`,
    html: `<p>${greeting.html}</p><p>${introHtml}</p><blockquote><p>${escapeHtml(input.body)}</p></blockquote>${linkHtml}`,
  };
}

/** The same note as a text: one line, the booking link last. */
export function departureNoteText(
  input: Pick<
    DepartureNoteMessageInput,
    "locale" | "shopName" | "tripTitle" | "body" | "readinessUrl"
  >,
): string {
  const t = diverTranslator(input.locale);
  return input.readinessUrl
    ? t("notifications.smsDepartureNote.withLink", {
        shopName: input.shopName,
        tripTitle: input.tripTitle,
        note: input.body,
        url: input.readinessUrl,
      })
    : t("notifications.smsDepartureNote.body", {
        shopName: input.shopName,
        tripTitle: input.tripTitle,
        note: input.body,
      });
}

export type LostItemMessageInput = {
  locale: DiverLocale;
  diverName: string;
  shopName: string;
  tripTitle: string;
  startsAt: Date;
  timezone: string;
  /** What the crew wrote down ("blue mask, seat 4"). */
  description: string;
};

/** "The crew found this aboard after …", and that the shop is holding it. */
export function lostItemEmail(input: LostItemMessageInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const greeting = notificationGreeting(t, input.diverName);
  const date = formatShortDate(input.startsAt, input.locale, input.timezone);
  const body = t("notifications.lostItem.body", {
    tripTitle: input.tripTitle,
    date,
    item: input.description,
    shopName: input.shopName,
  });
  const bodyHtml = t("notifications.lostItem.body", {
    tripTitle: escapeHtml(input.tripTitle),
    date: escapeHtml(date),
    item: `<strong>${escapeHtml(input.description)}</strong>`,
    shopName: escapeHtml(input.shopName),
  });
  return {
    subject: t("notifications.lostItem.subject", { tripTitle: input.tripTitle }),
    text: `${greeting.text}\n\n${body}\n`,
    html: `<p>${greeting.html}</p><p>${bodyHtml}</p>`,
  };
}

/** The same news as a text. */
export function lostItemText(
  input: Pick<LostItemMessageInput, "locale" | "shopName" | "tripTitle" | "description">,
): string {
  const t = diverTranslator(input.locale);
  return t("notifications.smsLostItem.body", {
    shopName: input.shopName,
    tripTitle: input.tripTitle,
    item: input.description,
  });
}
