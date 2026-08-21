import { ActivityLog, type ActivityLogEntry } from "@/components/ActivityLog";
import { Pager } from "@/components/Pager";
import { SectionCard } from "@/components/ui/card";
import type { OffsetPage } from "@/db/paging";
import { staffTranslator } from "@/i18n/staff-messages";
import { shopPath } from "@/lib/staff-notices";

/**
 * **What has been done about this person**, on their own record.
 *
 * The shop's activity trail has always existed, and until now the only door to
 * it was a departure: the Guests tab's collapsed log, one boat at a time. So
 * the question a staffer actually arrives with — "what happened with *this*
 * diver?" — could only be answered by remembering which trips they were on and
 * opening each one.
 *
 * The same rows, filtered to them (`pagedDiverActivity`), rendered by the same
 * `ActivityLog` the Guests tab uses. Last on the record, below the shop
 * history, because it is the reference a staffer scrolls to rather than the
 * errand that brought them here — and paged, because a returning diver's trail
 * grows for as long as they keep diving.
 */
export function ActivitySection({
  page,
  shopSlug,
  personId,
  locale,
  timezone,
}: {
  page: OffsetPage<ActivityLogEntry>;
  shopSlug: string;
  personId: string;
  locale: string;
  timezone: string;
}) {
  const t = staffTranslator(locale);
  return (
    <SectionCard title={t("divers.activity.heading")} className="mt-10">
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
        // back on this section rather than at the top of a ~6,400px scroll.
        // Built through `shopPath`, which escapes each segment — the same
        // reason every staff redirect goes through it rather than a template
        // string over a client-supplied slug.
        href={(target) =>
          `${shopPath(shopSlug, "divers", personId)}${
            target > 1 ? `?activity=${target}` : ""
          }#activity`
        }
        total={t("divers.activity.total", { count: page.total })}
        t={t}
        className="mt-4"
      />
    </SectionCard>
  );
}
