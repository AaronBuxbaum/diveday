import { diverTranslator } from "@/i18n/messages";
import type { WhatsAppReopenMessage } from "@/lib/inbox";

// i18n-exempt-file: the terminal renderer for the words DiveDay itself puts on
// a staff reply (its emailed subject, and the fixed sentences that reopen a
// WhatsApp conversation), on the same footing as `./desk-notes.ts`: resolved
// here in the diver's language. The staffer's own reply is never a template.

const REOPEN_MESSAGE_KEY = {
  answer_ready: "notifications.whatsappReopen.answerReady",
  question: "notifications.whatsappReopen.question",
  follow_up: "notifications.whatsappReopen.followUp",
} as const satisfies Record<WhatsAppReopenMessage, string>;

/** One approved reopening ask, in the diver's language. */
export function whatsAppReopenText(locale: string, message: WhatsAppReopenMessage): string {
  return diverTranslator(locale)(REOPEN_MESSAGE_KEY[message]);
}

/**
 * The subject a diver sees on an emailed reply: their own thread's, marked as
 * a reply the way every mail client marks one, or the shop's name when their
 * message carried no subject at all (a WhatsApp forwarded by a client, a mail
 * sent with an empty one). A subject line is the one string a person outside
 * the shop reads, so it is in the diver's language.
 */
export function staffReplySubject(
  locale: string,
  shopName: string,
  subject: string | null | undefined,
): string {
  const t = diverTranslator(locale);
  const trimmed = subject?.trim();
  if (!trimmed) return t("notifications.staffReply.subject", { shopName });
  // A thread already marked as a reply keeps the one marker it has: mail
  // clients strip theirs before replying for exactly this reason, and
  // "Re: Re: Re: You're booked" is what happens when nobody does.
  return /^re\s*:/i.test(trimmed)
    ? trimmed
    : t("notifications.staffReply.reSubject", { subject: trimmed });
}
