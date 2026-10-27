import { StatusMarkColumn } from "@/components/ui/StatusMark";
import type { RowReasonLines } from "./roster-row-reasons";
import type { RosterSeat } from "./roster-seat";

/**
 * What `rowReasonList` reads, and from which builder: one seat fact and the
 * lines `rowReasonLines` wrote. A test builds this without running the chain.
 */
export type RowReasonListInput = Pick<RosterSeat, "arrival"> & { t?: RosterSeat["t"] } & Pick<
    RowReasonLines,
    "reasonLines"
  >;

/** The reason lines split between the open row and the desk's private band. */
export function rowReasonList(seat: RowReasonListInput) {
  const { arrival, reasonLines, t } = seat;
  const privateAtDesk = (key: string) =>
    Boolean(arrival) && (key === "payment" || key === "recency");
  const openReasonLines = reasonLines.filter(({ key }) => !privateAtDesk(key));
  const deskPrivateLines = reasonLines.filter(({ key }) => privateAtDesk(key));
  const reasonList =
    openReasonLines.length === 0 ? null : (
      <div className="pb-2">
        {(["danger", "warning"] as const).map((band) => {
          const lines = openReasonLines.filter((line) => line.tone === band);
          if (lines.length === 0) return null;
          return (
            <div key={band} className="mt-2">
              {t ? (
                <p
                  className={`text-sm font-semibold ${band === "danger" ? "text-danger" : "text-muted"}`}
                >
                  {t(
                    band === "danger"
                      ? "trips.roster.cannotBoard"
                      : "trips.roster.informationAndPreparation",
                  )}
                </p>
              ) : null}
              <ul className="mt-1 grid gap-2 text-base">
                {lines.map(({ key, text, tone, actions }) => (
                  <li
                    key={key}
                    className={`flex items-baseline gap-2 ${tone === "danger" ? "text-danger" : "text-warning-strong"}`}
                  >
                    <StatusMarkColumn variant={tone} />
                    <div className="min-w-0">
                      <span>{text}</span>
                      {actions ? (
                        <div className="flex flex-wrap items-center gap-x-4 text-foreground">
                          {actions}
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
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
