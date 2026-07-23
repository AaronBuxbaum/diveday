import { formatDateTimeTz, formatShortDate, formatTime, formatTimeRangeTz } from "@/lib/format";

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
  /** Extra "what happens on the boat" reassurance for a first-timer. */
  firstTimerNote?: string | null;
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
  /** Present on the night-before (day) lead only; enriches it into a full brief. */
  brief?: NightBeforeBriefInput;
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

/**
 * The night-before brief's body — conditions, what to bring, and who to text —
 * rendered as text + html fragments slotted between the dock-time line and the
 * outstanding-items list. Empty strings when the brief carries nothing, so the
 * reminder degrades to the plain "you sail tomorrow" note.
 */
function briefSections(brief: NightBeforeBriefInput | undefined, arrivalLine: string) {
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
    textParts.push(`Conditions: ${forecast}`);
    htmlParts.push(`<p><strong>Conditions:</strong> ${escapeHtml(forecast)}</p>`);
  }
  if (bring.length) {
    textParts.push(`What to bring:\n${bring.map((item) => `- ${item}`).join("\n")}`);
    htmlParts.push(
      `<p>What to bring:</p><ul>${bring.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`,
    );
  }
  // Arrival always renders on the brief — the concrete clock time is the
  // logistics half of the confidence arc.
  textParts.push(arrivalLine);
  htmlParts.push(`<p>${escapeHtml(arrivalLine)}</p>`);
  if (whoToText) {
    const line = `Questions on the day? Text the shop at ${whoToText}.`;
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

  // The 7-day reminder stays a light nudge. The night-before (day) lead becomes
  // the full brief: conditions, what to bring, a concrete arrival time, and who
  // to text — the confidence arc that keeps an anxious diver from no-showing.
  if (input.lead === "day") {
    const dockMinutes = input.dockCallMinutes ?? 30;
    const arriveBy = new Date(input.startsAt.getTime() - dockMinutes * 60_000);
    const arrivalClock = formatTime(arriveBy, "en-US", input.timezone);
    const arrivalLine = `Aim to be at the dock by ${arrivalClock} — ${dock} before we sail.`;
    const brief = briefSections(input.brief, arrivalLine);
    const opener = input.brief?.firstTimerNote
      ? `You dive with ${input.shopName} tomorrow — here's everything you need for the day.`
      : `A quick reminder that ${input.tripTitle} with ${input.shopName} sails tomorrow.`;
    const openerHtml = input.brief?.firstTimerNote
      ? `You dive with ${shop} tomorrow — here's everything you need for the day.`
      : `A quick reminder that <strong>${title}</strong> with ${shop} sails tomorrow.`;
    return {
      subject: `You sail tomorrow — ${input.tripTitle}`,
      text: `Hi ${firstName},\n\n${opener}\n\n${date}\n${time}${brief.text}${todo.text}${readyText}`,
      html: `<p>Hi ${escapeHtml(firstName)},</p><p>${openerHtml}</p><p><strong>${escapeHtml(date)}</strong><br>${escapeHtml(time)}</p>${brief.html}${todo.html}${readyHtml}`,
    };
  }

  return {
    subject: `You sail ${when} — ${input.tripTitle}`,
    text: `Hi ${firstName},\n\nA quick reminder that ${input.tripTitle} with ${input.shopName} sails ${when}.\n\n${date}\n${time}\n\nPlease be at the dock ${dock} early.${todo.text}${readyText}`,
    html: `<p>Hi ${escapeHtml(firstName)},</p><p>A quick reminder that <strong>${title}</strong> with ${shop} sails ${when}.</p><p><strong>${escapeHtml(date)}</strong><br>${escapeHtml(time)}</p><p>Please be at the dock ${dock} early.</p>${todo.html}${readyHtml}`,
  };
}

type TripRecapEmailInput = {
  diverName: string;
  shopName: string;
  tripTitle: string;
  startsAt: Date;
  timezone: string;
  /** The names of the sites dived, in order, for the recap's opening line. */
  sites?: string[];
  /** The diver's shareable recap page. */
  recapUrl: string;
};

export function tripRecapEmail(input: TripRecapEmailInput): NotificationEmail {
  const firstName = input.diverName.trim().split(/\s+/)[0] || "there";
  const date = formatShortDate(input.startsAt, "en-US", input.timezone);
  const title = escapeHtml(input.tripTitle);
  const shop = escapeHtml(input.shopName);
  const url = escapeHtml(input.recapUrl);
  const sites = (input.sites ?? []).map((site) => site.trim()).filter(Boolean);
  // Name the sites they dived when we know them — the recap is warmer when it
  // remembers the day rather than nudging generically.
  const where = sites.length
    ? ` You dived ${sites.length === 1 ? sites[0] : `${sites.slice(0, -1).join(", ")} and ${sites[sites.length - 1]}`}.`
    : "";

  return {
    subject: `Your dive with ${input.shopName} — ${input.tripTitle}`,
    text: `Hi ${firstName},\n\nThanks for diving ${input.tripTitle} with ${input.shopName} on ${date}.${where}\n\nWe put together a recap of your day — see it here:\n${input.recapUrl}\n\nIf you loved it, the best thing you can do is bring a buddy next time. See you in the water!\n`,
    html: `<p>Hi ${escapeHtml(firstName)},</p><p>Thanks for diving <strong>${title}</strong> with ${shop} on ${escapeHtml(date)}.${escapeHtml(where)}</p><p><a href="${url}">See the recap of your day</a>.</p><p>If you loved it, the best thing you can do is bring a buddy next time. See you in the water!</p>`,
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
