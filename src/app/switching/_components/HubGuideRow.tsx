import Link from "next/link";
import { SkeletonLineBars, type SkeletonLines } from "@/components/ShopPageHeader";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { SUB_TITLE_CLASS } from "@/components/ui/typography";

/**
 * **One row of the switching hub's index**: the guide's name, why a reader
 * would stop, and an arrow — the whole row one link.
 *
 * The rule is the item's and the fill is the link's, so the hover chip can take
 * 16px of room around the words — paid back as a negative margin, so the title
 * stays on the heading's column — without dragging the rules out past the
 * list's own top rule. 8px of the row's 24px above and below sits on the item,
 * which keeps the chip off both rules; the words do not move.
 *
 * Not a ledger row, on purpose. This is a marketing index on a 24px rhythm
 * with no `LedgerRow` anywhere on its page: its rules share their length with
 * the list's own top rule and the closing band's rule beneath it, both on the
 * column, and a rounded chip clear of both rules is the fill that suits a
 * spaced list (the pixel probe measured the old fill at 0px from the title,
 * 2026-09-25).
 */
/** The row's item: its rule and the 8px that keep the chip off it. Shared with its skeleton. */
const ROW_ITEM_CLASS = "border-b border-border py-2";

export function HubGuideRow({
  href,
  title,
  summary,
}: {
  href: string;
  title: string;
  summary: string;
}) {
  return (
    <li className={ROW_ITEM_CLASS}>
      <Link
        href={href}
        className="group -mx-4 flex items-start gap-6 rounded-lg px-4 py-4 transition-colors hover:bg-surface"
      >
        <div className="min-w-0 flex-1">
          <h2 className={`${SUB_TITLE_CLASS} group-hover:text-primary`}>{title}</h2>
          <p className="mt-1.5 leading-7 text-muted">{summary}</p>
        </div>
        <DiveDayIcon
          name="arrow-right"
          className="mt-1 size-5 shrink-0 text-muted transition-transform group-hover:translate-x-1 group-hover:text-primary motion-reduce:transition-none"
        />
      </Link>
    </li>
  );
}

/**
 * **A row, as bars** (K-406): the item's own rule and 8px, the link's 16px
 * above and below, a 28px title line (`SUB_TITLE_CLASS`) and a 28px line per
 * line the summary wraps to — so the row lands where its bars stood. The
 * skeleton's rows used to be a 24px title bar and one 20px summary bar, 105px
 * for rows of 111–139px at 1280 and 167–223 at 390. How far a guide's summary
 * wraps is the hub's business (`HUB_ROW_SUMMARY_LINES`).
 */
export function HubGuideRowSkeleton({ summaryLines }: { summaryLines: SkeletonLines }) {
  return (
    <li className={ROW_ITEM_CLASS}>
      <div className="py-4">
        <div className="h-7 w-full max-w-xs rounded bg-surface-sunken" />
        <div className="mt-1.5">
          <SkeletonLineBars lines={summaryLines} height="h-7" width="w-full max-w-lg" />
        </div>
      </div>
    </li>
  );
}
