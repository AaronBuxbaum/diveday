import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { RowMenu } from "@/components/RowMenu";
import { SubmitButton } from "@/components/SubmitButton";
import { menuRowClass } from "@/components/ui/menu";
import type { InboxRow as InboxMessageRow } from "@/db/inbound-messages";
import type { InboxSeat } from "@/features/inbox-seats";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { mailtoHref } from "@/lib/contact-links";
import { InboxResponseDraft } from "./InboxResponseDraft";

/** All message actions in one disclosure, with no nested menu. */
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
  done: boolean;
  t: StaffTranslator;
  when: (seat: InboxSeat) => string;
  seatHref: (seat: InboxSeat) => string;
}) {
  // Every action is available after one disclosure; the sender name opens the conversation.
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
  const menuRow = (tone: "quiet" | "danger" = "quiet") => menuRowClass(tone, { gutter: false });
  const draftPanel = draftAction ? (
    <InboxResponseDraft
      key={JSON.stringify([message.id, replySubject, quoted, email])}
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
  type MenuAct = { key: string; node: ReactNode };
  const more: MenuAct[] = (
    [
      // With a draft, the plain mail link is a door in the menu; the draft's own
      // "Reply by email" carries its text once there is one.
      email && !draftAction
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
      ...lateOpen.map((seat) => ({
        key: `late-${seat.bookingId}`,
        node: lateRow(seat, menuRow()),
      })),
      ...seats.map((seat) => ({ key: `move-${seat.bookingId}`, node: moveRow(seat, menuRow()) })),
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
    <RowMenu label={t("inbox.menu.label", { name })} panelClassName="w-80" keepMounted>
      {draftPanel}
      <form action={doneAction}>
        <input type="hidden" name="messageId" value={message.id} />
        <input type="hidden" name="receivedAt" value={message.receivedAt.toISOString()} />
        <input type="hidden" name="done" value={done ? "false" : "true"} />
        <SubmitButton pendingLabel={t("words.busy.saving")} className={menuRow()}>
          {done ? t("inbox.done.reopen") : t("inbox.done.action")}
        </SubmitButton>
      </form>
      {more.length > 0 ? (
        <div className="flex flex-col gap-1">
          {more.map((act) => (
            <Fragment key={act.key}>{act.node}</Fragment>
          ))}
        </div>
      ) : null}
    </RowMenu>
  );
}
