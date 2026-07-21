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
  /** Minutes before departure to be at the dock; the shop's call, default 30. */
  dockCallMinutes?: number;
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

type TripReminderEmailInput = {
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
  /**
   * The diver's own outstanding items, as short imperatives ("sign your
   * waiver"), so the reminder names what's left rather than a generic nudge.
   */
  outstanding?: string[];
  /** True when a medical answer may need a doctor's sign-off before boarding. */
  medicalReview?: boolean;
  /** The diver's readiness page, so they can finish what's outstanding. */
  readinessUrl?: string;
};

/** "30 minutes" today, whatever the shop set otherwise. */
function dockCallPhrase(dockCallMinutes: number | undefined): string {
  return `${dockCallMinutes ?? 30} minutes`;
}

/** The diver's outstanding items as one bullet list, or empty when nothing's left. */
function outstandingLines(outstanding: string[] | undefined, medicalReview: boolean | undefined) {
  const todo = [...(outstanding ?? [])];
  if (medicalReview) {
    todo.push("check whether a medical answer needs a doctor's sign-off before you travel");
  }
  const capitalized = todo.map((item) => item.charAt(0).toUpperCase() + item.slice(1));
  return {
    text: capitalized.length
      ? `\n\nStill to sort before you board:\n${capitalized.map((t) => `- ${t}`).join("\n")}\n`
      : "",
    html: capitalized.length
      ? `<p>Still to sort before you board:</p><ul>${capitalized
          .map((t) => `<li>${escapeHtml(t)}</li>`)
          .join("")}</ul>`
      : "",
  };
}

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

  const dock = dockCallPhrase(input.dockCallMinutes);
  return {
    subject: `You're on the boat — ${input.tripTitle}`,
    text: `Hi ${firstName},\n\nYour spot on ${input.tripTitle} is confirmed.\n\n${date}\n${time}\n\nPlease be at the dock ${dock} early. ${input.shopName} will take it from there.${readyText}`,
    html: `<p>Hi ${escapeHtml(firstName)},</p><p>Your spot on <strong>${title}</strong> is confirmed.</p><p><strong>${escapeHtml(date)}</strong><br>${escapeHtml(time)}</p><p>Please be at the dock ${dock} early. ${shop} will take it from there.</p>${readyHtml}`,
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

export function tripReminderEmail(input: TripReminderEmailInput): NotificationEmail {
  const firstName = input.diverName.trim().split(/\s+/)[0] || "there";
  const date = formatShortDate(input.startsAt, "en-US", input.timezone);
  const time = formatTimeRangeTz(input.startsAt, input.endsAt, "en-US", input.timezone);
  const title = escapeHtml(input.tripTitle);
  const shop = escapeHtml(input.shopName);
  const when = input.lead === "week" ? "this week" : "tomorrow";
  const readyText = input.readinessUrl
    ? `\n\nSee what's left before you sail:\n${input.readinessUrl}\n`
    : "\n";
  const readyHtml = input.readinessUrl
    ? `<p><a href="${escapeHtml(input.readinessUrl)}">See what's left before you sail</a>.</p>`
    : "";
  // Name the diver's own outstanding items — the last automated chance to clear
  // a waiver or medical that would keep them off the boat (dive-domain review).
  const todo = outstandingLines(input.outstanding, input.medicalReview);
  const dock = dockCallPhrase(input.dockCallMinutes);

  return {
    subject: `You sail ${when} — ${input.tripTitle}`,
    text: `Hi ${firstName},\n\nA quick reminder that ${input.tripTitle} with ${input.shopName} sails ${when}.\n\n${date}\n${time}\n\nPlease be at the dock ${dock} early.${todo.text}${readyText}`,
    html: `<p>Hi ${escapeHtml(firstName)},</p><p>A quick reminder that <strong>${title}</strong> with ${shop} sails ${when}.</p><p><strong>${escapeHtml(date)}</strong><br>${escapeHtml(time)}</p><p>Please be at the dock ${dock} early.</p>${todo.html}${readyHtml}`,
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
