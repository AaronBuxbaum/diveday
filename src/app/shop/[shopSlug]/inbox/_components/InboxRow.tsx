import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { z } from "zod";
import { languageName } from "@/components/assists/language-name";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass, tapTargetLinkClass } from "@/components/ui/button";
import { LedgerRow } from "@/components/ui/ledger";
import type { InboxRow as InboxMessageRow } from "@/db/inbound-messages";
import type { InboxSeat } from "@/db/inbox-seats";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { type InboxIntent, isInboxIntent } from "@/lib/assists/inbox";
import { formatNearDay, formatShortDate, formatTime, formatWeekdayTime } from "@/lib/format";
import { type InboxChannel, inboxMessageAnchor } from "@/lib/inbox";
import { shopPath } from "@/lib/staff-notices";
import { InboxRowOpen, InboxRowToggle, InboxRowView } from "./InboxRowOpen";

/**
 * The channel a message came in on, in staff words. `src/db` hands over the
 * code and this picks the sentence (ADR 20260731-domain-layer-copy-leaks).
 */
const CHANNEL_KEYS: Record<InboxChannel, StaffMessageKey> = {
  email: "inbox.channel.email",
  whatsapp: "inbox.channel.whatsapp",
  sms: "inbox.channel.sms",
  page: "inbox.channel.page",
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

/**
 * What Claude read a message as asking (ADR 20261018-claude-assists; the
 * `inbox-sort` assist). "other" says nothing a staffer can use, so it has no
 * words and no fact. A tag is a hint for the eye, never an act: a cancellation
 * still goes through the reply keyword's confirm or a staffer's own tap.
 */
const INTENT_KEYS: Record<Exclude<InboxIntent, "other">, StaffMessageKey> = {
  cancel: "assistsFront.inbox.intent.cancel",
  move: "assistsFront.inbox.intent.move",
  question: "assistsFront.inbox.intent.question",
  payment: "assistsFront.inbox.intent.payment",
  waiver: "assistsFront.inbox.intent.waiver",
  late: "assistsFront.inbox.intent.late",
};

/** An act in the row's open view: one weight for every act, Delete in its own hue. */
const ACT_CLASS = buttonClass({ variant: "secondary", size: "sm" });
const DANGER_ACT_CLASS = buttonClass({ variant: "danger", size: "sm" });

/**
 * The first line of what a diver wrote, for a list that is scanned rather than
 * read. The whole message is on their record one tap away, and a row carrying
 * three paragraphs would bury the twelve rows under it. A stranger has no
 * record, so their row wraps this instead of cutting it (`wordsCut` below).
 */
const EXCERPT_LENGTH = 140;

/** Whether a seat already carries the mark, by any door. */
const marked = (seat: InboxSeat) => seat.runningLateAt !== null;

/** Only a single plain address can be used as the recipient of a mailto link. */
const isEmailAddress = (address: string) => z.email().safeParse(address).success;

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
 * **Every row ends on one chevron that opens it in place** (visual review A15;
 * `InboxRowOpen`), and the open view is the one place a row's acts live: Open
 * the record first when there is one, then the acts. A waiting message offers **Mark done** — one state for "answered somewhere
 * else" and "no longer relevant", the same `answered_at` a sent reply stamps —
 * and a done one offers **Move back to waiting**, for a message marked done too
 * early. Every row ends on the same control, so every date in the column ends
 * on the same line whatever the row offers. The dates carry no zone: the list
 * header names it once (`inbox/page.tsx`).
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
 * **A message about a boat names the boat** (UX review 2026-10-13, item 19).
 * When the sender holds a seat that was inside the running-late window when
 * they wrote (`messageSeats`, src/db/running-late.ts), the row says which
 * departure, and its "⋯" offers **Mark running late**: the mark the diver's
 * own tap sets, which the roster and the manifest already show. A sentence is
 * never read as a command (ADR 20260909-reply-keywords), so a person decides;
 * once the seat carries the mark, by any door, the row says so instead. When
 * the sender holds **more than one** such seat, the row names each and the "⋯"
 * offers **Mark running late for {trip}** once per seat, so the desk chooses
 * (issue #2551); the server re-derives the candidates and refuses any other.
 *
 * **The seat is a door, and moving it is one tap away** (fourth UX review,
 * item 32). Outside the late window the row names every seat the sender
 * already held when they wrote (`inboxSeats`), so "Could I switch to the
 * afternoon boat?" names the boat it is about. "Booked on …" opens that seat
 * on its roster, and the "⋯" offers **Move to another departure** (one per
 * seat, each naming its departure, when there are several), which opens the
 * same row with its move already open: the roster's one move path decides,
 * and nothing here moves a seat.
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
  now,
  t,
  deleteAction,
  doneAction,
  seats = [],
  lateAction,
  requestAction,
}: {
  row: InboxMessageRow;
  shopSlug: string;
  locale: string;
  timezone: string;
  /** The page's clock, for "Today" and "Tomorrow" on the stamp and the seat. */
  now: Date;
  t: StaffTranslator;
  /** A prop rather than an import so this renders under jsdom. */
  deleteAction: (formData: FormData) => Promise<void>;
  /** Marks the message done (`done=true`) or puts it back (`done=false`). */
  doneAction: (formData: FormData) => Promise<void>;
  /** The open seats this message may be about, soonest first (`inboxSeats`). */
  seats?: readonly InboxSeat[];
  /** Puts the running-late mark on the chosen late-window seat; required whenever `seats` is passed. */
  lateAction?: (formData: FormData) => Promise<void>;
  /**
   * Reads the message into a booking request (the `request` assist). Passed
   * only while the shop's assists are on, and with it the row shows what
   * Claude read the message as and its translation.
   */
  requestAction?: (formData: FormData) => Promise<void>;
}) {
  const { message, personName } = row;
  const done = message.answeredAt !== null;
  const name = personName ?? t("inbox.unknownSender");
  const subject = message.subject?.trim() || null;
  // The record, landing on this message, first in the open view.
  const recordHref = message.personId
    ? `${shopPath(shopSlug, "divers", message.personId)}#${inboxMessageAnchor(message.id)}`
    : null;
  // **A stranger's words wrap, whole** (pixel-craft class 8, K-460). A door
  // row's excerpt is one line because the whole message is on the record one
  // tap away; a stranger has no record, so one line cut their words
  // mid-sentence with nothing able to open the rest. No line count cuts them
  // either: three lines held the seeded message only where its column was
  // wide. The 140-character excerpt is what bounds the row.
  const wordsCut = message.personId ? "truncate" : "wrap-anywhere";
  // Each seat's own roster row, by the anchor that opens it (`RosterRow`),
  // and the same row with its move open (`SeatFootActions`). With more than
  // one seat, each move names its departure: the row cannot know which one the
  // words are about (dive-domain review r4-4, F1).
  const seatHref = (seat: InboxSeat) => shopPath(shopSlug, "trips", seat.tripId);
  // "today 1:30 PM" near the day, the weekday further out (fourth review, item 45).
  const when = (seat: InboxSeat) => seatWhen(seat.startsAt, { now, locale, timezone, t });
  // The seats the running-late mark may go on, and, with more than one, each
  // mark names its departure so the desk chooses (issue #2551).
  const lateSeats = seats.filter((seat) => seat.lateWindow);
  const severalLate = lateSeats.length > 1;
  const assisted = requestAction !== undefined;
  // A keyword reply already says what it asked; Claude's tag would repeat it.
  const intent =
    assisted &&
    !message.keywordIntent &&
    isInboxIntent(message.assistIntent) &&
    message.assistIntent !== "other"
      ? message.assistIntent
      : null;
  const translation = assisted ? message.assistTranslation : null;
  const translatedFrom = translation ? languageName(message.assistLanguage, locale) : null;
  type Fact = { key: string; node: ReactNode };
  const facts = (
    [
      // The address is on the stranger's row only: for a diver on file the name
      // above already says who this is, and their address is on their record.
      // Muted words, not a second blue link beside the seat's (visual review
      // A15); the open view carries "Reply by email" for an email address.
      message.personId ? null : { key: "from", node: message.fromAddress },
      // A LATE reply already marked the seat; the seat's own fact says so.
      message.keywordIntent && !(message.keywordIntent === "late" && seats.some(marked))
        ? { key: "keyword", node: t(KEYWORD_KEYS[message.keywordIntent]) }
        : null,
      assisted && message.assistUrgent && !done
        ? {
            key: "urgent",
            node: <span className="font-medium text-danger">{t("assistsFront.inbox.urgent")}</span>,
          }
        : null,
      intent ? { key: "intent", node: t(INTENT_KEYS[intent]) } : null,
      ...seats.flatMap((seat): (Fact | null)[] => [
        {
          key: `seat-${seat.bookingId}`,
          node: (
            // Above the row's stretched door (`z-0`), so it takes its own tap.
            <Link
              href={`${seatHref(seat)}#booking-${seat.bookingId}`}
              className={`${tapTargetLinkClass} relative z-10 font-medium text-primary hover:underline`}
            >
              {t("inbox.seat", { trip: seat.title, when: when(seat) })}
            </Link>
          ),
        },
        // **What the roster's Move will refuse** (issue #2668): an Ask to move
        // on a party lead's seat or a buddy-teamed one, said before the desk
        // opens the roster and is refused there.
        seat.moveRefusal
          ? {
              key: `refusal-${seat.bookingId}`,
              node:
                seat.moveRefusal.kind === "leads_party"
                  ? t("inbox.moveRefusal.leadsParty", { count: seat.moveRefusal.partySize })
                  : t("inbox.moveRefusal.onBuddyTeam"),
            }
          : null,
        seat.runningLateAt
          ? {
              key: `late-${seat.bookingId}`,
              node: severalLate
                ? t("inbox.late.markedFor", {
                    trip: seat.title,
                    time: formatTime(seat.runningLateAt, locale, timezone),
                  })
                : t("inbox.late.marked", {
                    time: formatTime(seat.runningLateAt, locale, timezone),
                  }),
            }
          : null,
      ]),
      message.mediaCount > 0
        ? { key: "media", node: t("inbox.attachments", { count: message.mediaCount }) }
        : null,
    ] as (Fact | null)[]
  ).filter((fact): fact is Fact => fact !== null);

  return (
    <InboxRowOpen>
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
              {receivedWhen(message.receivedAt, { now, locale, timezone, t })}
            </span>
            <InboxRowToggle label={t("inbox.menu.label", { name })} />
          </div>
        }
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
            {/* The diver's own words, and nothing added to them. An "Ask to
              move" sent without a note has none; its facts say what it is. */}
            {message.body.trim() ? (
              <p className={subject ? `mt-0.5 ${wordsCut} text-sm text-muted` : wordsCut}>
                {excerpt(message.body)}
              </p>
            ) : null}
            {/* Claude's translation, under their words and never instead of them. */}
            {translation && translatedFrom ? (
              <p className={`mt-0.5 ${wordsCut} text-sm text-muted`}>
                {t("assistsFront.inbox.translation", {
                  language: translatedFrom,
                  text: excerpt(translation),
                })}
              </p>
            ) : null}
            {/* `wrap-anywhere`: a stranger's address has no break in it, and at
              640 it ran 96px out of a 72px column (K-461). Cut, it would lose
              half of what the row is for, so it breaks inside the column. */}
            {facts.length > 0 ? (
              <p className="mt-0.5 wrap-anywhere text-sm text-muted">
                {facts.map((fact, index) => (
                  <Fragment key={fact.key}>
                    {index > 0 ? " · " : null}
                    {fact.node}
                  </Fragment>
                ))}
              </p>
            ) : null}
            <InboxRowView>
              {recordHref ? (
                <Link
                  href={recordHref}
                  aria-label={t("inbox.openRecord", { name })}
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  {t("inbox.openRecordShort")}
                </Link>
              ) : isEmailAddress(message.fromAddress) ? (
                // A stranger has no record to write from, so the reply starts in
                // the staffer's own mail app. A phone number stays words.
                <a
                  href={`mailto:${message.fromAddress.split("@").map(encodeURIComponent).join("@")}`}
                  className={ACT_CLASS}
                >
                  {t("inbox.replyByEmail")}
                </a>
              ) : null}
              {/* An "Ask to move" (H-126) is about another date, never this
              boat's lateness: its seat carries no late window. */}
              {lateAction && message.channel !== "page"
                ? lateSeats
                    .filter((seat) => !seat.runningLateAt)
                    .map((seat) => (
                      <form key={seat.bookingId} action={lateAction}>
                        <input type="hidden" name="messageId" value={message.id} />
                        <input type="hidden" name="bookingId" value={seat.bookingId} />
                        <SubmitButton
                          pendingLabel={t("inbox.done.pending")}
                          className={ACT_CLASS}
                          ariaLabel={
                            severalLate
                              ? t("inbox.late.actionForSeat", {
                                  name,
                                  trip: seat.title,
                                  when: when(seat),
                                })
                              : t("inbox.late.actionFor", { name, trip: seat.title })
                          }
                        >
                          {severalLate
                            ? t("inbox.late.actionTrip", { trip: seat.title })
                            : t("inbox.late.action")}
                        </SubmitButton>
                      </form>
                    ))
                : null}
              {requestAction && message.channel !== "page" ? (
                <form action={requestAction}>
                  <input type="hidden" name="messageId" value={message.id} />
                  <SubmitButton
                    pendingLabel={t("assistsFront.inbox.makingRequest")}
                    className={ACT_CLASS}
                    ariaLabel={t("assistsFront.inbox.makeRequestFor", { name })}
                  >
                    {t("assistsFront.inbox.makeRequest")}
                  </SubmitButton>
                </form>
              ) : null}
              {seats.map((seat) => (
                <Link
                  key={seat.bookingId}
                  href={`${seatHref(seat)}#move-booking-${seat.bookingId}`}
                  className={ACT_CLASS}
                  aria-label={
                    seats.length > 1
                      ? t("inbox.moveSeatFor", { name, trip: seat.title, when: when(seat) })
                      : t("inbox.moveFor", { name, trip: seat.title })
                  }
                >
                  {seats.length > 1
                    ? t("inbox.moveSeat", { trip: seat.title, when: when(seat) })
                    : t("inbox.move")}
                </Link>
              ))}
              <form action={doneAction}>
                <input type="hidden" name="messageId" value={message.id} />
                <input type="hidden" name="receivedAt" value={message.receivedAt.toISOString()} />
                <input type="hidden" name="done" value={done ? "false" : "true"} />
                <SubmitButton pendingLabel={t("inbox.done.pending")} className={ACT_CLASS}>
                  {done ? t("inbox.done.reopen") : t("inbox.done.action")}
                </SubmitButton>
              </form>
              {message.personId ? null : (
                <form action={deleteAction}>
                  <input type="hidden" name="messageId" value={message.id} />
                  <SubmitButton
                    pendingLabel={t("inbox.delete.pending")}
                    className={DANGER_ACT_CLASS}
                    confirmMessage={t("inbox.delete.confirm")}
                    // One "Delete" per row would name them all the same, so the
                    // accessible name carries the address the row is about.
                    ariaLabel={t("inbox.delete.actionFor", { address: message.fromAddress })}
                  >
                    {t("inbox.delete.action")}
                  </SubmitButton>
                </form>
              )}
            </InboxRowView>
          </div>
        </div>
      </LedgerRow>
    </InboxRowOpen>
  );
}

type When = { now: Date; locale: string; timezone: string; t: StaffTranslator };

/**
 * When a message arrived: "Today, 7:00 AM" within a day of now, "Oct 22, 8:30
 * AM" further out (fourth review, item 45). A running-late text is about a
 * boat leaving in hours, and "Oct 14" on Oct 14 made the desk do the
 * arithmetic. No zone: the list header names it once (visual review A15).
 */
function receivedWhen(at: Date, { now, locale, timezone, t }: When): string {
  const day = formatNearDay(at, now, locale, timezone) ?? formatShortDate(at, locale, timezone);
  return t("inbox.nearStamp", { day, time: formatTime(at, locale, timezone) });
}

/** The seat's departure, mid-sentence: "today 1:30 PM", or "Saturday 8:00 AM". */
function seatWhen(at: Date, { now, locale, timezone, t }: When): string {
  const day = formatNearDay(at, now, locale, timezone, { lead: false });
  return day
    ? t("inbox.nearSeat", { day, time: formatTime(at, locale, timezone) })
    : formatWeekdayTime(at, locale, timezone);
}
