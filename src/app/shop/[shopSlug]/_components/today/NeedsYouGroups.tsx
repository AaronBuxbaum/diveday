import Link from "next/link";
import type { ReactNode } from "react";
import { LedgerGroup } from "@/components/ui/ledger";
import { shopPath } from "@/lib/staff-notices";
import { groupByDeparture, type TodayAction } from "@/lib/today";

/**
 * **Needs you, one heading per boat** (fifth loop, item 11): the boat's time
 * and name once, linked to the departure, with its rows under it saying only
 * their own sentence; then the desk's rows, the reader's drafts and the
 * payments row under "The desk". `groupByDeparture` keeps the ranked order.
 */
export function NeedsYouGroups({
  rows,
  row,
  shopSlug,
  deskLabel,
  desk,
}: {
  rows: readonly TodayAction[];
  /** One keyed row; `grouped` is true under a boat's heading. */
  row: (action: TodayAction, grouped: boolean) => ReactNode;
  shopSlug: string;
  deskLabel: string;
  /** Rows that belong to the desk but are not queue rows (drafts, payments). */
  desk?: ReactNode;
}) {
  const groups = groupByDeparture(rows);
  if (desk && !groups.some((group) => group.departure === null)) {
    groups.push({ departure: null, rows: [] });
  }
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) =>
        group.departure ? (
          <LedgerGroup
            key={group.departure.tripId}
            as="h3"
            label={
              <Link
                href={shopPath(shopSlug, "trips", group.departure.tripId)}
                className="hover:underline"
              >
                {group.departure.label}
              </Link>
            }
          >
            <ul>{group.rows.map((action) => row(action, true))}</ul>
          </LedgerGroup>
        ) : (
          <LedgerGroup key="desk" as="h3" label={deskLabel}>
            <ul>
              {group.rows.map((action) => row(action, false))}
              {desk}
            </ul>
          </LedgerGroup>
        ),
      )}
    </div>
  );
}
