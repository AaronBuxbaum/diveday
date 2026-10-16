import Link from "next/link";

import { buttonClass } from "@/components/ui/button";
import { LedgerGroup } from "@/components/ui/ledger";
import type { StaffTranslator } from "@/i18n/staff-messages";

/** The week's door: a disclosure like Tomorrow's, with the board one link inside it. */
export function WeekHorizon({
  panelClass,
  jobs,
  shopSlug,
  t,
  children,
}: {
  /** The spine's tideline panel classes, shared with Tomorrow. */
  panelClass: string;
  jobs: number;
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
      meta={t("shopHome.spine.jobs", { count: jobs })}
    >
      <div className="mt-4">
        {children}
        <Link
          href={`/shop/${shopSlug}/schedule/board`}
          className={`${buttonClass({ variant: "secondary", size: "sm" })} mt-4`}
        >
          {t("shopHome.spine.openBoard")}
        </Link>
      </div>
    </LedgerGroup>
  );
}
