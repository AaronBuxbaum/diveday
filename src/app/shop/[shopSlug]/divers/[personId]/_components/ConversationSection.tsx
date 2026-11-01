import { AssistDraftButton } from "@/components/assists/AssistDraftButton";
import { languageName } from "@/components/assists/language-name";
import { TranslateReplyButton } from "@/components/assists/TranslateReplyButton";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { Field, FieldActions, textareaClassFor } from "@/components/ui/form";
import { InsetGroup } from "@/components/ui/ledger";
import type { ThreadEntry } from "@/db/inbound-messages";
import { diverTranslator } from "@/i18n/messages";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import {
  inboxMessageAnchor,
  REPLY_BODY_MAX_LENGTH,
  replyDestination,
  WHATSAPP_REOPEN_MESSAGES,
  type WhatsAppReopenMessage,
  whatsAppReopenSentAt,
  whatsAppReplyWindowOpen,
} from "@/lib/inbox";
import { reopenWhatsAppAction, replyToDiverAction } from "../details-actions";
import { DiverFileGroupDisclosure } from "./DiverFileGroupDisclosure";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";

/** Where each approved ask's words live in the diver bundle. */
const REOPEN_MESSAGE_KEY = {
  answer_ready: "notifications.whatsappReopen.answerReady",
  question: "notifications.whatsappReopen.question",
  follow_up: "notifications.whatsappReopen.followUp",
} as const satisfies Record<WhatsAppReopenMessage, string>;

/** The reply box's id, for the assists that fill it. */
const REPLY_FIELD_ID = "reply-body";

/**
 * What Claude adds to the conversation when the shop's assists are on (ADR
 * 20261018-claude-assists). Absent, the section is exactly what it was.
 */
export type ConversationAssist = {
  /** Drafts a reply to the latest message (`inbox-draft`). */
  draft: () => Promise<string | null>;
  /** Translates the reply into the diver's language, when they write in another one. */
  translate: ((text: string) => Promise<string | null>) | null;
  /** The diver's language in the reader's words, for the Translate button. */
  diverLanguage: string | null;
  /** Reads the latest message into a booking request (`request`). */
  requestAction: (formData: FormData) => Promise<void>;
};

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
 * shop knows reaches them. Outside Meta's 24-hour window it is replaced by
 * why (a WhatsApp business account may not open a conversation with free text,
 * and a composer that took the words and refused them afterwards would be
 * worse than not offering them) and by what to do instead: the approved asks
 * that bring the diver back, each button reading the words the diver gets.
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
  assist,
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
  assist?: ConversationAssist;
}) {
  if (entries.length === 0) return null;

  const inbound = entries.filter((entry) => entry.direction === "inbound");
  const unanswered = inbound.filter((entry) => entry.message.answeredAt === null).length;
  // An "Ask to move" from the booking page (H-20261014-ask-to-move) sits in the thread but is
  // nothing to answer *on*: the composer answers the last thing they wrote.
  const latest = inbound.filter((entry) => entry.message.channel !== "page").at(-1);
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
  const reopenSentAt = closedWhatsApp
    ? whatsAppReopenSentAt(
        latestWhatsApp?.message.receivedAt ?? null,
        entries.flatMap((entry) =>
          entry.direction === "outbound" &&
          entry.reply.channel === "whatsapp" &&
          entry.reply.status === "sent"
            ? [entry.reply.sentAt]
            : [],
        ),
      )
    : null;
  // The asks read in the staffer's language; the diver gets the same sentence
  // in theirs.
  const reopenWords = diverTranslator(locale);

  return (
    <DiverFileGroupDisclosure
      id="conversation"
      label={t("inbox.thread.heading")}
      // A diver waiting on an answer is the fact worth the door; the tally is
      // what is left to say once nobody is.
      summary={
        unanswered > 0
          ? t("divers.file.conversationUnanswered", { count: unanswered })
          : t("inbox.thread.summary", { count: entries.length })
      }
      open={Boolean(status) || unanswered > 0}
    >
      <InsetGroup>
        {entries.map((entry) => {
          const key = entry.direction === "inbound" ? entry.message.id : `reply-${entry.reply.id}`;
          const meta =
            entry.direction === "inbound"
              ? t(
                  // An "Ask to move" (H-20261014-ask-to-move) is a button, not words: the
                  // line says what was asked, and a note follows if any.
                  entry.message.channel === "page"
                    ? "inbox.thread.askedToMove"
                    : "inbox.thread.received",
                  {
                    name: diverName,
                    date: formatDateTimeTz(entry.message.receivedAt, locale, timezone),
                  },
                )
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
          // Claude's translation sits under the diver's own words, never in
          // place of them, and only while the shop's assists are on.
          const translation =
            assist && entry.direction === "inbound" ? entry.message.assistTranslation : null;
          const translatedFrom =
            translation && entry.direction === "inbound"
              ? languageName(entry.message.assistLanguage, locale)
              : null;
          return (
            // An inbound message answers to its own fragment, so the inbox's
            // door lands on it (`inboxMessageAnchor`) rather than on the top
            // of a long conversation.
            <div
              key={key}
              id={entry.direction === "inbound" ? inboxMessageAnchor(entry.message.id) : undefined}
              className="scroll-mt-24 px-5 py-4 sm:px-6"
            >
              <p className="text-sm text-muted">{meta}</p>
              {/* Their words and the shop's, as typed. */}
              {body.trim() ? (
                <p
                  className={`mt-1 whitespace-pre-wrap ${entry.direction === "outbound" ? "text-muted" : ""}`.trim()}
                >
                  {body}
                </p>
              ) : null}
              {translation && translatedFrom ? (
                <div className="mt-2 border-s-2 border-border ps-3">
                  <p className="text-sm text-muted">
                    {t("assistsFront.conversation.translatedFrom", { language: translatedFrom })}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap">{translation}</p>
                </div>
              ) : null}
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
                    address: replyDestination(
                      replyTo.message.channel === "whatsapp" ? "whatsapp" : "email",
                      replyTo.message.fromAddress,
                    ),
                  },
                )}
              >
                <textarea
                  id={REPLY_FIELD_ID}
                  name="body"
                  required
                  rows={4}
                  maxLength={REPLY_BODY_MAX_LENGTH}
                  placeholder={t("inbox.reply.placeholder")}
                  className={textareaClassFor(4)}
                />
              </Field>
              {assist ? (
                <div className="flex flex-wrap items-center gap-2">
                  <AssistDraftButton
                    draft={assist.draft}
                    fieldId={REPLY_FIELD_ID}
                    label={t("assistsFront.conversation.draft")}
                    pendingLabel={t("assistsFront.conversation.drafting")}
                    emptyLabel={t("deskAssists.nothing")}
                  />
                  {assist.translate && assist.diverLanguage ? (
                    <TranslateReplyButton
                      fieldId={REPLY_FIELD_ID}
                      translate={assist.translate}
                      label={t("assistsFront.conversation.translate", {
                        language: assist.diverLanguage,
                      })}
                      pendingLabel={t("assistsFront.conversation.translating")}
                      yourWords={t.raw("assistsFront.conversation.yourWords")}
                    />
                  ) : null}
                </div>
              ) : null}
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
          ) : closedWhatsApp && latest ? (
            <div className="grid gap-3">
              {reopenSentAt ? (
                <p className="text-sm">
                  {t("inbox.reply.reopenSent", {
                    name: diverName,
                    date: formatDateTimeTz(reopenSentAt, locale, timezone),
                  })}
                </p>
              ) : (
                <form
                  action={reopenWhatsAppAction.bind(null, shopSlug, personId)}
                  className="grid gap-2"
                >
                  <input type="hidden" name="messageId" value={latest.message.id} />
                  <p className="text-sm text-muted">
                    {t("inbox.reply.windowClosed", { name: diverName })}
                  </p>
                  {WHATSAPP_REOPEN_MESSAGES.map((message) => (
                    <SubmitButton
                      key={message}
                      name="message"
                      value={message}
                      pendingLabel={t("inbox.reply.sending")}
                      className={buttonClass({
                        variant: "secondary",
                        size: "sm",
                        className: "justify-self-start text-start",
                      })}
                    >
                      {reopenWords(REOPEN_MESSAGE_KEY[message])}
                    </SubmitButton>
                  ))}
                </form>
              )}
            </div>
          ) : null}
          {/* A booking ask in the latest message, read into the call form for
              a staffer to check: the request is recorded there, not here. */}
          {assist && latest && !removed ? (
            <form action={assist.requestAction} className="mt-3">
              <input type="hidden" name="messageId" value={latest.message.id} />
              <input type="hidden" name="returnPersonId" value={personId} />
              <SubmitButton
                pendingLabel={t("assistsFront.inbox.makingRequest")}
                className={buttonClass({ variant: "ghost", size: "sm" })}
              >
                {t("assistsFront.inbox.makeRequest")}
              </SubmitButton>
            </form>
          ) : null}
          <FieldActions>
            <DiverFormStatus status={status} />
          </FieldActions>
        </div>
      </InsetGroup>
    </DiverFileGroupDisclosure>
  );
}
