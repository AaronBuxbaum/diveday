import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import {
  formatCalendarDateRange,
  formatDateTimeTz,
  formatMoneyCents,
  formatTimeZoneName,
  formatWeekdayTime,
} from "@/lib/format";
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
  /** The producer’s report clock; absent only on an already queued payload. */
  preparedAt?: string;
  lastWeekFrom: string;
  lastWeekTo: string;
  thisWeekFrom: string;
  thisWeekTo: string;
  sections: readonly WeeklyDigestEmailSection[];
  /** The `monday` assist's sentences, each naming the section it links to. */
  read?: readonly { section: string; text: string }[];
  settingsUrl: string;
  turnOffUrl: string;
};

/** A line that carries its own link: "… has 1 of 8 booked. Send a last-minute deal". */
type Action = { text: string; label: string; url: string };

type Block = {
  heading: string;
  lines: string[];
  action?: Action;
  url: string;
  linkLabel: string;
};

function blockFor(
  section: WeeklyDigestEmailSection,
  input: WeeklyDigestEmailInput,
  t: ReturnType<typeof diverTranslator>,
): Block {
  switch (section.kind) {
    case "last_week": {
      const range = formatCalendarDateRange(input.lastWeekFrom, input.lastWeekTo, input.locale);
      const lines = [
        t("notifications.weeklyDigest.lastWeek.bookings", { count: section.bookingsMade }),
      ];
      if (section.departures > 0) {
        lines.push(
          t("notifications.weeklyDigest.lastWeek.sailed", {
            departures: section.departures,
            filled: section.seatsFilled,
            seats: section.seats,
            percent: seatFillPercent(section.seatsFilled, section.seats) ?? 0,
          }),
        );
      }
      return {
        heading: t("notifications.weeklyDigest.lastWeek.heading", { range }),
        lines,
        url: section.url,
        linkLabel: t("notifications.weeklyDigest.lastWeek.link"),
      };
    }
    case "money": {
      const money = (cents: number) => formatMoneyCents(cents, section.currency, input.locale);
      const lines: string[] = [];
      // Against the same week last year once there is one (fifth loop, item
      // 29): "$630 more than the same week last year".
      const lastYear = section.lastYearRevenueCents ?? null;
      if (section.revenueCents > 0 && lastYear !== null && lastYear > 0) {
        const diff = section.revenueCents - lastYear;
        lines.push(
          t("notifications.weeklyDigest.money.tookVsLastYear", {
            amount: money(section.revenueCents),
            diff: money(Math.abs(diff)),
            direction: diff > 0 ? "more" : diff < 0 ? "less" : "same",
          }),
        );
      } else if (section.revenueCents > 0) {
        lines.push(
          t("notifications.weeklyDigest.money.took", { amount: money(section.revenueCents) }),
        );
      }
      if (section.tipsCents > 0) {
        lines.push(
          t("notifications.weeklyDigest.money.tips", { amount: money(section.tipsCents) }),
        );
      }
      // "Owed": the Orders page's line, in the email (fourth UX review, item 23).
      const { owed } = section;
      if (owed.orderCents > 0) {
        lines.push(
          t("notifications.weeklyDigest.money.owedOrders", {
            amount: money(owed.orderCents),
            count: owed.orderCount,
          }),
        );
      }
      if (owed.seatCents > 0) {
        lines.push(
          t("notifications.weeklyDigest.money.owedSeats", {
            amount: money(owed.seatCents),
            count: owed.seatCount,
          }),
        );
      }
      return {
        heading: t("notifications.weeklyDigest.money.heading"),
        lines,
        url: section.url,
        linkLabel: t("notifications.weeklyDigest.money.link"),
      };
    }
    case "this_week": {
      const range = formatCalendarDateRange(input.thisWeekFrom, input.thisWeekTo, input.locale);
      return {
        heading: t("notifications.weeklyDigest.thisWeek.heading", { range }),
        lines: [
          t("notifications.weeklyDigest.thisWeek.board", {
            departures: section.departures,
            filled: section.seatsFilled,
            seats: section.seats,
            percent: seatFillPercent(section.seatsFilled, section.seats) ?? 0,
          }),
        ],
        // The emptiest boat no deal has gone out for (fifth loop, item 29).
        action: section.weakest
          ? {
              text: t("notifications.weeklyDigest.thisWeek.weakest", {
                when: formatWeekdayTime(section.weakest.startsAt, input.locale, input.timezone),
                title: section.weakest.title,
                booked: section.weakest.booked,
                capacity: section.weakest.capacity,
              }),
              label: t("notifications.weeklyDigest.thisWeek.dealLink"),
              url: section.weakest.url,
            }
          : undefined,
        url: section.url,
        linkLabel: t("notifications.weeklyDigest.thisWeek.link"),
      };
    }
    case "waivers":
      return {
        heading: t("notifications.weeklyDigest.waivers.heading"),
        lines: [
          t("notifications.weeklyDigest.waivers.body", {
            divers: section.divers,
            departures: section.departures,
          }),
        ],
        url: section.url,
        linkLabel: t("notifications.weeklyDigest.waivers.link"),
      };
    case "reviews": {
      const lines: string[] = [];
      if (section.received > 0) {
        lines.push(t("notifications.weeklyDigest.reviews.received", { count: section.received }));
      }
      if (section.awaitingModeration > 0) {
        lines.push(
          t("notifications.weeklyDigest.reviews.waiting", { count: section.awaitingModeration }),
        );
      }
      return {
        heading: t("notifications.weeklyDigest.reviews.heading"),
        lines,
        url: section.url,
        linkLabel: t("notifications.weeklyDigest.reviews.link"),
      };
    }
    case "date_requests":
      return {
        heading: t("notifications.weeklyDigest.dateRequests.heading"),
        lines: [t("notifications.weeklyDigest.dateRequests.body", { count: section.waiting })],
        url: section.url,
        linkLabel: t("notifications.weeklyDigest.dateRequests.link"),
      };
    case "overdue":
      return {
        heading: t("notifications.weeklyDigest.overdue.heading"),
        lines: [t("notifications.weeklyDigest.overdue.body", { count: section.count })],
        url: section.url,
        linkLabel: t("notifications.weeklyDigest.overdue.link"),
      };
    // The owner's safety sentence and gear line (fourth UX review, item 24).
    case "safety": {
      const lines: string[] = [];
      if (section.openRollCalls > 0) {
        lines.push(
          t("notifications.weeklyDigest.safety.rollCalls", { count: section.openRollCalls }),
        );
      }
      if (section.uncrewed > 0) {
        lines.push(t("notifications.weeklyDigest.safety.uncrewed", { count: section.uncrewed }));
      }
      if (section.incidents > 0) {
        lines.push(t("notifications.weeklyDigest.safety.incidents", { count: section.incidents }));
      }
      return {
        heading: t("notifications.weeklyDigest.safety.heading"),
        lines,
        url: section.url,
        linkLabel: t("notifications.weeklyDigest.safety.link"),
      };
    }
    // Every emergency read of a medical alert last week (issue #2990): how
    // many, who opened how many, then who, whose, when and the departure, in
    // the shop's zone, for the first of them, and how many more. A blank name
    // is said as "a diver", "a staffer" or "a departure". Never the words.
    case "emergency_reads": {
      const reader = (name: string | null) =>
        name ?? t("notifications.weeklyDigest.emergencyReads.unnamedReader");
      const more = section.total - section.reads.length;
      return {
        heading: t("notifications.weeklyDigest.emergencyReads.heading"),
        lines: [
          t("notifications.weeklyDigest.emergencyReads.total", { count: section.total }),
          ...section.byReader.map((entry) =>
            t("notifications.weeklyDigest.emergencyReads.byReader", {
              count: entry.count,
              reader: reader(entry.reader),
            }),
          ),
          ...section.reads.map((read) =>
            t("notifications.weeklyDigest.emergencyReads.line", {
              reader: reader(read.reader),
              diver: read.diver ?? t("notifications.weeklyDigest.emergencyReads.unnamedDiver"),
              when: formatWeekdayTime(read.at, input.locale, input.timezone),
              departure:
                read.departureTitle ??
                t("notifications.weeklyDigest.emergencyReads.unnamedDeparture"),
              departureWhen: formatWeekdayTime(
                read.departureStartsAt,
                input.locale,
                input.timezone,
              ),
            }),
          ),
          ...(more > 0
            ? [t("notifications.weeklyDigest.emergencyReads.more", { count: more })]
            : []),
        ],
        url: section.url,
        linkLabel: t("notifications.weeklyDigest.emergencyReads.link"),
      };
    }
    case "gear_service":
      return {
        heading: t("notifications.weeklyDigest.gearService.heading"),
        lines: [t("notifications.weeklyDigest.gearService.body", { count: section.due })],
        url: section.url,
        linkLabel: t("notifications.weeklyDigest.gearService.link"),
      };
  }
}

/**
 * The zone the weeks are cut in, named in full. "Last week" is the shop's
 * week, and the few times the email holds (the weakest boat, an emergency
 * read) are the shop's clock, so an owner reading it on a trip abroad should
 * not have to guess whose Monday it is.
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
  const entries = input.sections.map((section) => ({
    section,
    block: blockFor(section, input, t),
  }));
  const attention = entries.filter(
    ({ section }) => section.kind === "safety" && section.openRollCalls > 0,
  );
  const reporting = entries.filter((entry) => !attention.includes(entry));
  const blocks = entries.map(({ block }) => block);
  // Each sentence links to the section whose numbers it quotes; one whose
  // section is not in this email (another grade's) is not printed.
  const read = (input.read ?? []).flatMap((sentence) => {
    const at = input.sections.findIndex((section) => section.kind === sentence.section);
    const block = blocks[at];
    return block ? [{ text: sentence.text, url: block.url, label: block.linkLabel }] : [];
  });
  const readText = read.map((line) => `${line.text} ${line.label}: ${line.url}`).join("\n");
  const readHtml = read
    .map(
      (line) =>
        `<p style="${SECTION_LINE_STYLE}">${escapeHtml(line.text)} <a href="${escapeHtml(line.url)}">${escapeHtml(line.label)}</a></p>`,
    )
    .join("");
  const note = zoneNote(input, t);
  const prepared = input.preparedAt
    ? t("notifications.weeklyDigest.preparedAt", {
        at: formatDateTimeTz(new Date(input.preparedAt), input.locale, input.timezone),
      })
    : "";
  const why = t("notifications.weeklyDigest.why", { shopName: input.shopName });
  const settings = t("notifications.weeklyDigest.settings");
  const turnOff = t("notifications.weeklyDigest.turnOff");

  const renderTextBlocks = (items: Block[]) =>
    items
      .map((block) =>
        [
          block.heading,
          ...block.lines,
          ...(block.action
            ? [`${block.action.text} ${block.action.label}: ${block.action.url}`]
            : []),
          `${block.linkLabel}: ${block.url}`,
        ].join("\n"),
      )
      .join("\n\n");
  const actionHtml = (action: Action | undefined) =>
    action
      ? `<p style="${SECTION_LINE_STYLE}">${escapeHtml(action.text)} <a href="${escapeHtml(action.url)}">${escapeHtml(action.label)}</a></p>`
      : "";
  const renderHtmlBlocks = (items: Block[]) =>
    items
      .map(
        (block) =>
          `<h2 style="${SECTION_HEADING_STYLE}">${escapeHtml(block.heading)}</h2>${block.lines
            .map((line) => `<p style="${SECTION_LINE_STYLE}">${escapeHtml(line)}</p>`)
            .join(
              "",
            )}${actionHtml(block.action)}<p style="margin: 4px 0 0;"><a href="${escapeHtml(block.url)}">${escapeHtml(block.linkLabel)}</a></p>`,
      )
      .join("");

  const attentionBlocks = attention.map(({ block }) => ({
    ...block,
    heading: t("notifications.weeklyDigest.needsAttention"),
  }));
  const reportingBlocks = reporting.map(({ block }) => block);
  const attentionText = renderTextBlocks(attentionBlocks);
  const attentionHtml = renderHtmlBlocks(attentionBlocks);
  const textBlocks = renderTextBlocks(reportingBlocks);
  const htmlBlocks = renderHtmlBlocks(reportingBlocks);
  return {
    subject: t("notifications.weeklyDigest.subject", { shopName: input.shopName }),
    text: `${t("notifications.common.greeting", { firstName })}\n\n${prepared ? `${prepared}\n\n` : ""}${attentionText ? `${attentionText}\n\n` : ""}${readText ? `${readText}\n\n` : ""}${textBlocks}\n\n${note}\n${why}\n${settings}: ${input.settingsUrl}\n${turnOff}: ${input.turnOffUrl}\n`,
    html: `<p>${t("notifications.common.greeting", { firstName: escapeHtml(firstName) })}</p>${prepared ? `<p>${escapeHtml(prepared)}</p>` : ""}${attentionHtml}${readHtml}${htmlBlocks}<p style="margin-top: 32px; font-size: 13px; line-height: 1.5; opacity: 0.75;">${escapeHtml(note)}<br>${escapeHtml(why)}<br><a href="${escapeHtml(input.settingsUrl)}">${escapeHtml(settings)}</a> · <a href="${escapeHtml(input.turnOffUrl)}">${escapeHtml(turnOff)}</a></p>`,
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
