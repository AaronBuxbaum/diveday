import { ActivityLog } from "@/components/ActivityLog";
import { Pager } from "@/components/Pager";
import type { OffsetPage } from "@/db/paging";
import { activityLine } from "@/i18n/activity-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { shopPath } from "@/lib/staff-notices";
import { DiverFileGroupDisclosure } from "./DiverFileGroupDisclosure";

/**
 * **What has been done about this person**, on their own record — the shop's
 * activity trail filtered to them (`pagedDiverActivity`), rendered by the same
 * `ActivityLog` the Guests tab uses.
 *
 * Last on the record and **folded**, because it is the reference a staffer
 * scrolls to rather than the errand that brought them here (ADR
 * 20260827-people-not-lists: "the existing paged audit trail, restyled as a
 * collapsed disclosure, pagination unchanged"). It wears the file's own door
 * grammar rather than a small-caps `LedgerGroup` of its own: it is the last
 * group of the same file, and two spellings of one door down one page is the
 * drift this sweep closed.
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
  page: OffsetPage<{ id: string; code: string; params: unknown; occurredAt: Date }>;
  shopSlug: string;
  personId: string;
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  if (page.total === 0) return null;
  return (
    <DiverFileGroupDisclosure
      id="activity"
      label={t("divers.activity.heading")}
      summary={t("divers.activity.total", { count: page.total })}
      // Shut on arrival, open for a reader who has paged into it: the pager's
      // own links carry `#activity`, and landing on a shut door with the page
      // they asked for behind it would be the pager promising nothing.
      open={page.page > 1}
      className="mt-8"
    >
      <div className="mt-3">
        <ActivityLog
          events={page.rows.map((event) => ({
            id: event.id,
            message: activityLine(t, event),
            occurredAt: event.occurredAt,
          }))}
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
    </DiverFileGroupDisclosure>
  );
}
