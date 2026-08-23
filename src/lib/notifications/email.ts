import type { DiverTranslator } from "@/i18n/messages";
import { diverTranslator } from "@/i18n/messages";
import { reminderActionText } from "@/i18n/reminder-labels";
import type { DiverLocale } from "@/i18n/settings";
import { type CalendarDate, formatCalendarDate } from "@/lib/calendar-date";
import { COURSE_INQUIRY_EXPERIENCE_KEYS, type CourseInquiryExperience } from "@/lib/course-inquiry";
import type { DemoRoleId } from "@/lib/demo-roles";
import { formatDateTimeTz, formatShortDate, formatTime, formatTimeRangeTz } from "@/lib/format";
import { escapeHtml } from "@/lib/html";
import { firstNameOf } from "@/lib/person-name";
import type { ReminderActionCode } from "@/lib/readiness-summary";
import { cachedListFormat } from "../intl-cache";

// i18n-exempt-file: the terminal renderer for outbound email — no downstream
// React component picks words for a sent message, so this file resolves its
// own text via diverTranslator against the recipient shop's locale rather
// than returning a code (docs ADR 20260731-notification-locale). Every
// dynamic value (names, titles, free text) is still escaped for the html
// body exactly as before; only the surrounding words are now translated.

type BookingConfirmationEmailInput = {
  locale: DiverLocale;
  diverName: string;
  shopName: string;
  tripTitle: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  /** Minutes before departure to be at the dock; the shop's call, default 30. */
  dockCallMinutes?: number;
  /** The diver's readiness page, so a closed tab never loses it. */
  readinessUrl?: string;
  /** The shop's configured packing suggestions (`shops.packingList`). */
  packingList?: string[];
};

type WaiverRequestEmailInput = {
  locale: DiverLocale;
  diverName: string;
  shopName: string;
  tripTitle?: string;
  completionUrl: string;
  expiresAt: Date;
  timezone: string;
};

type ReadinessLinkEmailInput = {
  locale: DiverLocale;
  diverName: string;
  shopName: string;
  tripTitle: string;
  readinessUrl: string;
  expiresAt: Date;
  timezone: string;
};

type WaitlistInviteEmailInput = {
  locale: DiverLocale;
  diverName: string;
  shopName: string;
  tripTitle: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  /** The public trip page where the freed seat can be claimed. */
  bookingUrl: string;
  /** Self-serve opt-out of `waitlist_invite`/`trip_recap` courtesy email. */
  unsubscribeUrl: string;
};

type TripInvitationEmailInput = {
  locale: DiverLocale;
  diverName: string;
  shopName: string;
  tripTitle: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  bookingUrl: string;
};

type LastMinuteDealEmailInput = {
  locale: DiverLocale;
  diverName: string;
  shopName: string;
  tripTitle: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  discountPercent: number;
  /** The code the diver types on the booking form. */
  code: string;
  bookingUrl: string;
  /** When the code stops working — pinned to the trip's own departure. */
  expiresAt: Date;
  /** This recipient's own self-serve unsubscribe link (Leo — self-serve email unsubscribe). */
  unsubscribeUrl: string;
};

type CheckoutRecoveryEmailInput = {
  locale: DiverLocale;
  shopName: string;
  tripTitle: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  /** Stripe's hosted checkout page for this exact session — resumes, doesn't restart. */
  checkoutUrl: string;
  /**
   * This recipient's own self-serve opt-out. Required, not optional: nobody
   * receiving this has a confirmed booking behind them, which is what makes it
   * a commercial send rather than service messaging
   * (ADR 20260814-checkout-recovery-is-commercial).
   */
  unsubscribeUrl: string;
};

/**
 * The night-before brief's extra sections. Carried only on the day-lead
 * reminder — the single cheapest cancellation-prevention tool a shop has, since
 * most day-of no-shows are anxiety plus logistics confusion, not lost interest
 * (docs first-principles brainstorm C). The 7-day reminder stays light.
 */
type NightBeforeBriefInput = {
  /** Plain-language conditions from the crew, or null when none published. */
  forecast?: string | null;
  /** What to bring — the shop's packing list. */
  bring?: string[];
  /** The shop's number for day-of questions, already E.164-validated. */
  whoToText?: string | null;
  /** Extra "what happens on the boat" reassurance for a first-timer, pre-resolved by the caller. */
  firstTimerNote?: string | null;
};

type TripReminderEmailInput = {
  locale: DiverLocale;
  diverName: string;
  shopName: string;
  tripTitle: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  /** How the reminder reads: "in a week" vs "tomorrow". */
  lead: "week" | "day";
  /** Minutes before departure to be at the dock; the shop's call, default 30. */
  dockCallMinutes?: number;
  /** The diver's own outstanding items, as codes — resolved via `reminderActionText`. */
  outstanding?: ReminderActionCode[];
  /** True when a medical answer may need a doctor's sign-off before boarding. */
  medicalReview?: boolean;
  /** The diver's readiness page, so they can finish what's outstanding. */
  readinessUrl?: string;
  /** Present on the night-before (day) lead only; enriches it into a full brief. */
  brief?: NightBeforeBriefInput;
};

export type TripConditionsHoldEmailInput = {
  locale: DiverLocale;
  diverName: string;
  shopName: string;
  tripTitle: string;
  startsAt: Date;
  timezone: string;
  conditionsSummary?: string | null;
  tripUrl: string;
};

/**
 * The light-mode `--primary` token, duplicated intentionally: an email
 * document can't reference globals.css custom properties any more than
 * `icon.tsx`'s `ImageResponse` can (see that file's own comment).
 */
const BRAND_PRIMARY_COLOR = "#0e7490";

/**
 * Wraps a template's inner body fragment in a real HTML document — doctype,
 * `<html lang>`, a viewport meta tag, and a max-width container, none of
 * which any individual template had before (they returned bare `<p>` soup
 * delivered as-is). Kept deliberately plain: inline styles only,
 * no external stylesheet or font, so it stays deliverability-safe. The shop
 * name renders as a small text header — never a logo image, matching the
 * "no image-heavy layouts" rule for transactional mail.
 */
export function wrapEmailHtml(
  bodyHtml: string,
  options: { shopName: string; locale: string },
): string {
  return `<!doctype html><html lang="${escapeHtml(options.locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"></head><body style="margin: 0; padding: 0; background-color: #f3f4f6; color: #111827; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;"><div style="max-width: 560px; margin: 0 auto; padding: 32px 20px;"><p style="margin: 0 0 20px; font-size: 13px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: ${BRAND_PRIMARY_COLOR};">${escapeHtml(options.shopName)}</p><div style="font-size: 15px; line-height: 1.6;">${bodyHtml}</div></div></body></html>`;
}

export function tripConditionsHoldEmail(input: TripConditionsHoldEmailInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const firstName = firstNameOf(input.diverName, t("notifications.common.genericName"));
  const date = formatShortDate(input.startsAt, input.locale, input.timezone);
  const detail = input.conditionsSummary?.trim();
  const body = t("notifications.tripConditionsHold.body", {
    shopName: input.shopName,
    tripTitle: input.tripTitle,
    date,
  });
  const bodyHtml = t("notifications.tripConditionsHold.body", {
    shopName: escapeHtml(input.shopName),
    tripTitle: `<strong>${escapeHtml(input.tripTitle)}</strong>`,
    date: escapeHtml(date),
  });
  const crewNoteLabel = t("notifications.tripConditionsHold.crewNoteLabel");
  const detailText = detail ? `\n\n${crewNoteLabel} ${detail}` : "";
  const detailHtml = detail ? `<p><strong>${crewNoteLabel}</strong> ${escapeHtml(detail)}</p>` : "";
  const seeUpdate = t("notifications.tripConditionsHold.seeUpdate");

  return {
    subject: t("notifications.tripConditionsHold.subject", { tripTitle: input.tripTitle }),
    text: `${t("notifications.common.greeting", { firstName })}\n\n${body}${detailText}\n\n${seeUpdate}:\n${input.tripUrl}\n`,
    html: `<p>${t("notifications.common.greeting", { firstName: escapeHtml(firstName) })}</p><p>${bodyHtml}</p>${detailHtml}<p><a href="${escapeHtml(input.tripUrl)}">${seeUpdate}</a></p>`,
  };
}

export type TripMinimumNotMetEmailInput = {
  locale: DiverLocale;
  diverName: string;
  shopName: string;
  tripTitle: string;
  startsAt: Date;
  timezone: string;
  minimumBookings: number;
  bookedCount: number;
  /** What happened to this seat's money; absent only on a pre-refund retry. */
  paymentStory?: "none" | "refunded" | "refund_owed";
  scheduleUrl: string;
};

/**
 * "This one did not fill." The message a diver gets when a departure they
 * booked is cancelled by the minimum-head-count sweep.
 *
 * It says the numbers. A cancellation with no reason reads as a shop that
 * changed its mind; "we run this one with at least 4 divers and had 2 by the
 * moment we said we'd decide" reads as the promise the booking page made,
 * kept — and it is the difference between a diver who books the next one and a
 * diver who books somewhere else.
 *
 * It also says what happened to the money, because now something has: a machine
 * cancelling a paid seat at 4 AM refunds it in the same pass
 * (ADR 20260813-shop-cancellation-refunds-itself). A diver holding a captured
 * charge for a departure the shop called off must not have to ask.
 */
export function tripMinimumNotMetEmail(input: TripMinimumNotMetEmailInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const firstName = firstNameOf(input.diverName, t("notifications.common.genericName"));
  const date = formatShortDate(input.startsAt, input.locale, input.timezone);
  const params = {
    shopName: input.shopName,
    tripTitle: input.tripTitle,
    date,
    minimum: input.minimumBookings,
    booked: input.bookedCount,
  };
  const body = t("notifications.tripMinimumNotMet.body", params);
  const bodyHtml = t("notifications.tripMinimumNotMet.body", {
    ...params,
    shopName: escapeHtml(input.shopName),
    tripTitle: `<strong>${escapeHtml(input.tripTitle)}</strong>`,
    date: escapeHtml(date),
  });
  const findAnother = t("notifications.tripMinimumNotMet.findAnother");
  // Nothing captured means nothing to say: a diver who never paid does not need
  // a paragraph about money (design/principles.md #9 — never render "None" as a
  // status). A pre-refund retry carries no code and reads the same way.
  const money =
    input.paymentStory === "refunded"
      ? t("notifications.tripMinimumNotMet.moneyRefunded")
      : input.paymentStory === "refund_owed"
        ? t("notifications.tripMinimumNotMet.moneyRefundOwed", { shopName: input.shopName })
        : null;
  return {
    subject: t("notifications.tripMinimumNotMet.subject", { tripTitle: input.tripTitle }),
    text: `${t("notifications.common.greeting", { firstName })}\n\n${body}\n${money ? `\n${money}\n` : ""}\n${findAnother}:\n${input.scheduleUrl}\n`,
    html: `<p>${t("notifications.common.greeting", { firstName: escapeHtml(firstName) })}</p><p>${bodyHtml}</p>${money ? `<p>${escapeHtml(money)}</p>` : ""}<p><a href="${escapeHtml(input.scheduleUrl)}">${findAnother}</a></p>`,
  };
}

export type TripBlowoutEmailInput = {
  locale: DiverLocale;
  diverName: string;
  shopName: string;
  tripTitle: string;
  startsAt: Date;
  timezone: string;
  /** Codes, not amounts — see the kind's schema (docs ADR 20260804-blowout-cascade). */
  paymentStory: "none" | "deposit" | "paid" | "refunded" | "refund_owed";
  /** Soonest-first, admission-filtered for this diver; empty is a real answer. */
  alternatives: { title: string; startsAt: Date; bookingUrl: string }[];
  scheduleUrl: string;
};

/**
 * Which sentence a money code gets. `paid`/`deposit` are the pre-refund codes —
 * only a message queued before ADR 20260813-shop-cancellation-refunds-itself
 * still carries one, and it keeps the wording it was written with.
 */
function blowoutMoneyKey(
  story: TripBlowoutEmailInput["paymentStory"],
):
  | "notifications.tripBlowout.moneyNone"
  | "notifications.tripBlowout.moneyPaid"
  | "notifications.tripBlowout.moneyDeposit"
  | "notifications.tripBlowout.moneyRefunded"
  | "notifications.tripBlowout.moneyRefundOwed" {
  switch (story) {
    case "refunded":
      return "notifications.tripBlowout.moneyRefunded";
    case "refund_owed":
      return "notifications.tripBlowout.moneyRefundOwed";
    case "paid":
      return "notifications.tripBlowout.moneyPaid";
    case "deposit":
      return "notifications.tripBlowout.moneyDeposit";
    default:
      return "notifications.tripBlowout.moneyNone";
  }
}

/**
 * The blow-out cascade message: the cancellation in one sentence, the diver's
 * money story, and the alternatives they actually qualify for as plain links
 * to the public booking pages. No alternatives degrades to a pointer at the
 * schedule — a diver whose cards fit nothing this month still deserves the
 * same prompt, honest message as everyone else on the roster.
 */
export function tripBlowoutEmail(input: TripBlowoutEmailInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const firstName = firstNameOf(input.diverName, t("notifications.common.genericName"));
  const date = formatShortDate(input.startsAt, input.locale, input.timezone);
  const body = t("notifications.tripBlowout.body", {
    shopName: input.shopName,
    tripTitle: input.tripTitle,
    date,
  });
  const bodyHtml = t("notifications.tripBlowout.body", {
    shopName: escapeHtml(input.shopName),
    tripTitle: `<strong>${escapeHtml(input.tripTitle)}</strong>`,
    date: escapeHtml(date),
  });
  const money = t(blowoutMoneyKey(input.paymentStory), { shopName: input.shopName });
  const seeSchedule = t("notifications.tripBlowout.seeSchedule");

  if (input.alternatives.length === 0) {
    const noAlternatives = t("notifications.tripBlowout.noAlternatives");
    return {
      subject: t("notifications.tripBlowout.subject", { tripTitle: input.tripTitle }),
      text: `${t("notifications.common.greeting", { firstName })}\n\n${body}\n\n${money}\n\n${noAlternatives}\n${seeSchedule}:\n${input.scheduleUrl}\n`,
      html: `<p>${t("notifications.common.greeting", { firstName: escapeHtml(firstName) })}</p><p>${bodyHtml}</p><p>${escapeHtml(money)}</p><p>${escapeHtml(noAlternatives)}</p><p><a href="${escapeHtml(input.scheduleUrl)}">${seeSchedule}</a></p>`,
    };
  }

  const intro = t("notifications.tripBlowout.alternativesIntro");
  const lines = input.alternatives.map((alternative) => ({
    label: t("notifications.tripBlowout.alternativeLine", {
      title: alternative.title,
      when: formatDateTimeTz(alternative.startsAt, input.locale, input.timezone),
    }),
    url: alternative.bookingUrl,
  }));
  const listText = lines.map((line) => `- ${line.label}\n  ${line.url}`).join("\n");
  const listHtml = `<ul>${lines
    .map((line) => `<li><a href="${escapeHtml(line.url)}">${escapeHtml(line.label)}</a></li>`)
    .join("")}</ul>`;

  return {
    subject: t("notifications.tripBlowout.subject", { tripTitle: input.tripTitle }),
    text: `${t("notifications.common.greeting", { firstName })}\n\n${body}\n\n${money}\n\n${intro}\n${listText}\n\n${seeSchedule}:\n${input.scheduleUrl}\n`,
    html: `<p>${t("notifications.common.greeting", { firstName: escapeHtml(firstName) })}</p><p>${bodyHtml}</p><p>${escapeHtml(money)}</p><p>${escapeHtml(intro)}</p>${listHtml}<p><a href="${escapeHtml(input.scheduleUrl)}">${seeSchedule}</a></p>`,
  };
}

/** "30 minutes" today, whatever the shop set otherwise. */
function dockCallPhrase(t: DiverTranslator, dockCallMinutes: number | undefined): string {
  return t("notifications.common.dockCallMinutes", { minutes: dockCallMinutes ?? 30 });
}

/** The diver's outstanding items as one bullet list, or empty when nothing's left. */
function outstandingLines(
  t: DiverTranslator,
  outstanding: ReminderActionCode[] | undefined,
  medicalReview: boolean | undefined,
) {
  const todo = (outstanding ?? []).map((code) => reminderActionText(t, code));
  if (medicalReview) todo.push(t("notifications.common.medicalReviewNote"));
  const heading = t("notifications.common.outstandingHeading");
  return {
    text: todo.length ? `\n\n${heading}\n${todo.map((item) => `- ${item}`).join("\n")}\n` : "",
    html: todo.length
      ? `<p>${heading}</p><ul>${todo.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : "",
  };
}

/**
 * The night-before brief's body — conditions, what to bring, and who to text —
 * rendered as text + html fragments slotted between the dock-time line and the
 * outstanding-items list. Empty strings when the brief carries nothing, so the
 * reminder degrades to the plain "you sail tomorrow" note.
 */
function briefSections(
  t: DiverTranslator,
  brief: NightBeforeBriefInput | undefined,
  arrivalLine: string,
) {
  const forecast = brief?.forecast?.trim();
  const bring = (brief?.bring ?? []).map((item) => item.trim()).filter(Boolean);
  const whoToText = brief?.whoToText?.trim();
  const firstTimer = brief?.firstTimerNote?.trim();

  const textParts: string[] = [];
  const htmlParts: string[] = [];
  if (firstTimer) {
    textParts.push(firstTimer);
    htmlParts.push(`<p>${escapeHtml(firstTimer)}</p>`);
  }
  if (forecast) {
    const label = t("notifications.brief.conditionsLabel");
    textParts.push(`${label} ${forecast}`);
    htmlParts.push(`<p><strong>${label}</strong> ${escapeHtml(forecast)}</p>`);
  }
  if (bring.length) {
    const label = t("notifications.brief.bringLabel");
    textParts.push(`${label}\n${bring.map((item) => `- ${item}`).join("\n")}`);
    htmlParts.push(
      `<p>${label}</p><ul>${bring.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`,
    );
  }
  // Arrival always renders on the brief — the concrete clock time is the
  // logistics half of the confidence arc.
  textParts.push(arrivalLine);
  htmlParts.push(`<p>${escapeHtml(arrivalLine)}</p>`);
  if (whoToText) {
    const line = t("notifications.brief.whoToText", { phone: whoToText });
    textParts.push(line);
    htmlParts.push(`<p>${escapeHtml(line)}</p>`);
  }
  return {
    text: textParts.length ? `\n\n${textParts.join("\n\n")}` : "",
    html: htmlParts.join(""),
  };
}

export type NotificationEmail = {
  subject: string;
  text: string;
  html: string;
};

export function bookingConfirmationEmail(input: BookingConfirmationEmailInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const firstName = firstNameOf(input.diverName, t("notifications.common.genericName"));
  const date = formatShortDate(input.startsAt, input.locale, input.timezone);
  const time = formatTimeRangeTz(input.startsAt, input.endsAt, input.locale, input.timezone);
  const title = escapeHtml(input.tripTitle);
  const shop = escapeHtml(input.shopName);
  const trackWhatsLeft = t("notifications.common.trackWhatsLeft");
  const readyText = input.readinessUrl ? `\n\n${trackWhatsLeft}:\n${input.readinessUrl}\n` : "\n";
  const readyHtml = input.readinessUrl
    ? `<p><a href="${escapeHtml(input.readinessUrl)}">${trackWhatsLeft}</a>.</p>`
    : "";

  const dock = dockCallPhrase(t, input.dockCallMinutes);
  const packingItems = (input.packingList ?? []).map((item) => item.trim()).filter(Boolean);
  const packingHeading = t("notifications.bookingConfirmation.packingHeading");
  const reminderText = packingItems.length
    ? `\n\n${packingHeading}\n${packingItems.map((item) => `- ${item}`).join("\n")}\n`
    : "";
  const reminderHtml = packingItems.length
    ? `<div style="margin-top: 20px; padding: 15px; border-left: 4px solid ${BRAND_PRIMARY_COLOR}; background-color: #f3f4f6; border-radius: 8px;"><strong>${packingHeading}</strong><ul style="margin-top: 8px; padding-left: 20px; margin-bottom: 0;">${packingItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`
    : "";

  const confirmed = t("notifications.bookingConfirmation.confirmed", {
    tripTitle: input.tripTitle,
  });
  const confirmedHtml = t("notifications.bookingConfirmation.confirmed", {
    tripTitle: `<strong>${title}</strong>`,
  });
  const dockNote = t("notifications.bookingConfirmation.dockNote", {
    dock,
    shopName: input.shopName,
  });
  const dockNoteHtml = t("notifications.bookingConfirmation.dockNote", { dock, shopName: shop });

  return {
    subject: t("notifications.bookingConfirmation.subject", { tripTitle: input.tripTitle }),
    text: `${t("notifications.common.greeting", { firstName })}\n\n${confirmed}\n\n${date}\n${time}\n\n${dockNote}${readyText}${reminderText}`,
    html: `<p>${t("notifications.common.greeting", { firstName: escapeHtml(firstName) })}</p><p>${confirmedHtml}</p><p><strong>${escapeHtml(date)}</strong><br>${escapeHtml(time)}</p><p>${dockNoteHtml}</p>${readyHtml}${reminderHtml}`,
  };
}

export function waitlistInviteEmail(input: WaitlistInviteEmailInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const firstName = firstNameOf(input.diverName, t("notifications.common.genericName"));
  const date = formatShortDate(input.startsAt, input.locale, input.timezone);
  const time = formatTimeRangeTz(input.startsAt, input.endsAt, input.locale, input.timezone);
  const title = escapeHtml(input.tripTitle);
  const url = escapeHtml(input.bookingUrl);

  const body = t("notifications.waitlistInvite.body", {
    tripTitle: input.tripTitle,
    shopName: input.shopName,
  });
  const bodyHtml = t("notifications.waitlistInvite.body", {
    tripTitle: `<strong>${title}</strong>`,
    shopName: escapeHtml(input.shopName),
  });
  const claim = t("notifications.waitlistInvite.claim");
  const footer = t("notifications.waitlistInvite.footer");
  const unsubscribe = t("notifications.common.courtesyUnsubscribe", { shopName: input.shopName });
  const unsubscribeUrl = escapeHtml(input.unsubscribeUrl);

  return {
    subject: t("notifications.waitlistInvite.subject", { tripTitle: input.tripTitle }),
    text: `${t("notifications.common.greeting", { firstName })}\n\n${body}\n\n${date}\n${time}\n\n${claim}:\n${input.bookingUrl}\n\n${footer}\n\n${unsubscribe}:\n${input.unsubscribeUrl}\n`,
    html: `<p>${t("notifications.common.greeting", { firstName: escapeHtml(firstName) })}</p><p>${bodyHtml}</p><p><strong>${escapeHtml(date)}</strong><br>${escapeHtml(time)}</p><p><a href="${url}">${t("notifications.waitlistInvite.claimLink")}</a></p><p>${footer}</p><p><a href="${unsubscribeUrl}">${escapeHtml(unsubscribe)}</a></p>`,
  };
}

export function tripInvitationEmail(input: TripInvitationEmailInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const firstName = firstNameOf(input.diverName, t("notifications.common.genericName"));
  const date = formatShortDate(input.startsAt, input.locale, input.timezone);
  const time = formatTimeRangeTz(input.startsAt, input.endsAt, input.locale, input.timezone);
  const title = escapeHtml(input.tripTitle);
  const url = escapeHtml(input.bookingUrl);
  const body = t("notifications.tripInvitation.body", {
    shopName: input.shopName,
    tripTitle: input.tripTitle,
  });
  const bodyHtml = t("notifications.tripInvitation.body", {
    shopName: escapeHtml(input.shopName),
    tripTitle: `<strong>${title}</strong>`,
  });
  const note = t("notifications.tripInvitation.note");
  const link = t("notifications.tripInvitation.link");
  const greeting = t("notifications.common.greeting", { firstName });
  const greetingHtml = t("notifications.common.greeting", {
    firstName: escapeHtml(firstName),
  });
  return {
    subject: t("notifications.tripInvitation.subject", {
      shopName: input.shopName,
      tripTitle: input.tripTitle,
    }),
    text: [greeting, body, `${date} · ${time}`, note, `${link}:`, input.bookingUrl].join("\n\n"),
    html: `<p>${greetingHtml}</p><p>${bodyHtml}</p><p><strong>${date}</strong><br>${time}</p><p>${note}</p><p><a href="${url}">${link}</a></p>`,
  };
}

/**
 * A staff-sent last-minute-fill discount (docs ADR 20260727-last-minute-fill-promos).
 * Leads with the deal, not the shop's inventory problem — a diver doesn't
 * need to know the trip is under capacity to want a good price on a dive.
 */
export function lastMinuteDealEmail(input: LastMinuteDealEmailInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const firstName = firstNameOf(input.diverName, t("notifications.common.genericName"));
  const date = formatShortDate(input.startsAt, input.locale, input.timezone);
  const time = formatTimeRangeTz(input.startsAt, input.endsAt, input.locale, input.timezone);
  const expires = formatDateTimeTz(input.expiresAt, input.locale, input.timezone);
  const title = escapeHtml(input.tripTitle);
  const url = escapeHtml(input.bookingUrl);
  const code = escapeHtml(input.code);

  const body = t("notifications.lastMinuteDeal.body", {
    shopName: input.shopName,
    discountPercent: input.discountPercent,
    tripTitle: input.tripTitle,
  });
  const bodyHtml = t("notifications.lastMinuteDeal.body", {
    shopName: escapeHtml(input.shopName),
    discountPercent: `<strong>${input.discountPercent}% off</strong>`,
    tripTitle: `<strong>${title}</strong>`,
  });
  const useCode = t("notifications.lastMinuteDeal.useCode", { code: input.code });
  const useCodeHtml = t("notifications.lastMinuteDeal.useCode", {
    code: `<strong>${code}</strong>`,
  });
  const expiry = t("notifications.lastMinuteDeal.expiry", { expires });
  const unsubscribe = t("notifications.lastMinuteDeal.unsubscribe", { shopName: input.shopName });
  const unsubscribeUrl = escapeHtml(input.unsubscribeUrl);

  return {
    subject: t("notifications.lastMinuteDeal.subject", {
      discountPercent: input.discountPercent,
      tripTitle: input.tripTitle,
    }),
    text: `${t("notifications.common.greeting", { firstName })}\n\n${body}\n\n${date}\n${time}\n\n${useCode}\n${input.bookingUrl}\n\n${expiry}\n\n${unsubscribe}:\n${input.unsubscribeUrl}\n`,
    html: `<p>${t("notifications.common.greeting", { firstName: escapeHtml(firstName) })}</p><p>${bodyHtml}</p><p><strong>${escapeHtml(date)}</strong><br>${escapeHtml(time)}</p><p>${useCodeHtml}</p><p><a href="${url}">${t("notifications.lastMinuteDeal.bookLink", { tripTitle: title })}</a></p><p>${t("notifications.lastMinuteDeal.expiry", { expires: escapeHtml(expires) })}</p><p><a href="${unsubscribeUrl}">${escapeHtml(unsubscribe)}</a></p>`,
  };
}

/**
 * The seat is held regardless of payment (docs ADR 20260721-checkout-at-booking)
 * — this is a nudge to finish paying, not a "you're about to lose your spot"
 * threat, since that would be false.
 */
export function checkoutRecoveryEmail(input: CheckoutRecoveryEmailInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const date = formatShortDate(input.startsAt, input.locale, input.timezone);
  const time = formatTimeRangeTz(input.startsAt, input.endsAt, input.locale, input.timezone);
  const title = escapeHtml(input.tripTitle);
  const url = escapeHtml(input.checkoutUrl);

  const body = t("notifications.checkoutRecovery.body", {
    tripTitle: input.tripTitle,
    shopName: input.shopName,
  });
  const bodyHtml = t("notifications.checkoutRecovery.body", {
    tripTitle: `<strong>${title}</strong>`,
    shopName: escapeHtml(input.shopName),
  });
  const pickUp = t("notifications.checkoutRecovery.pickUp");
  // The same words and the same opt-out flag the wait-list invite carries —
  // one courtesy-email switch, so a diver who turns it off turns off all of it.
  const unsubscribe = t("notifications.common.courtesyUnsubscribe", { shopName: input.shopName });
  const unsubscribeUrl = escapeHtml(input.unsubscribeUrl);

  return {
    subject: t("notifications.checkoutRecovery.subject", { tripTitle: input.tripTitle }),
    text: `${t("notifications.common.greetingGeneric")}\n\n${body}\n\n${date}\n${time}\n\n${pickUp}:\n${input.checkoutUrl}\n\n${unsubscribe}:\n${input.unsubscribeUrl}\n`,
    html: `<p>${t("notifications.common.greetingGeneric")}</p><p>${bodyHtml}</p><p><strong>${escapeHtml(date)}</strong><br>${escapeHtml(time)}</p><p><a href="${url}">${t("notifications.checkoutRecovery.finishPaying")}</a></p><p><a href="${unsubscribeUrl}">${escapeHtml(unsubscribe)}</a></p>`,
  };
}

export function tripReminderEmail(input: TripReminderEmailInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const firstName = firstNameOf(input.diverName, t("notifications.common.genericName"));
  const date = formatShortDate(input.startsAt, input.locale, input.timezone);
  const time = formatTimeRangeTz(input.startsAt, input.endsAt, input.locale, input.timezone);
  const title = escapeHtml(input.tripTitle);
  const shop = escapeHtml(input.shopName);
  const seeWhatsLeft = t("notifications.common.seeWhatsLeft");
  const readyText = input.readinessUrl ? `\n\n${seeWhatsLeft}:\n${input.readinessUrl}\n` : "\n";
  const readyHtml = input.readinessUrl
    ? `<p><a href="${escapeHtml(input.readinessUrl)}">${seeWhatsLeft}</a>.</p>`
    : "";
  // Name the diver's own outstanding items — the last automated chance to clear
  // a waiver or medical that would keep them off the boat (dive-domain review).
  const todo = outstandingLines(t, input.outstanding, input.medicalReview);
  const dock = dockCallPhrase(t, input.dockCallMinutes);

  // The 7-day reminder stays a light nudge. The night-before (day) lead becomes
  // the full brief: conditions, what to bring, a concrete arrival time, and who
  // to text — the confidence arc that keeps an anxious diver from no-showing.
  if (input.lead === "day") {
    const dockMinutes = input.dockCallMinutes ?? 30;
    const arriveBy = new Date(input.startsAt.getTime() - dockMinutes * 60_000);
    const arrivalClock = formatTime(arriveBy, input.locale, input.timezone);
    const arrivalLine = t("notifications.tripReminder.arrival", { time: arrivalClock, dock });
    const brief = briefSections(t, input.brief, arrivalLine);
    const opener = input.brief?.firstTimerNote
      ? t("notifications.tripReminder.dayOpenerFirstTimer", { shopName: input.shopName })
      : t("notifications.tripReminder.dayOpenerReturning", {
          tripTitle: input.tripTitle,
          shopName: input.shopName,
        });
    const openerHtml = input.brief?.firstTimerNote
      ? t("notifications.tripReminder.dayOpenerFirstTimer", { shopName: shop })
      : t("notifications.tripReminder.dayOpenerReturning", {
          tripTitle: `<strong>${title}</strong>`,
          shopName: shop,
        });
    return {
      subject: t("notifications.tripReminder.daySubject", { tripTitle: input.tripTitle }),
      text: `${t("notifications.common.greeting", { firstName })}\n\n${opener}\n\n${date}\n${time}${brief.text}${todo.text}${readyText}`,
      html: `<p>${t("notifications.common.greeting", { firstName: escapeHtml(firstName) })}</p><p>${openerHtml}</p><p><strong>${escapeHtml(date)}</strong><br>${escapeHtml(time)}</p>${brief.html}${todo.html}${readyHtml}`,
    };
  }

  const weekBody = t("notifications.tripReminder.weekBody", {
    tripTitle: input.tripTitle,
    shopName: input.shopName,
  });
  const weekBodyHtml = t("notifications.tripReminder.weekBody", {
    tripTitle: `<strong>${title}</strong>`,
    shopName: shop,
  });
  const dockNote = t("notifications.tripReminder.dockNote", { dock });

  return {
    subject: t("notifications.tripReminder.weekSubject", { tripTitle: input.tripTitle }),
    text: `${t("notifications.common.greeting", { firstName })}\n\n${weekBody}\n\n${date}\n${time}\n\n${dockNote}${todo.text}${readyText}`,
    html: `<p>${t("notifications.common.greeting", { firstName: escapeHtml(firstName) })}</p><p>${weekBodyHtml}</p><p><strong>${escapeHtml(date)}</strong><br>${escapeHtml(time)}</p><p>${dockNote}</p>${todo.html}${readyHtml}`,
  };
}

type TripRecapEmailInput = {
  locale: DiverLocale;
  diverName: string;
  shopName: string;
  tripTitle: string;
  startsAt: Date;
  timezone: string;
  /** The names of the sites dived, in order, for the recap's opening line. */
  sites?: string[];
  /** The diver's shareable recap page. */
  recapUrl: string;
  /** Self-serve opt-out of `waitlist_invite`/`trip_recap` courtesy email. */
  unsubscribeUrl: string;
};

export function tripRecapEmail(input: TripRecapEmailInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const firstName = firstNameOf(input.diverName, t("notifications.common.genericName"));
  const date = formatShortDate(input.startsAt, input.locale, input.timezone);
  const title = escapeHtml(input.tripTitle);
  const shop = escapeHtml(input.shopName);
  const url = escapeHtml(input.recapUrl);
  const sites = (input.sites ?? []).map((site) => site.trim()).filter(Boolean);
  // Name the sites they dived when we know them — the recap is warmer when it
  // remembers the day rather than nudging generically.
  const siteList = sites.length
    ? cachedListFormat(input.locale, { style: "long", type: "conjunction" }).format(sites)
    : "";
  const where = sites.length ? ` ${t("notifications.tripRecap.dived", { sites: siteList })}` : "";
  const whereHtml = sites.length
    ? ` ${t("notifications.tripRecap.dived", { sites: escapeHtml(siteList) })}`
    : "";

  const thanks = t("notifications.tripRecap.thanks", {
    tripTitle: input.tripTitle,
    shopName: input.shopName,
    date,
  });
  const thanksHtml = t("notifications.tripRecap.thanks", {
    tripTitle: `<strong>${title}</strong>`,
    shopName: shop,
    date: escapeHtml(date),
  });
  const seeRecap = t("notifications.tripRecap.seeRecap");
  const footer = t("notifications.tripRecap.footer");
  const unsubscribe = t("notifications.common.courtesyUnsubscribe", { shopName: input.shopName });
  const unsubscribeUrl = escapeHtml(input.unsubscribeUrl);

  return {
    subject: t("notifications.tripRecap.subject", {
      shopName: input.shopName,
      tripTitle: input.tripTitle,
    }),
    text: `${t("notifications.common.greeting", { firstName })}\n\n${thanks}${where}\n\n${seeRecap}:\n${input.recapUrl}\n\n${footer}\n\n${unsubscribe}:\n${input.unsubscribeUrl}\n`,
    html: `<p>${t("notifications.common.greeting", { firstName: escapeHtml(firstName) })}</p><p>${thanksHtml}${whereHtml}</p><p><a href="${url}">${seeRecap}</a>.</p><p>${footer}</p><p><a href="${unsubscribeUrl}">${escapeHtml(unsubscribe)}</a></p>`,
  };
}

type WelcomeEmailInput = {
  locale: DiverLocale;
  ownerName: string;
  shopName: string;
  signInUrl: string;
};

/**
 * Sent once, right after `/onboard` creates the shop — no action link beyond
 * a sign-in nudge, since onboarding already signs the owner in immediately.
 */
export function welcomeEmail(input: WelcomeEmailInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const firstName = firstNameOf(input.ownerName, t("notifications.common.genericName"));
  const shop = escapeHtml(input.shopName);
  const url = escapeHtml(input.signInUrl);

  const body = t("notifications.welcome.body", { shopName: input.shopName });
  const bodyHtml = t("notifications.welcome.body", { shopName: `<strong>${shop}</strong>` });
  const signIn = t("notifications.welcome.signIn");
  const footer = t("notifications.welcome.footer");

  return {
    subject: t("notifications.welcome.subject", { shopName: input.shopName }),
    text: `${t("notifications.common.greeting", { firstName })}\n\n${body}\n\n${signIn}:\n${input.signInUrl}\n\n${footer}\n`,
    html: `<p>${t("notifications.common.greeting", { firstName: escapeHtml(firstName) })}</p><p>${bodyHtml}</p><p><a href="${url}">${signIn}</a>.</p><p>${footer}</p>`,
  };
}

type NewAccountAlertEmailInput = {
  ownerName: string;
  ownerEmail: string;
  shopName: string;
  shopSlug: string;
};

/**
 * Internal — lands in the founder's alert inbox, not a diver's or shop's, so
 * it stays English on purpose rather than following the shop's locale (docs
 * ADR 20260731-notification-locale): there is no shop-owner or diver
 * recipient here to speak to in their own language.
 */
export function newAccountAlertEmail(input: NewAccountAlertEmailInput): NotificationEmail {
  const owner = escapeHtml(input.ownerName);
  const email = escapeHtml(input.ownerEmail);
  const shop = escapeHtml(input.shopName);
  const slug = escapeHtml(input.shopSlug);

  return {
    subject: `New shop: ${input.shopName}`,
    text: `${input.ownerName} (${input.ownerEmail}) just created "${input.shopName}" (/shop/${input.shopSlug}).\n`,
    html: `<p><strong>${owner}</strong> (${email}) just created <strong>${shop}</strong> (<code>/shop/${slug}</code>).</p>`,
  };
}

type DemoStartedAlertEmailInput = {
  shopSlug: string;
  role: DemoRoleId;
  source: string;
};

/**
 * Internal, English, and deliberately anonymous — the demo half of the same
 * founder alert `newAccountAlertEmail` sends for a trial (docs ADR
 * 20260805-demo-try-alerts). There is nobody to address: a demo visitor never
 * identifies themselves, so this names the throwaway shop, the role they looked
 * through, and the marketing page that sent them, and nothing else. Every value
 * is still escaped, because `shopSlug` and `source` reach here as strings even
 * though both are generated or registry-clamped upstream.
 */
export function demoStartedAlertEmail(input: DemoStartedAlertEmailInput): NotificationEmail {
  const slug = escapeHtml(input.shopSlug);
  const role = escapeHtml(input.role);
  const source = escapeHtml(input.source);

  return {
    subject: `Demo tried: ${input.role} (from ${input.source})`,
    text: `Somebody opened the live demo as ${input.role}, from ${input.source}. Their shop is /shop/${input.shopSlug}.\n`,
    html: `<p>Somebody opened the live demo as <strong>${role}</strong>, from <strong>${source}</strong>. Their shop is <code>/shop/${slug}</code>.</p>`,
  };
}

type UsageCeilingAlertEmailInput = {
  ceilingId: string;
  provider: string;
  metric: string;
  unit: string;
  level: "warn" | "over";
  periodKey: string;
  value: number;
  ceiling: number;
  percent: number;
  overflow: "bills_overage" | "suspends" | "drops";
};

/**
 * What the provider does at this ceiling, in the founder's own words.
 *
 * The mapping lives here rather than in `@/lib/cost-guardrails` on purpose:
 * the registry holds the code, this file — the terminal renderer — picks the
 * sentence, which is the same division `readinessStatusText` applies to every
 * status in the product.
 */
const overflowConsequence: Record<UsageCeilingAlertEmailInput["overflow"], string> = {
  bills_overage: "keeps serving and bills the overage",
  suspends: "suspends the resource until the period rolls over",
  drops: "silently discards whatever is over the line",
};

/** Two decimals is enough for dollars and for GiB; no locale, no separators. */
function usageFigure(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * A provider ceiling this deployment is approaching or past (docs ADR
 * 20260806-provider-usage-guardrails).
 *
 * Internal and English, exactly like `newAccountAlertEmail` and
 * `demoStartedAlertEmail` above: it lands in the founder's alert inbox, where
 * there is no shop or diver to address in their own language. It carries no
 * personal data of any kind — every field is a machine key or a number about
 * an invoice.
 *
 * The last line is not decoration. This alert exists on an explicitly
 * alert-only guardrail (ADR 20260802-aws-cost-guardrails set that posture for
 * AWS and this change mirrors it), and an operator reading a cost warning at
 * 7am should not have to wonder whether something already shut itself off.
 */
export function usageCeilingAlertEmail(input: UsageCeilingAlertEmailInput): NotificationEmail {
  const ceilingId = escapeHtml(input.ceilingId);
  const provider = escapeHtml(input.provider);
  const metric = escapeHtml(input.metric);
  const unit = escapeHtml(input.unit);
  const period = escapeHtml(input.periodKey);
  const value = usageFigure(input.value);
  const ceiling = usageFigure(input.ceiling);
  const headline = input.level === "over" ? "over ceiling" : "warning";
  const consequence = overflowConsequence[input.overflow];
  const reading = `${value} of ${ceiling} ${input.unit} (${input.percent}%)`;
  const readingHtml = `${escapeHtml(value)} of ${escapeHtml(ceiling)} ${unit} (${input.percent}%)`;

  return {
    subject: `Usage ${headline}: ${input.ceilingId} at ${input.percent}% (${input.periodKey})`,
    text: `${input.ceilingId} is at ${reading} for ${input.periodKey}.\n\nProvider: ${input.provider} / ${input.metric}.\nAt the ceiling, ${input.provider} ${consequence}.\n\nAlert-only: nothing has been disabled, throttled, or turned off.\n`,
    html: `<p><strong>${ceilingId}</strong> is at ${readingHtml} for ${period}.</p><p>Provider: <code>${provider}</code> / <code>${metric}</code>. At the ceiling, ${provider} ${consequence}.</p><p>Alert-only: nothing has been disabled, throttled, or turned off.</p>`,
  };
}

type VerifyAccountEmailInput = {
  locale: DiverLocale;
  ownerName: string;
  verifyUrl: string;
  expiresAt: Date;
  timezone: string;
};

export function verifyAccountEmail(input: VerifyAccountEmailInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const firstName = firstNameOf(input.ownerName, t("notifications.common.genericName"));
  const expiresAt = formatDateTimeTz(input.expiresAt, input.locale, input.timezone);
  const url = escapeHtml(input.verifyUrl);
  const confirm = t("notifications.verifyAccount.confirm");
  const expiry = t("notifications.verifyAccount.expiry", { expiresAt });

  return {
    subject: t("notifications.verifyAccount.subject"),
    text: `${t("notifications.common.greeting", { firstName })}\n\n${confirm}:\n${input.verifyUrl}\n\n${expiry}\n`,
    html: `<p>${t("notifications.common.greeting", { firstName: escapeHtml(firstName) })}</p><p><a href="${url}">${confirm}</a>.</p><p>${t("notifications.verifyAccount.expiry", { expiresAt: escapeHtml(expiresAt) })}</p>`,
  };
}

type StaffInviteEmailInput = {
  locale: DiverLocale;
  inviteeName: string;
  shopName: string;
  inviterName: string;
  roleLabels: string[];
  inviteUrl: string;
  expiresAt: Date;
  timezone: string;
};

export function staffInviteEmail(input: StaffInviteEmailInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const firstName = firstNameOf(input.inviteeName, t("notifications.common.genericName"));
  const roles = cachedListFormat(input.locale, { style: "long", type: "conjunction" }).format(
    input.roleLabels,
  );
  const expiresAt = formatDateTimeTz(input.expiresAt, input.locale, input.timezone);
  const shop = escapeHtml(input.shopName);
  const url = escapeHtml(input.inviteUrl);

  const body = t("notifications.staffInvite.body", {
    inviterName: input.inviterName,
    shopName: input.shopName,
    roles,
  });
  const bodyHtml = t("notifications.staffInvite.body", {
    inviterName: escapeHtml(input.inviterName),
    shopName: `<strong>${shop}</strong>`,
    roles: escapeHtml(roles),
  });
  const setPassword = t("notifications.staffInvite.setPassword");
  const expiry = t("notifications.staffInvite.expiry", { expiresAt });

  return {
    subject: t("notifications.staffInvite.subject", {
      inviterName: input.inviterName,
      shopName: input.shopName,
    }),
    text: `${t("notifications.common.greeting", { firstName })}\n\n${body}\n\n${setPassword}:\n${input.inviteUrl}\n\n${expiry}\n`,
    html: `<p>${t("notifications.common.greeting", { firstName: escapeHtml(firstName) })}</p><p>${bodyHtml}</p><p><a href="${url}">${setPassword}</a>.</p><p>${t("notifications.staffInvite.expiry", { expiresAt: escapeHtml(expiresAt) })}</p>`,
  };
}

type PasswordResetEmailInput = {
  locale: DiverLocale;
  ownerName: string;
  resetUrl: string;
  expiresAt: Date;
  timezone: string;
};

export function passwordResetEmail(input: PasswordResetEmailInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const firstName = firstNameOf(input.ownerName, t("notifications.common.genericName"));
  const expiresAt = formatDateTimeTz(input.expiresAt, input.locale, input.timezone);
  const url = escapeHtml(input.resetUrl);
  const body = t("notifications.passwordReset.body");
  const choose = t("notifications.passwordReset.choose");
  const expiry = t("notifications.passwordReset.expiry", { expiresAt });

  return {
    subject: t("notifications.passwordReset.subject"),
    text: `${t("notifications.common.greeting", { firstName })}\n\n${body} ${choose}:\n${input.resetUrl}\n\n${expiry}\n`,
    html: `<p>${t("notifications.common.greeting", { firstName: escapeHtml(firstName) })}</p><p>${body} <a href="${url}">${choose}</a>.</p><p>${t("notifications.passwordReset.expiry", { expiresAt: escapeHtml(expiresAt) })}</p>`,
  };
}

type PasswordChangedEmailInput = {
  locale: DiverLocale;
  ownerName: string;
  /**
   * The recovery link for someone this *wasn't* — omitted only when
   * APP_HOST isn't configured. Never "sign in and set a new password":
   * the whole point of this notice is that the old password no longer
   * works for whoever didn't make this change, so the only usable recovery
   * path is requesting a fresh reset (security review finding).
   */
  forgotPasswordUrl?: string;
};

export function passwordChangedEmail(input: PasswordChangedEmailInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const firstName = firstNameOf(input.ownerName, t("notifications.common.genericName"));
  const recoveryText = input.forgotPasswordUrl
    ? `${t("notifications.passwordChanged.recoveryWithLink")}:\n${input.forgotPasswordUrl}\n`
    : `${t("notifications.passwordChanged.recoveryNoLink")}\n`;
  const recoveryHtml = input.forgotPasswordUrl
    ? `<p>${t("notifications.passwordChanged.recoveryWithLinkHtml", { link: `<a href="${escapeHtml(input.forgotPasswordUrl)}">${t("notifications.passwordChanged.recoveryLinkText")}</a>` })}</p>`
    : `<p>${t("notifications.passwordChanged.recoveryNoLink")}</p>`;

  return {
    subject: t("notifications.passwordChanged.subject"),
    text: `${t("notifications.common.greeting", { firstName })}\n\n${t("notifications.passwordChanged.body")}\n\n${recoveryText}`,
    html: `<p>${t("notifications.common.greeting", { firstName: escapeHtml(firstName) })}</p><p>${t("notifications.passwordChanged.body")}</p>${recoveryHtml}`,
  };
}

export function waiverRequestEmail(input: WaiverRequestEmailInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const firstName = firstNameOf(input.diverName, t("notifications.common.genericName"));
  const expiresAt = formatDateTimeTz(input.expiresAt, input.locale, input.timezone);
  const tripTitle = input.tripTitle?.trim();
  const title = tripTitle ? escapeHtml(tripTitle) : null;
  const shop = escapeHtml(input.shopName);
  const url = escapeHtml(input.completionUrl);

  const body = tripTitle
    ? t("notifications.waiverRequest.body", {
        shopName: input.shopName,
        tripTitle,
      })
    : t("notifications.waiverRequest.genericBody", { shopName: input.shopName });
  const bodyHtml = tripTitle
    ? t("notifications.waiverRequest.body", {
        shopName: shop,
        tripTitle: `<strong>${title}</strong>`,
      })
    : t("notifications.waiverRequest.genericBody", { shopName: shop });
  const completeText = t("notifications.waiverRequest.completeText");
  const completeLink = t("notifications.waiverRequest.completeLink");
  const expiry = t("notifications.waiverRequest.expiry", { expiresAt });
  const subject = tripTitle
    ? t("notifications.waiverRequest.subject", { tripTitle })
    : t("notifications.waiverRequest.genericSubject");

  return {
    subject,
    text: `${t("notifications.common.greeting", { firstName })}\n\n${body} ${completeText}:\n${input.completionUrl}\n\n${expiry}\n`,
    html: `<p>${t("notifications.common.greeting", { firstName: escapeHtml(firstName) })}</p><p>${bodyHtml}</p><p><a href="${url}">${completeLink}</a></p><p>${t("notifications.waiverRequest.expiry", { expiresAt: escapeHtml(expiresAt) })}</p>`,
  };
}

/**
 * **The diver's replacement trip-prep link**, asked for from the dead page
 * their old one now shows (issue #850).
 *
 * Short on purpose: this email exists to carry a link somebody has just asked
 * for and is waiting on, so it says which departure it is about, why it
 * arrived, and when it dies. The "what's left before you sail" content is the
 * page's job, one tap away — restating it here would be a second surface to
 * keep in step with readiness and it would go stale in the diver's inbox.
 */
export function readinessLinkEmail(input: ReadinessLinkEmailInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const firstName = firstNameOf(input.diverName, t("notifications.common.genericName"));
  const expiresAt = formatDateTimeTz(input.expiresAt, input.locale, input.timezone);
  const body = t("notifications.readinessLink.body", {
    shopName: input.shopName,
    tripTitle: input.tripTitle,
  });
  const bodyHtml = t("notifications.readinessLink.body", {
    shopName: escapeHtml(input.shopName),
    tripTitle: `<strong>${escapeHtml(input.tripTitle)}</strong>`,
  });
  const openLink = t("notifications.readinessLink.openLink");

  return {
    subject: t("notifications.readinessLink.subject", { tripTitle: input.tripTitle }),
    text: `${t("notifications.common.greeting", { firstName })}\n\n${body}\n\n${input.readinessUrl}\n\n${t(
      "notifications.readinessLink.expiry",
      { expiresAt },
    )}\n`,
    html: `<p>${t("notifications.common.greeting", { firstName: escapeHtml(firstName) })}</p><p>${bodyHtml}</p><p><a href="${escapeHtml(
      input.readinessUrl,
    )}">${openLink}</a></p><p>${t("notifications.readinessLink.expiry", { expiresAt: escapeHtml(expiresAt) })}</p>`,
  };
}

type CourseInquiryEmailInput = {
  locale: DiverLocale;
  shopName: string;
  courseTitle: string;
  /** Every field the diver could have left blank — the shop's own inbox
   *  shows "Not said" rather than an empty line (mirrors src/lib/course-inquiry.ts). */
  inquirerName?: string;
  inquirerEmail?: string;
  inquirerPhone?: string;
  experience: CourseInquiryExperience;
  timing?: string;
  /**
   * The dates the diver named, if they named any. Unlike every other blank
   * above these render *nothing* rather than "Not said" — `timing`'s free text
   * already answers "when", so a "Dates asked for: Not said" line would be a
   * second empty answer to a question that was not asked twice.
   */
  preferredDate?: CalendarDate;
  alternateDate?: CalendarDate;
  dateFlexible?: boolean;
  divers?: number;
  message?: string;
};

/**
 * Lands in the shop's own contact inbox, not a diver's — the notification
 * counterpart to the `mailto:` composer a diver can still use directly
 * (CourseInquiry.tsx). Uses the shop's locale like every other shop-facing
 * send (staffInviteEmail), not English-only like the founder-only
 * new_account_alert.
 */
export function courseInquiryEmail(input: CourseInquiryEmailInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const notSaid = t("inquiry.notSaid");
  const name = input.inquirerName?.trim() || t("notifications.courseInquiry.anonymous");
  const email = input.inquirerEmail?.trim() || notSaid;
  const phone = input.inquirerPhone?.trim() || notSaid;
  const timing = input.timing?.trim() || notSaid;
  const divers = input.divers != null ? String(input.divers) : notSaid;
  const experience = t(COURSE_INQUIRY_EXPERIENCE_KEYS[input.experience]);
  const message = input.message?.trim() || "";

  const courseTitle = escapeHtml(input.courseTitle);
  const intro = t("notifications.courseInquiry.intro", { name, courseTitle: input.courseTitle });
  const introHtml = t("notifications.courseInquiry.intro", {
    name: escapeHtml(name),
    courseTitle: `<strong>${courseTitle}</strong>`,
  });
  const contact = t("notifications.courseInquiry.contact", { email, phone });
  const contactHtml = t("notifications.courseInquiry.contact", {
    email: escapeHtml(email),
    phone: escapeHtml(phone),
  });
  const timingLine = t("notifications.courseInquiry.timing", { timing });
  const diversLine = t("notifications.courseInquiry.divers", { divers });
  const experienceLine = t("notifications.courseInquiry.experience", { experience });
  // Above the free-text "when suits": the structured answer leads, the diver's
  // own words qualify it. A disjunction list ("Aug 6 or Aug 13") rather than a
  // hand-joined string, so the separator is the locale's and not English's.
  const named = [input.preferredDate, input.alternateDate].filter((d) => d != null);
  const datesLine =
    named.length > 0
      ? t(
          input.dateFlexible
            ? "notifications.courseInquiry.datesFlexible"
            : "notifications.courseInquiry.dates",
          {
            dates: cachedListFormat(input.locale, { style: "long", type: "disjunction" }).format(
              named.map((date) => formatCalendarDate(date, input.locale)),
            ),
          },
        )
      : null;
  const facts = [datesLine, timingLine, diversLine, experienceLine].filter((line) => line != null);

  return {
    subject: t("notifications.courseInquiry.subject", { courseTitle: input.courseTitle }),
    text: `${intro}\n\n${contact}\n${facts.join("\n")}${message ? `\n\n${message}` : ""}\n`,
    html: `<p>${introHtml}</p><p>${contactHtml}<br>${facts.map(escapeHtml).join("<br>")}</p>${message ? `<p>${escapeHtml(message)}</p>` : ""}`,
  };
}
