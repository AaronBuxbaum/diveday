import { type DiverTranslator, diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import type { CrewNoticeChange } from "@/lib/crew-notices";
import { formatDateTimeTz } from "@/lib/format";
import { escapeHtml } from "@/lib/html";
import { firstNameOf } from "@/lib/person-name";
import { emailButton, type NotificationEmail } from "./email";

// i18n-exempt-file: the terminal renderer for the crew's schedule message, on
// the same footing as `./email.ts` — no React component picks words for a sent
// message, so this resolves its own text through `diverTranslator` in the
// recipient's locale. Every dynamic value is escaped for the html body.

export type CrewScheduleChangeEmailInput = {
  locale: DiverLocale;
  recipientName: string;
  shopName: string;
  timezone: string;
  changes: readonly {
    change: CrewNoticeChange;
    tripTitle: string;
    startsAt: Date;
    tripUrl: string;
  }[];
};

const LINE_KEY = {
  assigned: "notifications.crewSchedule.assigned",
  removed: "notifications.crewSchedule.removed",
  request_approved: "notifications.crewSchedule.approved",
  request_declined: "notifications.crewSchedule.declined",
} as const satisfies Record<CrewNoticeChange, string>;

const SUBJECT_KEY = {
  assigned: "notifications.crewSchedule.subjectAssigned",
  removed: "notifications.crewSchedule.subjectRemoved",
  request_approved: "notifications.crewSchedule.subjectApproved",
  request_declined: "notifications.crewSchedule.subjectDeclined",
} as const satisfies Record<CrewNoticeChange, string>;

function line(
  t: DiverTranslator,
  change: CrewNoticeChange,
  values: { tripTitle: string; when: string },
): string {
  return t(LINE_KEY[change], values);
}

/**
 * One message for everything that settled: a single change reads as that
 * change, subject and all; several read as one list, each line its own link.
 */
export function crewScheduleChangeEmail(input: CrewScheduleChangeEmailInput): NotificationEmail {
  const t = diverTranslator(input.locale);
  const firstName = firstNameOf(input.recipientName, t("notifications.common.genericName"));
  const greetingText = t("notifications.common.greeting", { firstName });
  const greetingHtml = t("notifications.common.greeting", { firstName: escapeHtml(firstName) });
  const open = t("notifications.crewSchedule.open");
  const lines = input.changes.map((entry) => {
    const when = formatDateTimeTz(entry.startsAt, input.locale, input.timezone);
    return {
      text: line(t, entry.change, { tripTitle: entry.tripTitle, when }),
      html: line(t, entry.change, {
        tripTitle: `<strong>${escapeHtml(entry.tripTitle)}</strong>`,
        when: escapeHtml(when),
      }),
      subject: t(SUBJECT_KEY[entry.change], { tripTitle: entry.tripTitle, when }),
      url: entry.tripUrl,
    };
  });

  const [only] = lines;
  if (lines.length === 1 && only) {
    return {
      subject: only.subject,
      text: `${greetingText}\n\n${only.text}\n\n${open}:\n${only.url}\n`,
      html: `<p>${greetingHtml}</p><p>${only.html}</p>${emailButton(only.url, open)}`,
    };
  }

  const intro = t("notifications.crewSchedule.intro", { shopName: input.shopName });
  const introHtml = t("notifications.crewSchedule.intro", {
    shopName: escapeHtml(input.shopName),
  });
  return {
    subject: t("notifications.crewSchedule.subjectMany", { shopName: input.shopName }),
    text: `${greetingText}\n\n${intro}\n${lines.map((entry) => `- ${entry.text}\n  ${entry.url}`).join("\n")}\n`,
    html: `<p>${greetingHtml}</p><p>${introHtml}</p><ul>${lines
      .map(
        (entry) =>
          `<li>${entry.html} <a href="${escapeHtml(entry.url)}">${escapeHtml(open)}</a></li>`,
      )
      .join("")}</ul>`,
  };
}
