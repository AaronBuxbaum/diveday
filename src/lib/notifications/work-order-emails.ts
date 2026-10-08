import { customerGearDueText, customerGearPieceText } from "@/i18n/customer-gear-labels";
import { type DiverTranslator, diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { type CalendarDate, formatCalendarDate } from "@/lib/calendar-date";
import type { GearServiceKind } from "@/lib/gear";
import { escapeHtml } from "@/lib/html";
import { cachedListFormat } from "@/lib/intl-cache";
import { firstNameOf } from "@/lib/person-name";
import { shortenForText } from "@/lib/work-order-follow-up";
import type { NotificationEmail } from "./email";
import type { CustomerGearPiece } from "./kinds";

// i18n-exempt-file: the terminal renderer for the bench's two messages to a
// customer, on the same footing as `./email.ts` — no React component picks
// words for a sent message, so this resolves its own text through
// `diverTranslator` in the recipient's locale. Every dynamic value is escaped
// for the html body.

/** How much of "what we did" a text carries; the email carries all of it. */
const TEXT_WORK_PERFORMED_MAX = 240;

function piecesText(t: DiverTranslator, locale: DiverLocale, pieces: readonly CustomerGearPiece[]) {
  return cachedListFormat(locale, { style: "long", type: "conjunction" }).format(
    pieces.map((piece) => customerGearPieceText(t, piece)),
  );
}

function paragraphs(value: string): string[] {
  return value
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

export type WorkOrderReadyEmailInput = {
  locale: DiverLocale;
  diverName: string;
  shopName: string;
  pieces: readonly CustomerGearPiece[];
  workPerformed?: string;
};

/** "Your gear is ready to collect", with what the bench did to it. */
export function workOrderReadyEmail(input: WorkOrderReadyEmailInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const firstName = firstNameOf(input.diverName, t("notifications.common.genericName"));
  const ready = (shopName: string, pieces: string) =>
    input.pieces.length > 0
      ? t("notifications.workOrderReady.ready", { shopName, pieces })
      : t("notifications.workOrderReady.readyNoPieces", { shopName });
  const list = piecesText(t, input.locale, input.pieces);
  const work = input.workPerformed ? paragraphs(input.workPerformed) : [];
  const heading = t("notifications.workOrderReady.workHeading");

  const workText = work.length > 0 ? `\n\n${heading}\n${work.join("\n\n")}` : "";
  const workHtml =
    work.length > 0
      ? `<p><strong>${escapeHtml(heading)}</strong></p>${work
          .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
          .join("")}`
      : "";

  return {
    subject: t("notifications.workOrderReady.subject"),
    text: `${t("notifications.common.greeting", { firstName })}\n\n${ready(input.shopName, list)}${workText}\n`,
    html: `<p>${t("notifications.common.greeting", { firstName: escapeHtml(firstName) })}</p><p>${ready(escapeHtml(input.shopName), escapeHtml(list))}</p>${workHtml}`,
  };
}

/** The same news as a text: one line, with what was done cut to fit. */
export function workOrderReadyText(
  t: DiverTranslator,
  locale: DiverLocale,
  input: { shopName: string; pieces: readonly CustomerGearPiece[]; workPerformed?: string | null },
): string {
  const ready =
    input.pieces.length > 0
      ? t("notifications.smsWorkOrder.ready", {
          shopName: input.shopName,
          pieces: piecesText(t, locale, input.pieces),
        })
      : t("notifications.smsWorkOrder.readyNoPieces", { shopName: input.shopName });
  const work = input.workPerformed?.trim();
  return work
    ? `${ready} ${t("notifications.smsWorkOrder.work", {
        work: shortenForText(work, TEXT_WORK_PERFORMED_MAX),
      })}`
    : ready;
}

export type GearServiceDueEmailInput = {
  locale: DiverLocale;
  diverName: string;
  shopName: string;
  piece: CustomerGearPiece;
  clock: GearServiceKind;
  dueOn: string;
  unsubscribeUrl: string;
};

/** A customer piece coming due, a month out, with the courtesy way out. */
export function gearServiceDueEmail(input: GearServiceDueEmailInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const firstName = firstNameOf(input.diverName, t("notifications.common.genericName"));
  // A calendar date with no instant in it: formatted through UTC so the day
  // never shifts (`formatCalendarDate`).
  const date = formatCalendarDate(input.dueOn as CalendarDate, input.locale);
  const piece = customerGearPieceText(t, input.piece);
  const due = customerGearDueText(t, { clock: input.clock, piece, date });
  const dueHtml = customerGearDueText(t, {
    clock: input.clock,
    piece: escapeHtml(piece),
    date: escapeHtml(date),
  });
  const dropBy = t("notifications.gearServiceDue.dropBy", { shopName: input.shopName });
  const dropByHtml = t("notifications.gearServiceDue.dropBy", {
    shopName: escapeHtml(input.shopName),
  });
  const unsubscribe = t("notifications.common.courtesyUnsubscribe", { shopName: input.shopName });

  return {
    subject: t("notifications.gearServiceDue.subject", { shopName: input.shopName }),
    text: `${t("notifications.common.greeting", { firstName })}\n\n${due} ${dropBy}\n\n${unsubscribe}:\n${input.unsubscribeUrl}\n`,
    html: `<p>${t("notifications.common.greeting", { firstName: escapeHtml(firstName) })}</p><p>${dueHtml} ${dropByHtml}</p><p><a href="${escapeHtml(input.unsubscribeUrl)}">${escapeHtml(unsubscribe)}</a></p>`,
  };
}

/** The reminder as a text. */
export function gearServiceDueText(
  t: DiverTranslator,
  locale: DiverLocale,
  input: { shopName: string; piece: CustomerGearPiece; clock: GearServiceKind; dueOn: string },
): string {
  const due = customerGearDueText(t, {
    clock: input.clock,
    piece: customerGearPieceText(t, input.piece),
    date: formatCalendarDate(input.dueOn as CalendarDate, locale),
  });
  return `${input.shopName}: ${due} ${t("notifications.gearServiceDue.dropBySms")}`;
}
