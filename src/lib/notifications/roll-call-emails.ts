import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { formatDateTimeTz, formatShortDate, formatTimeTz } from "@/lib/format";
import { escapeHtml } from "@/lib/html";
import { emailButton, type NotificationEmail } from "./email";
import { notificationGreeting } from "./greeting";

// i18n-exempt-file: the terminal renderer for the stale-roll-call alert, on the
// same footing as `./desk-emails.ts` — no React component picks words for a
// sent message, so this resolves its own text through `diverTranslator` in the
// recipient's locale. Every dynamic value is escaped for the html body.

export type RollCallStaleEmailInput = {
  locale: DiverLocale;
  recipientName: string;
  shopName: string;
  tripTitle: string;
  diveNumber: number;
  /** Recorded not back aboard, across the departure's diver and crew rows. */
  notBackAboard: number;
  /** No result yet: nobody has recorded them missing or back aboard. */
  awaiting: number;
  rollCallUrl: string;
  /** When the boat was due back: the departure's end, said in the shop's zone. */
  endsAt: Date;
  timezone: string;
  /** When the pass ran: the due-back time carries its date when that was another day. */
  alertedAt: Date;
};

type Translator = ReturnType<typeof diverTranslator>;

/**
 * "The roll call after dive 2 on Two-Tank Reef is still open after the boat
 * was due back at 4:00 PM EDT", then both counts in their own words: the ones
 * recorded not back aboard, and the ones nobody has recorded either way (EAP
 * review on H-20261014-stale-roll-call-recipients). Never one number that could mean either.
 */
function staleSentences(
  t: Translator,
  input: Pick<
    RollCallStaleEmailInput,
    | "locale"
    | "tripTitle"
    | "diveNumber"
    | "notBackAboard"
    | "awaiting"
    | "endsAt"
    | "timezone"
    | "alertedAt"
  >,
): string {
  const words = {
    dive: input.diveNumber,
    tripTitle: input.tripTitle,
    time: formatTimeTz(input.endsAt, input.locale, input.timezone),
  };
  // A pass after the shop's midnight says which day the boat was due back
  // (dive-domain re-review #4); the same day reads as a bare time.
  const sameDay =
    calendarDateInTimezone(input.endsAt, input.timezone) ===
    calendarDateInTimezone(input.alertedAt, input.timezone);
  const open = sameDay
    ? t("notifications.rollCallStale.body", words)
    : t("notifications.rollCallStale.bodyDated", {
        ...words,
        date: formatShortDate(input.endsAt, input.locale, input.timezone),
      });
  const counts =
    input.notBackAboard > 0 && input.awaiting > 0
      ? t("notifications.rollCallStale.countsBoth", {
          missing: input.notBackAboard,
          awaiting: input.awaiting,
        })
      : input.notBackAboard > 0
        ? t("notifications.rollCallStale.countsMissing", { missing: input.notBackAboard })
        : t("notifications.rollCallStale.countsAwaiting", { awaiting: input.awaiting });
  return `${open} ${counts}`;
}

/**
 * The owners' alert: the sentences above and the roll call. A count and a
 * link; who is unaccounted for stays behind the manifest's sign-in
 * (`src/lib/notifications/kinds.ts`).
 */
export function rollCallStaleEmail(input: RollCallStaleEmailInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const { text: greetingText, html: greetingHtml } = notificationGreeting(t, input.recipientName);
  const body = staleSentences(t, input);
  const open = t("notifications.rollCallStale.open");
  return {
    subject: t("notifications.rollCallStale.subject", {
      shopName: input.shopName,
      tripTitle: input.tripTitle,
    }),
    text: `${greetingText}\n\n${body}\n\n${open}:\n${input.rollCallUrl}\n`,
    html: `<p>${greetingHtml}</p><p>${escapeHtml(body)}</p>${emailButton(input.rollCallUrl, open)}`,
  };
}

export type RollCallStaleShoreEmailInput = Omit<
  RollCallStaleEmailInput,
  "recipientName" | "rollCallUrl"
> & {
  /** The shop's own phone, or null when it has none on file. */
  shopPhone: string | null;
  /** The link that takes this address off the shop. */
  stopUrl: string;
};

/**
 * The shore contact's copy (H-20261014-stale-roll-call-recipients): the same facts as the owners', in the
 * shop's language, with no greeting by name and nobody aboard named. Then what
 * to do (call the shop first, on its number when it has one), when this was
 * sent and that nothing follows it, why it came, and the one link: the one
 * that stops these alerts (EAP and security reviews on H-20261014-stale-roll-call-recipients).
 */
export function rollCallStaleShoreEmail(input: RollCallStaleShoreEmailInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const body = staleSentences(t, input);
  const action = input.shopPhone
    ? t("notifications.rollCallStale.shoreCallPhone", {
        shopName: input.shopName,
        phone: input.shopPhone,
      })
    : t("notifications.rollCallStale.shoreCall", { shopName: input.shopName });
  const sent = t("notifications.rollCallStale.shoreSent", {
    when: formatDateTimeTz(input.alertedAt, input.locale, input.timezone),
    shopName: input.shopName,
  });
  const why = t("notifications.rollCallStale.shoreWhy", { shopName: input.shopName });
  const stop = t("notifications.rollCallStale.shoreStop");
  const paragraphs = [body, action, sent, why];
  return {
    subject: t("notifications.rollCallStale.subject", {
      shopName: input.shopName,
      tripTitle: input.tripTitle,
    }),
    text: `${paragraphs.join("\n\n")}\n\n${stop}:\n${input.stopUrl}\n`,
    html: `${paragraphs.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}<p><a href="${escapeHtml(input.stopUrl)}">${escapeHtml(stop)}</a></p>`,
  };
}

export type ShoreAlertConfirmationEmailInput = {
  locale: DiverLocale;
  shopName: string;
  confirmUrl: string;
  expiresAt: Date;
  timezone: string;
};

/**
 * To the address a shop saved as its shore contact, before anything else
 * goes to it (H-20261014-stale-roll-call-recipients review): what agreeing means, one button, the expiry, and
 * that ignoring it sends nothing.
 */
export function shoreAlertConfirmationEmail(
  input: ShoreAlertConfirmationEmailInput,
): NotificationEmail {
  const t = diverTranslator(input.locale);
  const body = t("notifications.shoreAlertConfirmation.body", { shopName: input.shopName });
  const confirm = t("notifications.shoreAlertConfirmation.confirm");
  const expiry = t("notifications.shoreAlertConfirmation.expiry", {
    expiresAt: formatDateTimeTz(input.expiresAt, input.locale, input.timezone),
  });
  return {
    subject: t("notifications.shoreAlertConfirmation.subject", { shopName: input.shopName }),
    text: `${body}\n\n${confirm}:\n${input.confirmUrl}\n\n${expiry}\n`,
    html: `<p>${escapeHtml(body)}</p>${emailButton(input.confirmUrl, confirm)}<p>${escapeHtml(expiry)}</p>`,
  };
}

export type ShoreAlertStoppedEmailInput = {
  locale: DiverLocale;
  recipientName: string;
  shopName: string;
  settingsUrl: string;
};

/**
 * To each owner when the shore contact used the stop link in an alert (H-20261014-stale-roll-call-recipients
 * re-review): that it stopped, what brings it back, and where. The address is
 * not in it.
 */
export function shoreAlertStoppedEmail(input: ShoreAlertStoppedEmailInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const { text: greetingText, html: greetingHtml } = notificationGreeting(t, input.recipientName);
  const body = t("notifications.shoreAlertStopped.body");
  const open = t("notifications.shoreAlertStopped.open");
  return {
    subject: t("notifications.shoreAlertStopped.subject", { shopName: input.shopName }),
    text: `${greetingText}\n\n${body}\n\n${open}:\n${input.settingsUrl}\n`,
    html: `<p>${greetingHtml}</p><p>${escapeHtml(body)}</p>${emailButton(input.settingsUrl, open)}`,
  };
}
