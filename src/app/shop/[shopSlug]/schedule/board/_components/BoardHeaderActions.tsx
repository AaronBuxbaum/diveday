import Link from "next/link";
import { MoreMenu } from "@/components/MoreMenu";
import { buttonClass } from "@/components/ui/button";
import { menuRowClass } from "@/components/ui/menu";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { publicSchedulePath } from "@/lib/public-routes";

/**
 * **One primary, the board's own act; its peers at one weight**
 * (visual review A17). "Add a departure" leads for a role that can
 * make one (issue #1831's gate); a role that cannot sees "Add a
 * booking" lead instead. The rest are equal secondary buttons
 * from `md`, and one "More" menu below it, so a phone shows the
 * primary alone beside it. A link to `?add=1`, not a button: the
 * open-the-panel state lives in ScheduleBuilder; `data-board-add`
 * is how the panel's Cancel hands focus back here.
 */
export function BoardHeaderActions({
  st,
  shopSlug,
  canConfigure,
  week,
}: {
  st: StaffTranslator;
  shopSlug: string;
  canConfigure: boolean;
  week?: string;
}) {
  return (
    <>
      {canConfigure ? (
        <Link
          href={`/shop/${shopSlug}/schedule/board/new${week ? `?week=${encodeURIComponent(week)}` : ""}`}
          data-board-add
          scroll={false}
          className={buttonClass()}
        >
          {st("schedule.builder.addDeparture")}
        </Link>
      ) : (
        <Link href={`/shop/${shopSlug}/bookings/new`} className={buttonClass()}>
          {st("schedule.addBooking")}
        </Link>
      )}
      <div className="flex gap-3 max-md:hidden">
        {canConfigure ? (
          <Link
            href={`/shop/${shopSlug}/bookings/new`}
            className={buttonClass({ variant: "secondary" })}
          >
            {st("schedule.addBooking")}
          </Link>
        ) : null}
        <Link href={publicSchedulePath(shopSlug)} className={buttonClass({ variant: "secondary" })}>
          {st("schedule.viewPublicPage")}
        </Link>
      </div>
      <MoreMenu label={st("schedule.more")} className="md:hidden">
        {canConfigure ? (
          <Link
            href={`/shop/${shopSlug}/bookings/new`}
            className={menuRowClass("quiet", { gutter: false })}
          >
            {st("schedule.addBooking")}
          </Link>
        ) : null}
        <Link
          href={publicSchedulePath(shopSlug)}
          className={menuRowClass("quiet", { gutter: false })}
        >
          {st("schedule.viewPublicPage")}
        </Link>
      </MoreMenu>
    </>
  );
}
