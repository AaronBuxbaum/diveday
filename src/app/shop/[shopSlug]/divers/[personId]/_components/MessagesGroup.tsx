import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions } from "@/components/ui/form";
import { InsetGroup } from "@/components/ui/ledger";
import type { ThreadEntry } from "@/db/inbound-messages";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { type InboundChannel, REPLY_BODY_MAX_LENGTH } from "@/lib/inbox";
import { sendReplyAction } from "../actions";
import { DiverFileGroupDisclosure } from "./DiverFileGroupDisclosure";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";

const CHANNEL_KEYS: Record<InboundChannel, StaffMessageKey> = {
  email: "inbox.channel.email",
  sms: "inbox.channel.sms",
  whatsapp: "inbox.channel.whatsapp",
};

/**
 * **The conversation with this diver, and the box the shop answers from** (ADR
 * 20260907-two-way-inbox).
 *
 * The thread is one ledger, oldest first, both directions in it: what they
 * wrote and what the shop wrote back. `personThread` interleaves them by time;
 * this only draws them, and never re-sorts or re-groups, so the record and the
 * inbox can never come to disagree about what was said when.
 *
 * The composer answers **the diver's most recent message**, which is what fixes
 * the channel and the thread the reply lands in — there is no channel picker,
 * because a diver who wrote from a phone is not asking to be emailed. So the
 * label carries the channel ("Write back by WhatsApp") instead of a sentence
 * under the box saying the same thing.
 *
 * It renders nothing at all for a diver who has never written: there is no
 * conversation to continue and no address the shop has been given for this
 * purpose. And on WhatsApp it renders the closed window in place of the box,
 * because Meta stops carrying typed replies a day after the diver's last
 * message — the one fact about this box a staffer would otherwise learn by
 * having a message refused.
 */
export function MessagesGroup({
  entries,
  reply,
  shopSlug,
  personId,
  locale,
  timezone,
  t,
  status,
}: {
  entries: readonly ThreadEntry[];
  /**
   * What the composer would answer: the diver's latest message, plus whether
   * the channel will still carry a typed reply. Null when they have never
   * written, which is when there is nothing to compose against.
   */
  reply: { messageId: string; channel: InboundChannel; open: boolean; diverName: string } | null;
  shopSlug: string;
  personId: string;
  locale: string;
  timezone: string;
  t: StaffTranslator;
  status?: DiverNotice;
}) {
  if (entries.length === 0 && !reply) return null;
  const waiting = entries.filter(
    (entry) => entry.direction === "inbound" && entry.message.answeredAt === null,
  ).length;
  const summary =
    entries.length === 0
      ? t("inbox.thread.none")
      : waiting > 0
        ? t("inbox.thread.summaryWaiting", { count: entries.length, waiting })
        : t("inbox.thread.summary", { count: entries.length });

  return (
    <DiverFileGroupDisclosure
      id="messages"
      label={t("inbox.thread.heading")}
      summary={summary}
      // Open when somebody is waiting on an answer, or when the last attempt
      // was refused: both are states the reader has to see to act on.
      open={waiting > 0 || Boolean(status)}
      className="mt-8"
    >
      <InsetGroup
        as="h2"
        id="messages"
        label={t("inbox.thread.heading")}
        labelClassName="max-sm:hidden"
        className="scroll-mt-24"
      >
        {entries.map((entry) =>
          entry.direction === "inbound" ? (
            <div key={entry.message.id} className="px-5 py-4 sm:px-6">
              <p className="whitespace-pre-wrap">{entry.message.body}</p>
              <p className="mt-1 text-sm text-muted">
                {t(CHANNEL_KEYS[entry.message.channel])} ·{" "}
                {formatDateTimeTz(entry.message.receivedAt, locale, timezone)}
              </p>
            </div>
          ) : (
            // The shop's own words sit on the sunken fill, so a thread reads as
            // two voices without either one needing a label saying whose it is.
            <div key={entry.reply.id} className="bg-surface-sunken px-5 py-4 sm:px-6">
              <p className="whitespace-pre-wrap">{entry.reply.body}</p>
              <p className="mt-1 text-sm text-muted">
                {t("inbox.thread.repliedBy", {
                  name: entry.sentByName ?? "",
                  date: formatDateTimeTz(entry.reply.sentAt, locale, timezone),
                })}
                {entry.reply.status === "sent" ? null : ` · ${t("inbox.thread.sendFailed")}`}
              </p>
            </div>
          ),
        )}
        {reply ? (
          <div className="px-5 py-4 sm:px-6">
            {reply.open ? (
              <form action={sendReplyAction.bind(null, shopSlug, personId)} className="grid gap-3">
                <input type="hidden" name="messageId" value={reply.messageId} />
                <Field
                  label={t("inbox.thread.replyLabel", { channel: t(CHANNEL_KEYS[reply.channel]) })}
                >
                  <textarea
                    name="reply"
                    required
                    maxLength={REPLY_BODY_MAX_LENGTH}
                    rows={3}
                    className={controlClass}
                  />
                </Field>
                <FieldActions>
                  <SubmitButton
                    pendingLabel={t("inbox.thread.sending")}
                    className={buttonClass({ variant: "secondary", size: "sm" })}
                  >
                    {t("inbox.thread.send")}
                  </SubmitButton>
                  <DiverFormStatus status={status} />
                </FieldActions>
              </form>
            ) : (
              <>
                <p className="text-sm text-muted">
                  {t("inbox.thread.windowClosed", { name: reply.diverName })}
                </p>
                <FieldActions>
                  <DiverFormStatus status={status} />
                </FieldActions>
              </>
            )}
          </div>
        ) : null}
      </InsetGroup>
    </DiverFileGroupDisclosure>
  );
}
