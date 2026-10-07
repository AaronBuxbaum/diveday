import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { formatCalendarDateRange, formatTimeZoneName } from "@/lib/format";
import { escapeHtml } from "@/lib/html";
import { firstNameOf } from "@/lib/person-name";
import { seatFillPercent } from "@/lib/weekly-digest";
import type { NotificationEmail } from "./email";
import type { WeeklyDigestEmailSection } from "./kinds";

// i18n-exempt-file: the terminal renderer for the Monday email, on the same
// footing as `./email.ts` — no React component picks words for a sent message,
// so this resolves its own text through `diverTranslator` in the recipient's
// locale. Every dynamic value is escaped for the html body.

export type WeeklyDigestEmailInput = {
  locale: DiverLocale;
  recipientName: string;
  shopName: string;
  timezone: string;
  lastWeekFrom: string;
  lastWeekTo: string;
  thisWeekFrom: string;
  thisWeekTo: string;
  sections: readonly WeeklyDigestEmailSection[];
  settingsUrl: string;
  turnOffUrl: string;
};

type Block = { heading: string; lines: string[]; url: string; linkLabel: string };

function blockFor(
  section: WeeklyDigestEmailSection,
  input: WeeklyDigestEmailInput,
  t: ReturnType<typeof diverTranslator>,
): Block {
  const k = "notifications.weeklyDigest";
  switch (section.kind) {
    case "last_week": {
      const range = formatCalendarDateRange(input.lastWeekFrom, input.lastWeekTo, input.locale);
      const lines = [t(`${k}.lastWeek.bookings`, { count: section.bookingsMade })];
      if (section.departures > 0) {
        lines.push(
          t(`${k}.lastWeek.sailed`, {
            departures: section.departures,
            filled: section.seatsFilled,
            seats: section.seats,
            percent: seatFillPercent(section.seatsFilled, section.seats) ?? 0,
          }),
        );
      }
      return {
        heading: t(`${k}.lastWeek.heading`, { range }),
        lines,
        url: section.url,
        linkLabel: t(`${k}.lastWeek.link`),
      };
    }
    case "this_week": {
      const range = formatCalendarDateRange(input.thisWeekFrom, input.thisWeekTo, input.locale);
      return {
        heading: t(`${k}.thisWeek.heading`, { range }),
        lines: [
          t(`${k}.thisWeek.board`, {
            departures: section.departures,
            filled: section.seatsFilled,
            seats: section.seats,
            percent: seatFillPercent(section.seatsFilled, section.seats) ?? 0,
          }),
        ],
        url: section.url,
        linkLabel: t(`${k}.thisWeek.link`),
      };
    }
    case "waivers":
      return {
        heading: t(`${k}.waivers.heading`),
        lines: [t(`${k}.waivers.body`, { divers: section.divers, departures: section.departures })],
        url: section.url,
        linkLabel: t(`${k}.waivers.link`),
      };
    case "reviews": {
      const lines: string[] = [];
      if (section.received > 0) {
        lines.push(t(`${k}.reviews.received`, { count: section.received }));
      }
      if (section.awaitingModeration > 0) {
        lines.push(t(`${k}.reviews.waiting`, { count: section.awaitingModeration }));
      }
      return {
        heading: t(`${k}.reviews.heading`),
        lines,
        url: section.url,
        linkLabel: t(`${k}.reviews.link`),
      };
    }
    case "date_requests":
      return {
        heading: t(`${k}.dateRequests.heading`),
        lines: [t(`${k}.dateRequests.body`, { count: section.waiting })],
        url: section.url,
        linkLabel: t(`${k}.dateRequests.link`),
      };
    case "overdue":
      return {
        heading: t(`${k}.overdue.heading`),
        lines: [t(`${k}.overdue.body`, { count: section.count })],
        url: section.url,
        linkLabel: t(`${k}.overdue.link`),
      };
  }
}

/**
 * The zone the weeks are cut in, named in full. The email holds no times, but
 * "last week" is the shop's week, and an owner reading it on a trip abroad
 * should not have to guess whose Monday it is.
 */
function zoneNote(input: WeeklyDigestEmailInput, t: ReturnType<typeof diverTranslator>): string {
  const [year, month, day] = input.thisWeekFrom.split("-").map(Number);
  // Noon UTC on the week's Monday: well inside that day in every zone, so the
  // name is the one in force this week (EDT, not EST, in October).
  const zone = formatTimeZoneName(
    input.locale,
    input.timezone,
    new Date(Date.UTC(year, month - 1, day, 12)),
  );
  return t("notifications.weeklyDigest.zoneNote", { zone });
}

const SECTION_HEADING_STYLE = "margin: 24px 0 4px; font-size: 16px; font-weight: 600;";
const SECTION_LINE_STYLE = "margin: 0;";

export function weeklyDigestEmail(input: WeeklyDigestEmailInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const firstName = firstNameOf(input.recipientName, t("notifications.common.genericName"));
  const blocks = input.sections.map((section) => blockFor(section, input, t));
  const note = zoneNote(input, t);
  const why = t("notifications.weeklyDigest.why", { shopName: input.shopName });
  const settings = t("notifications.weeklyDigest.settings");
  const turnOff = t("notifications.weeklyDigest.turnOff");

  const textBlocks = blocks
    .map((block) => [block.heading, ...block.lines, `${block.linkLabel}: ${block.url}`].join("\n"))
    .join("\n\n");
  const htmlBlocks = blocks
    .map(
      (block) =>
        `<h2 style="${SECTION_HEADING_STYLE}">${escapeHtml(block.heading)}</h2>${block.lines
          .map((line) => `<p style="${SECTION_LINE_STYLE}">${escapeHtml(line)}</p>`)
          .join(
            "",
          )}<p style="margin: 4px 0 0;"><a href="${escapeHtml(block.url)}">${escapeHtml(block.linkLabel)}</a></p>`,
    )
    .join("");

  return {
    subject: t("notifications.weeklyDigest.subject", { shopName: input.shopName }),
    text: `${t("notifications.common.greeting", { firstName })}\n\n${textBlocks}\n\n${note}\n${why}\n${settings}: ${input.settingsUrl}\n${turnOff}: ${input.turnOffUrl}\n`,
    html: `<p>${t("notifications.common.greeting", { firstName: escapeHtml(firstName) })}</p>${htmlBlocks}<p style="margin-top: 32px; font-size: 13px; line-height: 1.5; opacity: 0.75;">${escapeHtml(note)}<br>${escapeHtml(why)}<br><a href="${escapeHtml(input.settingsUrl)}">${escapeHtml(settings)}</a> · <a href="${escapeHtml(input.turnOffUrl)}">${escapeHtml(turnOff)}</a></p>`,
  };
}

/**
 * What the staff preview shows for a week the pass would not send: the same
 * document chrome, one sentence saying so.
 */
export function weeklyDigestQuietWeekEmail(input: {
  locale: DiverLocale;
  shopName: string;
}): NotificationEmail {
  const t = diverTranslator(input.locale);
  const line = t("notifications.weeklyDigest.quietWeek");
  return {
    subject: t("notifications.weeklyDigest.subject", { shopName: input.shopName }),
    text: `${line}\n`,
    html: `<p>${escapeHtml(line)}</p>`,
  };
}
