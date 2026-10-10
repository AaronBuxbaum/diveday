import { StatusMarkColumn } from "@/components/ui/StatusMark";
import type { RowHeader } from "./roster-row-header";
import type { RowIdentity } from "./roster-row-identity";
import type { RowNotices } from "./roster-row-notices";
import type { RowReasonLines } from "./roster-row-reasons";
import type { RosterSeat } from "./roster-seat";

/** The reason lines split between the open row and the desk's private band. */
export function rowReasonList(
  seat: RosterSeat & RowHeader & RowNotices & RowReasonLines & RowIdentity,
) {
  const { arrival, reasonLines } = seat;
  const privateAtDesk = (key: string) =>
    Boolean(arrival) && (key === "payment" || key === "recency");
  const openReasonLines = reasonLines.filter(({ key }) => !privateAtDesk(key));
  const deskPrivateLines = reasonLines.filter(({ key }) => privateAtDesk(key));
  const reasonList =
    openReasonLines.length === 0 ? null : (
      <ul className="-mt-1 grid gap-1 pb-2 text-sm">
        {openReasonLines.map(({ key, text, tone, actions }) => (
          <li
            key={key}
            className={`flex items-baseline gap-2 ${
              tone === "danger" ? "text-danger" : "text-warning-strong"
            }`}
          >
            <StatusMarkColumn variant={tone} />
            <span className="min-w-0">
              {text}
              {/* The line's doors, under its words and on its column, in the
                  page's link ink so they read as controls, not as more of
                  the reason. `-mb-3` hands back the 44px target's unseen
                  half so the next line does not drift away. */}
              {actions ? (
                <span className="-mb-3 flex flex-wrap items-center gap-x-4 text-foreground">
                  {actions}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    );
  /**
   * **Work**: the fix for everything this seat still owes, behind the row's
   * own mark — the sentences themselves are the reason lines under the name
   * (owner, 2026-10-05). Membership is decided by the kind of thing, never
   * by its current value, so a control can never leave from under the
   * finger that used it: payment, the contact form and the notes stay put in
   * both states, and a form that just answered holds its row open.
   */
  return { deskPrivateLines, reasonList };
}

export type RowReasonList = ReturnType<typeof rowReasonList>;
