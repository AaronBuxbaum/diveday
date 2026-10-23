import { LedgerGroup } from "@/components/ui/ledger";
import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * The week's door: a disclosure like Tomorrow's. No board link inside it: the
 * side panel's Board is the same door (Aaron 2026-10-23).
 */
export function WeekHorizon({
  panelClass,
  jobs,
  crewAway,
  t,
  children,
}: {
  /** The spine's tideline panel classes, shared with Tomorrow. */
  panelClass: string;
  jobs: number;
  /** The week's rostered crew who are away (`weekCrewAway`), named on the line (#2671). */
  crewAway: number;
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
        crewAway > 0
          ? t("shopHome.spine.needsYouCountCrewAway", { count: jobs, away: crewAway })
          : t("shopHome.spine.needsYouCount", { count: jobs })
      }
    >
      <div className="mt-4">{children}</div>
    </LedgerGroup>
  );
}
