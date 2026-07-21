import { formatDateTimeTz, formatShortDate, formatTimeRangeTz } from "@/lib/format";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

type BookingConfirmationEmailInput = {
  diverName: string;
  shopName: string;
  tripTitle: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  /** The diver's readiness page, so a closed tab never loses it. */
  readinessUrl?: string;
};

type WaiverRequestEmailInput = {
  diverName: string;
  shopName: string;
  tripTitle: string;
  completionUrl: string;
  expiresAt: Date;
  timezone: string;
};

type WaitlistInviteEmailInput = {
  diverName: string;
  shopName: string;
  tripTitle: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  /** The public trip page where the freed seat can be claimed. */
  bookingUrl: string;
};

export type NotificationEmail = {
  subject: string;
  text: string;
  html: string;
};

export function bookingConfirmationEmail(input: BookingConfirmationEmailInput): NotificationEmail {
  const firstName = input.diverName.trim().split(/\s+/)[0] || "there";
  const date = formatShortDate(input.startsAt, "en-US", input.timezone);
  const time = formatTimeRangeTz(input.startsAt, input.endsAt, "en-US", input.timezone);
  const title = escapeHtml(input.tripTitle);
  const shop = escapeHtml(input.shopName);
  const readyText = input.readinessUrl
    ? `\n\nTrack what's left before you sail:\n${input.readinessUrl}\n`
    : "\n";
  const readyHtml = input.readinessUrl
    ? `<p><a href="${escapeHtml(input.readinessUrl)}">Track what's left before you sail</a>.</p>`
    : "";

  return {
    subject: `You're on the boat — ${input.tripTitle}`,
    text: `Hi ${firstName},\n\nYour spot on ${input.tripTitle} is confirmed.\n\n${date}\n${time}\n\nPlease be at the dock 30 minutes early. ${input.shopName} will take it from there.${readyText}`,
    html: `<p>Hi ${escapeHtml(firstName)},</p><p>Your spot on <strong>${title}</strong> is confirmed.</p><p><strong>${escapeHtml(date)}</strong><br>${escapeHtml(time)}</p><p>Please be at the dock 30 minutes early. ${shop} will take it from there.</p>${readyHtml}`,
  };
}

export function waitlistInviteEmail(input: WaitlistInviteEmailInput): NotificationEmail {
  const firstName = input.diverName.trim().split(/\s+/)[0] || "there";
  const date = formatShortDate(input.startsAt, "en-US", input.timezone);
  const time = formatTimeRangeTz(input.startsAt, input.endsAt, "en-US", input.timezone);
  const title = escapeHtml(input.tripTitle);
  const shop = escapeHtml(input.shopName);
  const url = escapeHtml(input.bookingUrl);

  return {
    subject: `A spot opened up on ${input.tripTitle}`,
    text: `Hi ${firstName},\n\nA seat just opened on ${input.tripTitle} with ${input.shopName}, and you're next on the wait list.\n\n${date}\n${time}\n\nClaim it before it's gone:\n${input.bookingUrl}\n\nSeats go first-come, so don't wait too long. See you on the boat!\n`,
    html: `<p>Hi ${escapeHtml(firstName)},</p><p>A seat just opened on <strong>${title}</strong> with ${shop}, and you're next on the wait list.</p><p><strong>${escapeHtml(date)}</strong><br>${escapeHtml(time)}</p><p><a href="${url}">Claim your spot</a></p><p>Seats go first-come, so don't wait too long. See you on the boat!</p>`,
  };
}

export function waiverRequestEmail(input: WaiverRequestEmailInput): NotificationEmail {
  const firstName = input.diverName.trim().split(/\s+/)[0] || "there";
  const expiresAt = formatDateTimeTz(input.expiresAt, "en-US", input.timezone);
  const title = escapeHtml(input.tripTitle);
  const shop = escapeHtml(input.shopName);
  const url = escapeHtml(input.completionUrl);

  return {
    subject: `Complete your waiver for ${input.tripTitle}`,
    text: `Hi ${firstName},\n\n${input.shopName} needs your waiver for ${input.tripTitle}. Complete it here:\n${input.completionUrl}\n\nThis private link expires ${expiresAt}.\n`,
    html: `<p>Hi ${escapeHtml(firstName)},</p><p>${shop} needs your waiver for <strong>${title}</strong>.</p><p><a href="${url}">Complete your waiver</a></p><p>This private link expires ${escapeHtml(expiresAt)}.</p>`,
  };
}
