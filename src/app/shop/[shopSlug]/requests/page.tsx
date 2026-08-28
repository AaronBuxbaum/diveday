import type { Metadata } from "next";
import { EmptyState } from "@/components/EmptyState";
import { Pager } from "@/components/Pager";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { listBoats } from "@/db/boats";
import { listDateRequestsForStaff } from "@/db/course-inquiries";
import { canPersonViewShopReports } from "@/db/reporting";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate } from "@/lib/calendar-date";
import { groupDateRequests } from "@/lib/date-requests";
import { adviseRequests, departureShapeFor } from "@/lib/request-advisor";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { shopPath } from "@/lib/staff-notices";
import {
  addDepartureHref,
  RequestDayGroup,
  requestAdviceLines,
} from "./_components/RequestDayGroup";
import { RequestLedgerRow } from "./_components/RequestLedgerRow";

// `instant = true` asserts that navigating *into* this page paints
// immediately — it is this segment's `loading.tsx` that stands in while the
// request-scoped reads stream, exactly as on every other staff list. See ADR
// 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Requests — DiveDay",
};

/**
 * **Every date a diver asked for that the board has nothing on** (ADR
 * 20260827-people-not-lists, decision 5; the language is
 * 20260827-clearwater-surface-language).
 *
 * The grouping rules are `groupDateRequests` (src/lib/date-requests.ts) and
 * this page adds none of its own: one group per named date, a request in every
 * group it could make, flexible requests travelling to nearby days, and the
 * ones that named no date at all at the foot.
 *
 * What the redesign moved is where a day's facts live. **The group header owns
 * the count, the advice and the act** — "Mar 6, 2027 — 2 groups · 5 divers",
 * the hull and the crew the planner would put on it, and the one link into the
 * schedule builder, pre-dated and carrying these leads forward. The rows
 * beneath are hairline ledger rows saying only who asked and what for; the
 * tinted "Planning suggestion" card and the per-row match badges went with it
 * (`RequestLedgerRow`).
 *
 * These are **course inquiries** (ADR
 * 20260814-a-date-request-is-a-course-inquiry): a request for a departure to
 * exist. Never the wait list, which answers "tell me when a seat frees", and
 * never the last-minute deal list.
 */
export default async function RequestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { shopSlug } = await params;
  const { page } = await searchParams;
  // Checked against the database, not the JWT, so a demoted manager loses the
  // contact details on this page immediately — the same live check Reports
  // makes, and for the same reason (canPersonViewShopReports).
  //
  // The nav already hides this destination from everyone but owners and
  // managers (ADR 20260724-role-gated-surfaces-hide-not-explain); the refusal
  // landing is for a bookmark, a deep link, or a role that changed under
  // someone — and it says why rather than teleporting them silently.
  const { db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonViewShopReports,
    refusal: { notice: "requests-not-authorized" },
  });
  const locale = await requestLocale(shop.defaultLocale);
  const timezone = shop.timezone;
  const t = staffTranslator(locale);

  // A non-numeric or missing `?page=` reads as page 1; the query clamps it into
  // range, so a bookmarked page past the end lands on the last real one.
  const [requestPage, shopBoats] = await Promise.all([
    listDateRequestsForStaff(db, shop.id, {
      page: Number.parseInt(page ?? "", 10),
    }),
    listBoats(db, shop.id),
  ]);
  // A boat shop plans a day against its hulls and is the only kind of shop
  // shown one; every shop, hull or not, crews it against its own target ratio.
  const departureShape = departureShapeFor(
    shop,
    shopBoats.map((b) => ({ id: b.id, name: b.name, capacity: b.capacity })),
  );
  const { groups, undated } = groupDateRequests(requestPage.rows, (row) => row);
  const base = shopPath(shopSlug, "requests");
  const pageHref = (target: number) => (target > 1 ? `${base}?page=${target}` : base);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t(STAFF_DESTINATION_LABEL_KEYS.requests)}
        title={t("requests.title")}
        description={t("requests.description")}
      />

      {requestPage.total === 0 ? (
        <EmptyState title={t("requests.emptyHeading")} body={t("requests.emptyDetail")} />
      ) : (
        // One rhythm between groups, the page-section spacing every staff
        // surface uses — never a per-section `mt-*` that drifts.
        <div className="space-y-10">
          {groups.map((group) => {
            const advice = adviseRequests(
              group.entries.map(({ request }) => ({
                id: request.id,
                divers: request.divers,
                experienceLevel: request.experienceLevel,
                courseId: request.courseId,
              })),
              departureShape,
            );
            return (
              <RequestDayGroup
                key={group.date}
                id={`date-${group.date}`}
                label={t("requests.group.day", {
                  date: formatCalendarDate(group.date, locale),
                  groups: group.groupCount,
                  divers: advice.estimatedDivers,
                })}
                advice={requestAdviceLines(advice, shop.diversPerDivemaster, t)}
                add={{
                  href: addDepartureHref(
                    shopSlug,
                    group.date,
                    group.entries.map(({ request }) => request.id),
                  ),
                  label: t("requests.addDeparture"),
                }}
              >
                {group.entries.map((entry) => (
                  <RequestLedgerRow
                    key={`${group.date}-${entry.request.id}`}
                    request={entry.request}
                    match={entry.match}
                    locale={locale}
                    timezone={timezone}
                    shopSlug={shopSlug}
                    t={t}
                  />
                ))}
              </RequestDayGroup>
            );
          })}

          {/* Last, always: prose a date field could not hold is still a lead,
              but it is not a day anyone can put a boat on — so this group has a
              count and no act. */}
          {undated.length > 0 ? (
            <RequestDayGroup
              id="no-date"
              label={t("requests.group.noDate", { count: undated.length })}
            >
              {undated.map((request) => (
                <RequestLedgerRow
                  key={request.id}
                  request={request}
                  match={null}
                  locale={locale}
                  timezone={timezone}
                  shopSlug={shopSlug}
                  t={t}
                />
              ))}
            </RequestDayGroup>
          ) : null}
        </div>
      )}

      <Pager
        page={requestPage.page}
        pageCount={requestPage.pageCount}
        href={pageHref}
        total={t("requests.pagination.total", { count: requestPage.total })}
        t={t}
        className="mt-6"
      />
    </main>
  );
}
