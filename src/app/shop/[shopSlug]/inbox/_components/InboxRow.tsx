import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { LedgerRow } from "@/components/ui/ledger";
import type { InboxRow as InboxMessageRow } from "@/db/inbound-messages";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import type { InboundChannel } from "@/lib/inbox";
import { shopPath } from "@/lib/staff-notices";

/**
 * The channel a message came in on, in staff words. `src/db` hands over the
 * code and this picks the sentence (ADR 20260731-domain-layer-copy-leaks).
 */
const CHANNEL_KEYS: Record<InboundChannel, StaffMessageKey> = {
  email: "inbox.channel.email",
  whatsapp: "inbox.channel.whatsapp",
  sms: "inbox.channel.sms",
};

/**
 * What a one-word reply was asking for (ADR 20260909-reply-keywords). A row
 * whose whole body is "M" says nothing to the staffer who has to act on it,
 * and this is the sentence that fixes that — carried only on the handful of
 * messages the inbound path recognised, and absent from every message a person
 * wrote in their own words.
 */
const KEYWORD_KEYS: Record<"cancel" | "move" | "confirm", StaffMessageKey> = {
  cancel: "inbox.keyword.cancel",
  move: "inbox.keyword.move",
  confirm: "inbox.keyword.confirm",
};

/**
 * The first line of what a diver wrote, for a list that is scanned rather than
 * read. The whole message is on their record one tap away, and a row carrying
 * three paragraphs would bury the twelve rows under it.
 */
const EXCERPT_LENGTH = 140;

function excerpt(body: string): string {
  const flattened = body.replace(/\s+/g, " ").trim();
  return flattened.length <= EXCERPT_LENGTH
    ? flattened
    : `${flattened.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…`;
}

/**
 * **One message, as a ledger row** (ADR 20260907-two-way-inbox; the grammar is
 * 20260827-clearwater-surface-language).
 *
 * Who wrote, what they said, and when. The row's kind is the channel, because
 * that is what decides where an answer goes; whether it has been answered is
 * the group the row sits in, so no row carries a state word of its own.
 *
 * **A row is a door only when there is a record behind it.** A message from an
 * address nobody on the roster holds has no diver page to open, so it renders
 * that address instead of a link — a stretched row link reaching nothing is a
 * promise the surface cannot keep, and the address is half of what that row is
 * for.
 *
 * **That same row is the only one that can be deleted** (issue #1506). With no
 * record there is no door and no composer, so a stranger's message could be
 * read and never answered, and it went on counting against Today's
 * `unanswered_messages` with nothing on any surface able to clear it. Delete
 * is that missing move. A row that *has* a record gets none: it already has a
 * door and a composer, and the way to finish it is to answer it.
 *
 * The control asks first, which principles.md §7 ("Undo over confirm")
 * otherwise reserves for the irreversible. The write is a soft delete (ADR
 * 20260820-every-delete-is-soft), but no surface a staffer can reach offers a
 * restore — from where they stand this is one-way, and a confirm is the honest
 * shape for that. Give the inbox a restore and this becomes an undo toast.
 *
 * The form sits in `trailing`, and that placement is safe on any row, door or
 * not: `LedgerRow` renders `trailing` as a **sibling** of its door link, given
 * `relative z-10` so it paints and receives taps above the overlay
 * (`src/components/ui/ledger.tsx`). No button of ours ends up inside an
 * anchor. So nothing about the markup is what keeps Delete off a diver's row
 * — the product decision above is, and the invariant that actually holds is
 * `person_id is null` in `deleteStrangerInboundMessage`'s `where`
 * (`security-reviewer`, issue 1506). A render guard decides what a staffer is
 * offered; it has never decided what the server accepts.
 */
export function InboxRow({
  row,
  shopSlug,
  locale,
  timezone,
  t,
  deleteAction,
}: {
  row: InboxMessageRow;
  shopSlug: string;
  locale: string;
  timezone: string;
  t: StaffTranslator;
  /** A prop rather than an import so this renders under jsdom. */
  deleteAction: (formData: FormData) => Promise<void>;
}) {
  const { message, personName } = row;
  const name = personName ?? t("inbox.unknownSender");
  const subject = message.subject?.trim() || null;
  const door = message.personId
    ? {
        href: `${shopPath(shopSlug, "divers", message.personId)}#conversation`,
        linkLabel: t("inbox.openRecord", { name }),
      }
    : {};
  const facts = [
    // The address is on the stranger's row only: for a diver on file the name
    // above already says who this is, and their address is on their record.
    message.personId ? null : message.fromAddress,
    message.keywordIntent ? t(KEYWORD_KEYS[message.keywordIntent]) : null,
    message.mediaCount > 0 ? t("inbox.attachments", { count: message.mediaCount }) : null,
  ].filter((fact): fact is string => Boolean(fact));

  return (
    <LedgerRow
      as="li"
      stacked
      className="py-3"
      kind={{ word: t(CHANNEL_KEYS[message.channel]), tone: "neutral" }}
      trailing={
        <span className="flex items-center gap-3">
          <span className="text-sm text-muted tabular-nums">
            {formatDateTimeTz(message.receivedAt, locale, timezone)}
          </span>
          {message.personId ? null : (
            <form action={deleteAction}>
              <input type="hidden" name="messageId" value={message.id} />
              <SubmitButton
                pendingLabel={t("inbox.delete.pending")}
                className={buttonClass({ variant: "danger-ghost", size: "sm" })}
                confirmMessage={t("inbox.delete.confirm")}
                // One "Delete" per row would name them all the same, so the
                // accessible name carries the address the row is about.
                ariaLabel={t("inbox.delete.actionFor", { address: message.fromAddress })}
              >
                {t("inbox.delete.action")}
              </SubmitButton>
            </form>
          )}
        </span>
      }
      {...door}
    >
      <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-4">
        <p className="min-w-0 truncate font-semibold sm:w-44 sm:shrink-0">{name}</p>
        <div className="min-w-0 flex-1">
          {/* A WhatsApp message has no subject and never will, so the row's
              lead line is the diver's own first words rather than a slot
              apologising for an empty one. */}
          {subject ? <p className="truncate font-medium">{subject}</p> : null}
          {/* The diver's own words, and nothing added to them. */}
          <p className={subject ? "mt-0.5 truncate text-sm text-muted" : "truncate"}>
            {excerpt(message.body)}
          </p>
          {facts.length > 0 ? (
            <p className="mt-0.5 text-sm text-muted">{facts.join(" · ")}</p>
          ) : null}
        </div>
      </div>
    </LedgerRow>
  );
}
