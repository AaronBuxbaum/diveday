import { RowMenu } from "@/components/RowMenu";
import { SubmitButton } from "@/components/SubmitButton";
import { LedgerRow } from "@/components/ui/ledger";
import { menuRowClass } from "@/components/ui/menu";
import type { InboxRow as InboxMessageRow } from "@/db/inbound-messages";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { type InboundChannel, inboxMessageAnchor } from "@/lib/inbox";
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
const KEYWORD_KEYS: Record<"cancel" | "move" | "confirm" | "late", StaffMessageKey> = {
  cancel: "inbox.keyword.cancel",
  move: "inbox.keyword.move",
  confirm: "inbox.keyword.confirm",
  late: "inbox.keyword.late",
};

/** A row of the "⋯" list: a list of acts, so no tick gutter. */
const MENU_ROW_CLASS = `${menuRowClass("quiet", { gutter: false })} whitespace-nowrap`;
const MENU_DANGER_ROW_CLASS = `${menuRowClass("danger", { gutter: false })} whitespace-nowrap`;

/**
 * The first line of what a diver wrote, for a list that is scanned rather than
 * read. The whole message is on their record one tap away, and a row carrying
 * three paragraphs would bury the twelve rows under it. A stranger has no
 * record, so their row wraps this instead of cutting it (`wordsCut` below).
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
 * **Every row ends on a "⋯"** (`RowMenu`), the one place a row's acts live,
 * floating its list beside the button the way every row menu in the app does.
 * A waiting message offers **Mark done** — one state for "answered somewhere
 * else" and "no longer relevant", the same `answered_at` a sent reply stamps —
 * and a done one offers **Move back to waiting**, for a message marked done too
 * early. Both rows sit at the same edge, so every date in the column ends on
 * the same line whatever the row offers.
 *
 * **Only a stranger's row offers Delete** (issue #1506). With no record there
 * is no door and no composer, so a stranger's message could be read and never
 * answered. A row that *has* a record gets none: what a diver wrote belongs to
 * their conversation. The invariant that actually holds is `person_id is null`
 * in `deleteStrangerInboundMessage`'s `where` (`security-reviewer`, issue
 * 1506); a render guard decides what a staffer is offered, never what the
 * server accepts. The delete asks first: the write is soft (ADR
 * 20260820-every-delete-is-soft), but nothing a staffer can reach restores it.
 *
 * **The door lands on the message, not the top of the conversation.** Each
 * inbound message on the record carries `id="message-<id>"`, and the record's
 * disclosure opens whichever group holds the fragment and scrolls it in.
 */
export function InboxRow({
  row,
  shopSlug,
  locale,
  timezone,
  t,
  deleteAction,
  doneAction,
}: {
  row: InboxMessageRow;
  shopSlug: string;
  locale: string;
  timezone: string;
  t: StaffTranslator;
  /** A prop rather than an import so this renders under jsdom. */
  deleteAction: (formData: FormData) => Promise<void>;
  /** Marks the message done (`done=true`) or puts it back (`done=false`). */
  doneAction: (formData: FormData) => Promise<void>;
}) {
  const { message, personName } = row;
  const done = message.answeredAt !== null;
  const name = personName ?? t("inbox.unknownSender");
  const subject = message.subject?.trim() || null;
  // A stranger's row has no door, and keeps the door's slot: its date ends
  // on the edge every other date in the column ends on (K-459).
  const door = message.personId
    ? {
        href: `${shopPath(shopSlug, "divers", message.personId)}#${inboxMessageAnchor(message.id)}`,
        linkLabel: t("inbox.openRecord", { name }),
      }
    : { reserveDoorSlot: true };
  // **A stranger's words wrap, whole** (pixel-craft class 8, K-460). A door
  // row's excerpt is one line because the whole message is on the record one
  // tap away; a stranger has no record, so one line cut their words
  // mid-sentence with nothing able to open the rest. No line count cuts them
  // either: three lines held the seeded message only where its column was
  // wide. The 140-character excerpt is what bounds the row.
  const wordsCut = message.personId ? "truncate" : "wrap-anywhere";
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
      pad="lg"
      // The channel word and the date on the sender's line, not centred on
      // the sender and the message together.
      align="first-line"
      kind={{ word: t(CHANNEL_KEYS[message.channel]), tone: "neutral" }}
      trailing={
        <div className="flex items-center gap-1">
          <span className="text-sm text-muted tabular-nums">
            {formatDateTimeTz(message.receivedAt, locale, timezone)}
          </span>
          <RowMenu label={t("inbox.menu.label", { name })}>
            <form action={doneAction}>
              <input type="hidden" name="messageId" value={message.id} />
              <input type="hidden" name="done" value={done ? "false" : "true"} />
              <SubmitButton pendingLabel={t("inbox.done.pending")} className={MENU_ROW_CLASS}>
                {done ? t("inbox.done.reopen") : t("inbox.done.action")}
              </SubmitButton>
            </form>
            {message.personId ? null : (
              <form action={deleteAction}>
                <input type="hidden" name="messageId" value={message.id} />
                <SubmitButton
                  pendingLabel={t("inbox.delete.pending")}
                  className={MENU_DANGER_ROW_CLASS}
                  confirmMessage={t("inbox.delete.confirm")}
                  // One "Delete" per row would name them all the same, so the
                  // accessible name carries the address the row is about.
                  ariaLabel={t("inbox.delete.actionFor", { address: message.fromAddress })}
                >
                  {t("inbox.delete.action")}
                </SubmitButton>
              </form>
            )}
          </RowMenu>
        </div>
      }
      {...door}
    >
      {/* The name beside the message from `md`, not `sm`: beside the kind
          column, the date and the door's slot, its 176px column left the
          message ~122px at 640 (K-460, K-461). Below `md` the name sits over
          the message, which takes the body's whole width. */}
      <div className="flex min-w-0 flex-col gap-1 md:flex-row md:items-baseline md:gap-4">
        <p className="min-w-0 truncate font-semibold md:w-44 md:shrink-0">{name}</p>
        <div className="min-w-0 flex-1">
          {/* A WhatsApp message has no subject and never will, so the row's
              lead line is the diver's own first words rather than a slot
              apologising for an empty one. */}
          {subject ? <p className="truncate font-medium">{subject}</p> : null}
          {/* The diver's own words, and nothing added to them. */}
          <p className={subject ? `mt-0.5 ${wordsCut} text-sm text-muted` : wordsCut}>
            {excerpt(message.body)}
          </p>
          {/* `wrap-anywhere`: a stranger's address has no break in it, and at
              640 it ran 96px out of a 72px column (K-461). Cut, it would lose
              half of what the row is for, so it breaks inside the column. */}
          {facts.length > 0 ? (
            <p className="mt-0.5 wrap-anywhere text-sm text-muted">{facts.join(" · ")}</p>
          ) : null}
        </div>
      </div>
    </LedgerRow>
  );
}
