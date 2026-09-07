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
 */
export function InboxRow({
  row,
  shopSlug,
  locale,
  timezone,
  t,
}: {
  row: InboxMessageRow;
  shopSlug: string;
  locale: string;
  timezone: string;
  t: StaffTranslator;
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
    message.mediaCount > 0 ? t("inbox.attachments", { count: message.mediaCount }) : null,
  ].filter((fact): fact is string => Boolean(fact));

  return (
    <LedgerRow
      as="li"
      stacked
      className="py-3"
      kind={{ word: t(CHANNEL_KEYS[message.channel]), tone: "neutral" }}
      trailing={
        <span className="text-sm text-muted tabular-nums">
          {formatDateTimeTz(message.receivedAt, locale, timezone)}
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
