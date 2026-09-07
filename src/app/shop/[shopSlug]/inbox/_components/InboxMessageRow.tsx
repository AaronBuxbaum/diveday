import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { LedgerRow } from "@/components/ui/ledger";
import type { InboxRow } from "@/db/inbound-messages";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import type { InboundChannel } from "@/lib/inbox";
import { shopPath } from "@/lib/staff-notices";
import { deleteMessageAction, markAnsweredAction } from "../actions";

/**
 * The channel a message arrived on, in staff words. `src/db` returns the code
 * and this picks the word (ADR 20260731-domain-layer-copy-leaks).
 */
export const CHANNEL_KEYS: Record<InboundChannel, StaffMessageKey> = {
  email: "inbox.channel.email",
  sms: "inbox.channel.sms",
  whatsapp: "inbox.channel.whatsapp",
};

/** How much of a message the list shows before the record's thread takes over. */
const EXCERPT_LENGTH = 240;

/**
 * **One inbound message, as a ledger row** (ADR 20260907-two-way-inbox).
 *
 * The row is a **door to the diver's record**, because that is where the shop
 * answers — the thread and the composer live with the person, not in a second
 * reply box on a list. A message whose sender matched nobody has no record to
 * open and therefore no door: the address is not one this shop holds, and the
 * row says so in place of a name rather than inventing a destination.
 *
 * Two acts stay on the row because neither is answering. "Mark answered" is the
 * shop saying it was handled by phone or at the counter — `answered_at` is the
 * inbox's one state, and a reply is only one of the things that sets it. Delete
 * is soft, and the word on screen is Delete (ADR 20260820-every-delete-is-soft).
 *
 * The body is clamped rather than cut in the query: the whole message is on the
 * record, and a list is where a staffer decides which one to open.
 */
export function InboxMessageRow({
  row,
  shopSlug,
  locale,
  timezone,
  t,
}: {
  row: InboxRow;
  shopSlug: string;
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  const { message, personName } = row;
  const channel = t(CHANNEL_KEYS[message.channel]);
  const sender = personName ?? t("inbox.unknownSender");
  const excerpt =
    message.body.length > EXCERPT_LENGTH
      ? `${message.body.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…`
      : message.body;

  const body = (
    <>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{sender}</span>
        <span className="text-sm text-muted">
          {formatDateTimeTz(message.receivedAt, locale, timezone)}
        </span>
      </p>
      {message.subject ? <p className="text-sm text-muted">{message.subject}</p> : null}
      <p className="line-clamp-2 text-sm whitespace-pre-wrap">{excerpt}</p>
      {message.mediaCount > 0 ? (
        <p className="text-sm text-muted">
          {t("inbox.attachments", { count: message.mediaCount, channel })}
        </p>
      ) : null}
    </>
  );

  const acts = (
    <div className="flex items-center gap-1">
      {message.answeredAt ? null : (
        <form action={markAnsweredAction.bind(null, shopSlug)}>
          <input type="hidden" name="messageId" value={message.id} />
          <SubmitButton
            pendingLabel={t("inbox.markingAnswered")}
            className={buttonClass({ variant: "ghost", size: "sm", busy: true })}
          >
            {t("inbox.markAnswered")}
          </SubmitButton>
        </form>
      )}
      <form action={deleteMessageAction.bind(null, shopSlug)}>
        <input type="hidden" name="messageId" value={message.id} />
        <SubmitButton
          pendingLabel={t("inbox.deleting")}
          className={buttonClass({ variant: "danger-ghost", size: "sm", busy: true })}
        >
          {t("inbox.delete")}
        </SubmitButton>
      </form>
    </div>
  );

  // `LedgerRowDoor` is a union — a row carries both `href` and `linkLabel` or
  // neither — so the matched and unmatched cases are two elements, not a spread.
  return message.personId ? (
    <LedgerRow
      stacked
      kind={{ word: channel, tone: "neutral" }}
      href={`${shopPath(shopSlug, "divers", message.personId)}#messages`}
      linkLabel={t("inbox.openRecord")}
      trailing={acts}
    >
      {body}
    </LedgerRow>
  ) : (
    <LedgerRow stacked kind={{ word: channel, tone: "neutral" }} trailing={acts}>
      {body}
    </LedgerRow>
  );
}
