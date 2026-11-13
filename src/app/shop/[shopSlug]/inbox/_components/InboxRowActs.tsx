import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { MoreMenu } from "@/components/MoreMenu";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { menuRowClass } from "@/components/ui/menu";
import type { InboxRow as InboxMessageRow } from "@/db/inbound-messages";
import type { InboxSeat } from "@/features/inbox-seats";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { InboxIntent } from "@/lib/assists/inbox";
import { mailtoHref } from "@/lib/contact-links";
import { InboxResponseDraft } from "./InboxResponseDraft";
import { InboxRowView } from "./InboxRowOpen";

/** An act in the row's open view: one weight for every act. */
const ACT_CLASS = buttonClass({ variant: "secondary", size: "sm" });
const PRIMARY_ACT_CLASS = buttonClass({ variant: "primary", size: "sm" });

/** The open view of a message row: one primary act, Done, and a "More". */
export function InboxRowActs({
  message,
  name,
  email,
  replySubject,
  quoted,
  seats,
  lateSeats,
  severalLate,
  lateAction,
  deleteAction,
  doneAction,
  draftAction,
  recordHref,
  intent,
  done,
  t,
  when,
  seatHref,
}: {
  message: InboxMessageRow["message"];
  name: string;
  email: string | undefined;
  replySubject: string;
  quoted: string;
  seats: readonly InboxSeat[];
  lateSeats: readonly InboxSeat[];
  severalLate: boolean;
  lateAction?: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
  doneAction: (formData: FormData) => Promise<void>;
  draftAction?: (messageId: string) => Promise<string | null>;
  recordHref: string | null;
  intent: Exclude<InboxIntent, "other"> | null;
  done: boolean;
  t: StaffTranslator;
  when: (seat: InboxSeat) => string;
  seatHref: (seat: InboxSeat) => string;
}) {
  // **One obvious act, Done, and a "More"** (Aaron, 2026-11-13). The open view
  // used to lay out up to seven buttons of one weight. Now the act this message
  // most likely wants is the one primary button (marking late or moving when
  // that is what the words asked, else the reply), Done is always there, and
  // every other door waits in the menu.
  const lateRow = (seat: InboxSeat, className: string) => (
    <form key={seat.bookingId} action={lateAction}>
      <input type="hidden" name="messageId" value={message.id} />
      <input type="hidden" name="bookingId" value={seat.bookingId} />
      <SubmitButton
        pendingLabel={t("words.busy.saving")}
        className={className}
        ariaLabel={
          severalLate
            ? t("inbox.late.actionForSeat", { name, trip: seat.title, when: when(seat) })
            : t("inbox.late.actionFor", { name, trip: seat.title })
        }
      >
        {severalLate ? t("inbox.late.actionTrip", { trip: seat.title }) : t("inbox.late.action")}
      </SubmitButton>
    </form>
  );
  const moveRow = (seat: InboxSeat, className: string) => (
    <Link
      key={seat.bookingId}
      href={`${seatHref(seat)}#move-booking-${seat.bookingId}`}
      className={className}
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
  );
  // An "Ask to move" (H-20261014-ask-to-move) is about another date, never this
  // boat's lateness: its seat carries no late window.
  const lateOpen =
    lateAction && message.channel !== "page" ? lateSeats.filter((seat) => !seat.runningLateAt) : [];
  const saidLate = message.keywordIntent === "late" || intent === "late";
  const saidMove = message.keywordIntent === "move" || intent === "move";
  const promoted: "late" | "move" | "reply" | "record" | null =
    saidLate && lateOpen.length === 1
      ? "late"
      : saidMove && seats.length === 1
        ? "move"
        : draftAction || (!recordHref && email)
          ? "reply"
          : recordHref
            ? "record"
            : null;
  const strangerMail = email ? (
    <a
      href={mailtoHref(email, { subject: replySubject, body: `\n\n${quoted}` })}
      className={ACT_CLASS}
    >
      {t("inbox.replyByEmail")}
    </a>
  ) : null;
  const menuRow = (tone: "quiet" | "danger" = "quiet") => menuRowClass(tone, { gutter: false });
  const draftPanel = draftAction ? (
    <InboxResponseDraft
      draft={draftAction.bind(null, message.id)}
      email={email}
      subject={replySubject}
      quoted={quoted}
      copy={{
        draft: t("assistsFront.inbox.draftResponse"),
        pending: t("assistsFront.conversation.drafting"),
        empty: t("assistsFront.inbox.responseEmpty"),
        label: t("assistsFront.inbox.responseLabel"),
        review: t("assistsFront.inbox.responseReview"),
        email: t("inbox.replyByEmail"),
        copy: t("assistsFront.inbox.copyResponse"),
        copied: t("words.did.copied"),
        failed: t("assistsFront.inbox.responseCopyFailed"),
        changed: t("assistsFront.inbox.responseChanged"),
      }}
    />
  ) : null;
  const openRecord = (className: string) =>
    recordHref ? (
      <Link href={recordHref} aria-label={t("inbox.openRecord", { name })} className={className}>
        {t("inbox.openRecordShort")}
      </Link>
    ) : null;
  const primary =
    promoted === "late"
      ? lateRow(lateOpen[0], PRIMARY_ACT_CLASS)
      : promoted === "move"
        ? moveRow(seats[0], PRIMARY_ACT_CLASS)
        : promoted === "reply"
          ? (draftPanel ?? strangerMail)
          : promoted === "record"
            ? openRecord(PRIMARY_ACT_CLASS)
            : null;
  type MenuAct = { key: string; node: ReactNode };
  const more: MenuAct[] = (
    [
      promoted !== "record" && recordHref ? { key: "record", node: openRecord(menuRow()) } : null,
      // With a draft, the plain mail link is a door in the menu; the draft's own
      // "Reply by email" carries its text once there is one.
      draftAction && email
        ? {
            key: "mail",
            node: (
              <a
                href={mailtoHref(email, { subject: replySubject, body: `\n\n${quoted}` })}
                className={menuRow()}
              >
                {t("inbox.replyByEmail")}
              </a>
            ),
          }
        : null,
      ...(promoted === "late"
        ? []
        : lateOpen.map((seat) => ({
            key: `late-${seat.bookingId}`,
            node: lateRow(seat, menuRow()),
          }))),
      ...(promoted === "move"
        ? []
        : seats.map((seat) => ({ key: `move-${seat.bookingId}`, node: moveRow(seat, menuRow()) }))),
      message.personId
        ? null
        : {
            key: "delete",
            node: (
              <form action={deleteAction}>
                <input type="hidden" name="messageId" value={message.id} />
                <SubmitButton
                  pendingLabel={t("words.busy.deleting")}
                  className={menuRow("danger")}
                  confirmMessage={t("inbox.delete.confirm")}
                  // One "Delete" per row would name them all the same, so the
                  // accessible name carries the address the row is about.
                  ariaLabel={t("inbox.delete.actionFor", { address: message.fromAddress })}
                >
                  {t("inbox.delete.action")}
                </SubmitButton>
              </form>
            ),
          },
    ] as (MenuAct | null)[]
  ).filter((act): act is MenuAct => act !== null);
  return (
    <InboxRowView>
      {primary}
      {/* A message that asked to move or run late promotes that act; the draft stays one tap away. */}
      {promoted !== "reply" ? draftPanel : null}
      <form action={doneAction}>
        <input type="hidden" name="messageId" value={message.id} />
        <input type="hidden" name="receivedAt" value={message.receivedAt.toISOString()} />
        <input type="hidden" name="done" value={done ? "false" : "true"} />
        <SubmitButton pendingLabel={t("words.busy.saving")} className={ACT_CLASS}>
          {done ? t("inbox.done.reopen") : t("inbox.done.action")}
        </SubmitButton>
      </form>
      {more.length > 0 ? (
        <MoreMenu label={t("inbox.more")} size="sm">
          {more.map((act) => (
            <Fragment key={act.key}>{act.node}</Fragment>
          ))}
        </MoreMenu>
      ) : null}
    </InboxRowView>
  );
}
