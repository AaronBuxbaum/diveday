import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { InsetGroup } from "@/components/ui/ledger";
import type { ShelfTokenStanding } from "@/db/person-shelf-tokens";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone, formatCalendarDate } from "@/lib/calendar-date";
import { sendShelfLinkAction } from "../actions";
import { DiverFileGroupDisclosure } from "./DiverFileGroupDisclosure";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";

/**
 * **The shelf, as one row of the diver's file** (slice 20t).
 *
 * The group's summary is its one useful fact, the same rule every other file
 * group follows: how the link is doing. Three states, and each is a different
 * thing to do next — nothing sent, sent and never opened, or opened and how
 * often. Inside, the two facts a staffer standing at a counter actually uses
 * (when it was last opened, how many phones hold it) and the one act.
 *
 * **No revoke button.** Nothing in the product asks for one yet, and a
 * destructive control with no caller is a control nobody has reasoned about.
 * Erasure revokes every link this diver holds (`anonymizeDiver`), which is the
 * case that had to be covered and is.
 */
export function ShelfGroup({
  shopSlug,
  personId,
  standing,
  locale,
  timezone,
  t,
  status,
}: {
  shopSlug: string;
  personId: string;
  standing: ShelfTokenStanding;
  locale: string;
  timezone: string;
  t: StaffTranslator;
  status?: DiverNotice;
}) {
  const summary =
    standing.opens > 0
      ? t("divers.shelf.summaryOpened", { count: standing.opens })
      : standing.live > 0
        ? t("divers.shelf.summarySent")
        : t("divers.shelf.summaryNotSent");

  return (
    <DiverFileGroupDisclosure id="shelf" label={t("divers.shelf.label")} summary={summary}>
      {/* Both rows take the inset every other group on the record gives its
          rows (`px-5 py-4 sm:px-6`, as in the notes and conversation groups).
          They had the summary's `px-1`, which put the text 4px from the
          card's edge, sat the button's border on the divider above it, and
          left the button's 5px focus ring a pixel short of the card's
          `overflow-hidden`. */}
      <InsetGroup>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4 sm:px-6">
          <p className="text-sm text-muted">
            {standing.phones > 0
              ? t("divers.shelf.phones", { count: standing.phones })
              : t("divers.shelf.noPhones")}
          </p>
          {standing.lastOpenedAt ? (
            <p className="text-sm text-muted tabular-nums">
              {t("divers.shelf.lastOpened", {
                date: formatCalendarDate(
                  calendarDateInTimezone(standing.lastOpenedAt, timezone),
                  locale,
                ),
              })}
            </p>
          ) : null}
        </div>
        <form
          action={sendShelfLinkAction.bind(null, shopSlug, personId)}
          className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6"
        >
          <SubmitButton
            pendingLabel={t("divers.shelf.send")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("divers.shelf.send")}
          </SubmitButton>
          <DiverFormStatus status={status} />
        </form>
      </InsetGroup>
    </DiverFileGroupDisclosure>
  );
}
