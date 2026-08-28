import { ActivityLog, type ActivityLogEntry } from "@/components/ActivityLog";
import { Pager } from "@/components/Pager";
import { LedgerGroup } from "@/components/ui/ledger";
import type { OffsetPage } from "@/db/paging";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { shopPath } from "@/lib/staff-notices";

/**
 * **What has been done about this person**, on their own record — the shop's
 * activity trail filtered to them (`pagedDiverActivity`), rendered by the same
 * `ActivityLog` the Guests tab uses.
 *
 * Last on the record and **folded**, because it is the reference a staffer
 * scrolls to rather than the errand that brought them here (ADR
 * 20260827-people-not-lists: "the existing paged audit trail, restyled as a
 * collapsed `GroupLabel` disclosure, pagination unchanged"). The fold is the
 * app's one disclosure spelling — a native `<details>`, so a JS failure still
 * leaves the trail one tap away.
 *
 * A record with no trail renders **nothing at all** rather than a heading over
 * an empty state: a group label only ever appears over rows.
 */
export function ActivitySection({
  page,
  shopSlug,
  personId,
  locale,
  timezone,
  t,
}: {
  page: OffsetPage<ActivityLogEntry>;
  shopSlug: string;
  personId: string;
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  if (page.total === 0) return null;
  return (
    <LedgerGroup
      as="h2"
      id="activity"
      // Folded on arrival, open for a reader who has paged into it: the
      // pager's own links carry `#activity`, and landing on a shut disclosure
      // would scroll to a summary with the page they asked for hidden behind
      // it. Whether a group folds is the caller's rule (`LedgerGroup`).
      folded={page.page === 1}
      label={t("divers.activity.heading")}
      meta={t("divers.activity.total", { count: page.total })}
      className="mt-10 scroll-mt-24"
    >
      <div className="mt-3">
        <ActivityLog
          events={page.rows}
          locale={locale}
          timeZone={timezone}
          emptyText={t("divers.activity.empty")}
        />
        <Pager
          page={page.page}
          pageCount={page.pageCount}
          // The record's own URL with only the activity page swapped, landing
          // back on this group rather than at the top of the record. Built
          // through `shopPath`, which escapes each segment — the same reason
          // every staff redirect goes through it rather than a template string
          // over a client-supplied slug.
          href={(target) =>
            `${shopPath(shopSlug, "divers", personId)}${
              target > 1 ? `?activity=${target}` : ""
            }#activity`
          }
          total={t("divers.activity.total", { count: page.total })}
          t={t}
          className="mt-4"
        />
      </div>
    </LedgerGroup>
  );
}
