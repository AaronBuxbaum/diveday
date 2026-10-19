import Link from "next/link";

import { buttonClass } from "@/components/ui/button";
import { LedgerGroup } from "@/components/ui/ledger";
import type { StaffTranslator } from "@/i18n/staff-messages";

/** The week's door: a disclosure like Tomorrow's, with the board one link inside it. */
export function WeekHorizon({
  panelClass,
  jobs,
  crewAway,
  shopSlug,
  t,
  children,
}: {
  /** The spine's tideline panel classes, shared with Tomorrow. */
  panelClass: string;
  jobs: number;
  /** The week's rostered crew who are away (`weekCrewAway`), named on the line (#2671). */
  crewAway: { people: number; firstDay: string } | null;
  shopSlug: string;
  t: StaffTranslator;
  /** The week's job rows, drawn by the spine's own row renderer. */
  children: React.ReactNode;
}) {
  return (
    <LedgerGroup
      as="h2"
      folded
      summaryVariant="row"
      className={`${panelClass} open:sm:col-span-2 sm:[&>summary]:border-0 sm:[&>summary]:rounded-panel max-sm:[&>summary]:border-b`}
      label={t("shopHome.spine.week")}
      meta={
        crewAway
          ? t("shopHome.spine.needsYouCountCrewAway", { count: jobs, away: crewAway.people })
          : t("shopHome.spine.needsYouCount", { count: jobs })
      }
    >
      <div className="mt-4">
        {children}
        <Link
          // On the week the soonest away crew member's departure is in, so the
          // board opens where the line's count points.
          href={
            crewAway
              ? `/shop/${shopSlug}/schedule/board?week=${crewAway.firstDay}`
              : `/shop/${shopSlug}/schedule/board`
          }
          className={`${buttonClass({ variant: "secondary", size: "sm" })} mt-4`}
        >
          {t("shopHome.spine.openBoard")}
        </Link>
      </div>
    </LedgerGroup>
  );
}
