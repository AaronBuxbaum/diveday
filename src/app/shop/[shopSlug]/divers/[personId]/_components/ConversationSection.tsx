import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions } from "@/components/ui/form";
import { InsetGroup } from "@/components/ui/ledger";
import type { ThreadEntry } from "@/db/inbound-messages";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { REPLY_BODY_MAX_LENGTH, replyDestination, whatsAppReplyWindowOpen } from "@/lib/inbox";
import { replyToDiverAction } from "../actions";
import { DiverFileGroupDisclosure } from "./DiverFileGroupDisclosure";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";

/**
 * **The conversation** — what this diver wrote to the shop and what the shop
 * wrote back, in one column, oldest first (ADR 20260907-two-way-inbox).
 *
 * It renders **nothing at all** for a diver who has never written, which is
 * most of them: an empty "Conversation" group on every record would be a
 * heading over a fact the record does not have. That is the same rule the
 * status ledger keeps two sections above it.
 *
 * The composer answers **the diver's latest message**, in the channel it came
 * on, because that is the thread the answer belongs to and the address the
 * shop knows reaches them. Outside Meta's 24-hour window it is replaced by the
 * one sentence that explains why: a WhatsApp business account may not open a
 * conversation with free text, and a composer that took the words and refused
 * them afterwards would be worse than not offering them.
 */
export function ConversationSection({
  entries,
  diverName,
  shopSlug,
  personId,
  locale,
  timezone,
  now,
  removed,
  t,
  status,
}: {
  entries: ThreadEntry[];
  diverName: string;
  shopSlug: string;
  personId: string;
  locale: string;
  timezone: string;
  now: Date;
  /**
   * A removed diver's record stays readable, and their thread with it —
   * deleting is soft, and the history is the point. But `sendStaffReply`
   * refuses to write to a removed record, so the composer is absent rather
   * than taking a staffer's words and refusing them afterwards.
   */
  removed: boolean;
  t: StaffTranslator;
  status?: DiverNotice;
}) {
  if (entries.length === 0) return null;

  const inbound = entries.filter((entry) => entry.direction === "inbound");
  const latest = inbound.at(-1);
  const latestWhatsApp = inbound.filter((entry) => entry.message.channel === "whatsapp").at(-1);
  // A typed WhatsApp reply is only accepted for 24 hours after the diver's own
  // last WhatsApp message — measured from that message, not from the one being
  // answered, which may be older.
  const whatsAppOpen = whatsAppReplyWindowOpen(latestWhatsApp?.message.receivedAt ?? null, now);
  // Named positively, over the channels that can actually be answered. The
  // previous form was "not whatsapp, or whatsapp with an open window", which
  // let SMS through — and SMS then fell to the `else` of the label ternary
  // below and announced itself as email. Answerability and the label now come
  // from the same fact.
  const answerable =
    !removed &&
    (latest?.message.channel === "email" ||
      (latest?.message.channel === "whatsapp" && whatsAppOpen));
  const replyTo = answerable ? latest : undefined;
  // Nothing to answer *on*: SMS is recorded and cannot be answered yet, and a
  // closed WhatsApp window is the case worth a sentence.
  const closedWhatsApp = Boolean(latest && latest.message.channel === "whatsapp" && !whatsAppOpen);

  return (
    <DiverFileGroupDisclosure
      id="conversation"
      label={t("inbox.thread.heading")}
      summary={t("inbox.thread.summary", { count: entries.length })}
      open={Boolean(status) || inbound.some((entry) => entry.message.answeredAt === null)}
      className="mt-8"
    >
      <InsetGroup
        as="h2"
        id="conversation"
        label={t("inbox.thread.heading")}
        labelClassName="max-sm:hidden"
        className="scroll-mt-24"
      >
        {entries.map((entry) => {
          const key = entry.direction === "inbound" ? entry.message.id : `reply-${entry.reply.id}`;
          const meta =
            entry.direction === "inbound"
              ? t("inbox.thread.received", {
                  name: diverName,
                  date: formatDateTimeTz(entry.message.receivedAt, locale, timezone),
                })
              : // A reply with no staffer behind it is one DiveDay sent on the
                // shop's behalf — a reply-keyword confirmation (ADR
                // 20260909-reply-keywords). Named as that rather than as
                // "a staff member", which would put a colleague's shape on a
                // sentence nobody typed.
                entry.reply.sentByPersonId === null
                ? t("inbox.thread.sentAutomatically", {
                    date: formatDateTimeTz(entry.reply.sentAt, locale, timezone),
                  })
                : t("inbox.thread.sent", {
                    name: entry.sentByName ?? t("inbox.thread.unknownStaff"),
                    date: formatDateTimeTz(entry.reply.sentAt, locale, timezone),
                  });
          const body = entry.direction === "inbound" ? entry.message.body : entry.reply.body;
          return (
            <div key={key} className="px-5 py-4 sm:px-6">
              <p className="text-sm text-muted">{meta}</p>
              {/* Their words and the shop's, as typed. */}
              <p
                className={`mt-1 whitespace-pre-wrap ${entry.direction === "outbound" ? "text-muted" : ""}`.trim()}
              >
                {body}
              </p>
              {entry.direction === "outbound" && entry.reply.status !== "sent" ? (
                <p className="mt-1 text-sm text-danger">{t("inbox.thread.sendFailed")}</p>
              ) : null}
            </div>
          );
        })}
        <div className="px-5 py-4 sm:px-6">
          {replyTo ? (
            <form action={replyToDiverAction.bind(null, shopSlug, personId)} className="grid gap-3">
              <input type="hidden" name="messageId" value={replyTo.message.id} />
              <Field
                label={t(
                  replyTo.message.channel === "whatsapp"
                    ? "inbox.reply.whatsapp"
                    : "inbox.reply.email",
                  {
                    address: replyDestination(replyTo.message.channel, replyTo.message.fromAddress),
                  },
                )}
              >
                <textarea
                  name="body"
                  required
                  rows={4}
                  maxLength={REPLY_BODY_MAX_LENGTH}
                  placeholder={t("inbox.reply.placeholder")}
                  className={controlClass}
                />
              </Field>
              <SubmitButton
                pendingLabel={t("inbox.reply.sending")}
                className={buttonClass({
                  variant: "secondary",
                  size: "sm",
                  className: "justify-self-start",
                })}
              >
                {t("inbox.reply.send")}
              </SubmitButton>
            </form>
          ) : removed ? (
            // Before the WhatsApp arm on purpose: a removed diver on a stale
            // thread gets the removal sentence, which is the truer of the two.
            <p className="text-sm text-muted">{t("inbox.reply.diverRemoved")}</p>
          ) : closedWhatsApp ? (
            <p className="text-sm text-muted">{t("inbox.reply.windowClosed")}</p>
          ) : null}
          <FieldActions>
            <DiverFormStatus status={status} />
          </FieldActions>
        </div>
      </InsetGroup>
    </DiverFileGroupDisclosure>
  );
}
