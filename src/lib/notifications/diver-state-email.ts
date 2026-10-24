// i18n-exempt-file: a terminal renderer for outbound email, like ./email.ts: it
// resolves its words through diverTranslator against the recipient's locale.
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { nowDate } from "@/lib/clock";
import { type FlySafeResult, flySafeMessageKey } from "@/lib/fly-safe";
import {
  formatDateTimeTz,
  formatShortDate,
  formatTimeTz,
  formatWeekdayTime,
  isSameCalendarDay,
} from "@/lib/format";
import { escapeHtml } from "@/lib/html";
import { emailButton, type NotificationEmail } from "./email";

/**
 * **The shape every reminder takes: the state in the subject, one sentence,
 * the one link, and the shop's line** (issue #2660, decided by Aaron
 * 2026-10-17). The diver's thread page holds the content (the forecast, what
 * to bring, who to text, the first-timer note, the fly-safe reasoning), so the
 * email is the doorbell rather than a second copy that can drift from it.
 *
 * - `week_out`: the 7-day nudge, `trip_reminder_7d`.
 * - `tonight`: the night-before message, `trip_reminder_24h`.
 * - `home`: the after-dive recap, `trip_recap`.
 * - `fly_safe_correction`: the one line correcting a fly-safe wait the
 *   night-before email told a diver, once the departure is marked as
 *   decompression diving (issue #2927), `fly_safe_correction`.
 *
 * One `notification_kind` value per state is what keeps the once-per-booking
 * dedup rows (`src/lib/reminders.ts`, `src/db/recap.ts`) exact, so a state is
 * a kind, not a field.
 *
 * There is no greeting: a greeting is a second sentence, and the sender is
 * already the shop. The shop's line is the shop's name, alone, last.
 */
export type DiverStateEmailInput = {
  locale: DiverLocale;
  shopName: string;
  tripTitle: string;
  startsAt: Date;
  timezone: string;
} & (
  | {
      state: "week_out" | "tonight";
      /** The diver's thread (`/ready`), the one link. */
      readinessUrl?: string;
      /** How many things the diver still has to finish; the sentence says so when above zero. */
      open: number;
      /** The shop's dock call; the night-before sentence names the dock time (departure minus this). */
      dockCallMinutes?: number;
      /** A medical answer waits on a doctor; the sentence says so instead of counting it. */
      medicalReview?: boolean;
      /** The instant the message is read as sent, for "today" or "tomorrow"; the clock when omitted. */
      now?: Date;
      /** A course session says it starts, where a fun dive sails. */
      courseSession?: boolean;
      /** Whether the reply line is offered (ADR 20260909-reply-keywords): a fact about the channel. */
      replyKeywords?: boolean;
      /** The fly-safe wait in hours, on the night before a diver's last boat (H-150); the line is absent without it. */
      flySafeHours?: number;
    }
  | {
      state: "fly_safe_correction";
    }
  | {
      state: "home";
      /** The diver's recap page (the thread's after-state), the one link. */
      recapUrl: string;
      /** When the diver may fly; the sentence is this fact when it is known. */
      flySafe?: Pick<FlySafeResult, "from" | "hours" | "anchor" | "reason">;
      /** Self-serve opt-out of courtesy email, required on this one. */
      unsubscribeUrl: string;
    }
);

export function diverStateEmail(input: DiverStateEmailInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const shop = escapeHtml(input.shopName);

  if (input.state === "fly_safe_correction") {
    // One sentence, no link: the figure in the diver's inbox no longer
    // applies, and only the crew can give the right one (DAN gives no
    // preflight figure for a dive that took stops, H-84).
    const sentence = t("notifications.flySafeCorrection.body", { tripTitle: input.tripTitle });
    return {
      subject: t("notifications.flySafeCorrection.subject", { tripTitle: input.tripTitle }),
      text: `${sentence}\n\n${input.shopName}\n`,
      html: `<p>${escapeHtml(sentence)}</p><p>${shop}</p>`,
    };
  }

  if (input.state === "home") {
    const date = formatShortDate(input.startsAt, input.locale, input.timezone);
    // The fly-safe sentence is the same words the after-state page carries
    // (`flySafeMessageKey`): one fact, read the same way on the page and in
    // the inbox. Without one the sentence is the thanks.
    const sentence = input.flySafe
      ? t(`notifications.tripRecap.${flySafeMessageKey(input.flySafe)}`, {
          when: formatWeekdayTime(input.flySafe.from, input.locale, input.timezone),
          count: input.flySafe.hours,
          shopName: input.shopName,
        })
      : t("notifications.tripRecap.thanks", {
          tripTitle: input.tripTitle,
          shopName: input.shopName,
          date,
        });
    const label = t("notifications.tripRecap.seeRecap");
    const unsubscribe = t("notifications.common.courtesyUnsubscribe", {
      shopName: input.shopName,
    });
    return {
      subject: t("notifications.tripRecap.subject", {
        shopName: input.shopName,
        tripTitle: input.tripTitle,
      }),
      text: `${sentence}\n\n${label}:\n${input.recapUrl}\n\n${input.shopName}\n\n${unsubscribe}:\n${input.unsubscribeUrl}\n`,
      html: `<p>${escapeHtml(sentence)}</p>${emailButton(input.recapUrl, label)}<p>${shop}</p><p><a href="${escapeHtml(input.unsubscribeUrl)}">${escapeHtml(unsubscribe)}</a></p>`,
    };
  }

  const tonight = input.state === "tonight";
  const course = input.courseSession === true;
  const key = tonight ? "day" : "week";
  const suffix = course ? "Course" : "";
  // A message held until the morning of the trip says "today": the day word
  // is the calendar day in the shop's zone, never a fixed "tomorrow".
  const day = isSameCalendarDay(input.startsAt, input.now ?? nowDate(), input.timezone)
    ? "today"
    : "tomorrow";
  // A fun dive names the dock time (the shop's dock call before departure,
  // the glossary's "dock call time"); a course session names no dock and
  // keeps its start.
  const dockAt =
    !course && input.dockCallMinutes !== undefined
      ? new Date(input.startsAt.getTime() - input.dockCallMinutes * 60_000)
      : input.startsAt;
  const values = {
    tripTitle: input.tripTitle,
    when: tonight
      ? formatTimeTz(dockAt, input.locale, input.timezone)
      : formatDateTimeTz(input.startsAt, input.locale, input.timezone),
    open: input.open,
    medical: input.medicalReview ? "yes" : "no",
    day,
  };
  const sentence = t(`notifications.tripReminder.${key}Body${suffix}`, values);
  // Under the dock time, the night before the diver's last boat: the rule in
  // hours, never a clock time, because a late boat would make a time wrong
  // (H-150). The exact time stays on the thread and the recap.
  const flySafe =
    tonight && input.flySafeHours !== undefined
      ? t("notifications.tripReminder.flySafe", { count: input.flySafeHours })
      : null;
  const label = t("notifications.common.seeWhatsLeft");
  // The reply line is a fact about the channel, not about the state, so it
  // stays under the link on both reminders and nowhere else.
  const keywordOffer = input.replyKeywords ? t("notifications.replyKeyword.offer") : null;
  const link = input.readinessUrl;

  return {
    subject: t(`notifications.tripReminder.${key}Subject${suffix}`, {
      tripTitle: input.tripTitle,
      day,
    }),
    text: `${sentence}${flySafe ? `\n\n${flySafe}` : ""}${link ? `\n\n${label}:\n${link}` : ""}\n\n${input.shopName}\n${keywordOffer ? `\n${keywordOffer}\n` : ""}`,
    html: `<p>${escapeHtml(sentence)}</p>${flySafe ? `<p>${escapeHtml(flySafe)}</p>` : ""}${link ? emailButton(link, label) : ""}<p>${shop}</p>${keywordOffer ? `<p style="font-size: 13px; opacity: 0.8;">${escapeHtml(keywordOffer)}</p>` : ""}`,
  };
}
