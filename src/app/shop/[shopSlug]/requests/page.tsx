import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { Pager } from "@/components/Pager";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { type DateRequestRow, listDateRequestsForStaff } from "@/db/course-inquiries";
import { getShopById } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate } from "@/lib/calendar-date";
import type { CourseInquiryExperience } from "@/lib/course-inquiry";
import { type DateRequestMatch, groupDateRequests } from "@/lib/date-requests";
import { formatShortDate } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";

// `instant = true` asserts that navigating *into* this page paints
// immediately — it is this segment's `loading.tsx` that stands in while the
// request-scoped reads stream, exactly as on every other staff list. See ADR
// 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Requests — DiveDay",
};

/**
 * Where a diver is up to, in staff words. `src/db` returns the code and this
 * picks the sentence (ADR 20260731-domain-layer-copy-leaks).
 */
const EXPERIENCE_KEYS: Record<CourseInquiryExperience, StaffMessageKey> = {
  never: "requests.experience.never",
  tried: "requests.experience.tried",
  certified: "requests.experience.certified",
  lapsed: "requests.experience.lapsed",
};

/**
 * One request, as a card. Rendered inside a date group, so what it says about
 * *this* date — a first choice, a fallback, or a flexible neighbour — comes in
 * as `match` rather than being re-derived from the row.
 */
function RequestCard({
  request,
  match,
  locale,
  timezone,
  shopSlug,
  t,
}: {
  request: DateRequestRow;
  match: DateRequestMatch | null;
  locale: string;
  timezone: string;
  shopSlug: string;
  t: StaffTranslator;
}) {
  // A second choice and a flexible neighbour are both "could come", not "asked
  // for this day", and the whole reason the group's count is safe to read: a
  // group of three with two of these in it is not three firm asks.
  const soft = match === "alternate" || match === "nearby";
  // What this request *did* name, for the badges that explain why it is in a
  // group it did not ask for. A request can carry an alternate and no first
  // choice, so this is the first date it holds rather than `preferredDate`.
  const namedDate = request.preferredDate ?? request.alternateDate;
  return (
    <li
      className={`rounded-2xl border p-4 ${
        soft ? "border-border bg-surface-sunken" : "border-border bg-surface"
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className={soft ? "font-medium text-muted" : "font-semibold"}>
          {request.courseTitle
            ? t("requests.aboutCourse", { course: request.courseTitle })
            : t("requests.aboutDive", { interest: request.interest ?? "" })}
        </p>
        {match === "alternate" && namedDate ? (
          <Badge tone="neutral">
            {t("requests.alternateOf", { date: formatCalendarDate(namedDate, locale) })}
          </Badge>
        ) : null}
        {match === "nearby" && namedDate ? (
          <Badge tone="neutral">
            {t("requests.flexibleAround", { date: formatCalendarDate(namedDate, locale) })}
          </Badge>
        ) : null}
        {match !== "nearby" && request.dateFlexible ? (
          <Badge tone="neutral">{t("requests.flexible")}</Badge>
        ) : null}
      </div>
      <p className="mt-1 text-sm">
        {request.name ?? t("requests.anonymous")}
        {request.email ? (
          <>
            {" · "}
            <a href={`mailto:${request.email}`} className="text-primary hover:underline">
              {request.email}
            </a>
          </>
        ) : null}
        {request.phone ? ` · ${request.phone}` : null}
      </p>
      <p className="mt-1 text-sm text-muted">
        {t(EXPERIENCE_KEYS[request.experienceLevel])}
        {request.divers ? ` · ${t("requests.divers", { count: request.divers })}` : null}
        {` · ${t("requests.askedOn", {
          date: formatShortDate(request.createdAt, locale, timezone),
        })}`}
      </p>
      {request.timing ? (
        <p className="mt-1 text-sm text-muted">
          {t("requests.whenSuits", { timing: request.timing })}
        </p>
      ) : null}
      {request.message ? <p className="mt-2 text-sm text-pretty">{request.message}</p> : null}
      {request.personId ? (
        <Link
          href={`/shop/${shopSlug}/divers/${request.personId}`}
          className="mt-2 inline-block text-sm font-medium text-primary hover:underline"
        >
          {t("requests.viewDiver")}
        </Link>
      ) : null}
    </li>
  );
}

/**
 * Every date a diver asked for that the board has nothing on, grouped by day.
 *
 * The grouping rules are `groupDateRequests` (src/lib/date-requests.ts) and
 * this page adds none of its own: one group per named date, a request in every
 * group it could make, flexible requests travelling to nearby days, and the
 * ones that named no date at all at the foot. What the page contributes is the
 * act at the end of it — each group's own link into the schedule builder,
 * pre-dated, so "four people could make the 12th" ends in a departure on the
 * 12th rather than a note somewhere.
 */
export default async function RequestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { page } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  const locale = await requestLocale(shop?.defaultLocale);
  const timezone = shop?.timezone ?? "UTC";
  const t = staffTranslator(locale);

  // A non-numeric or missing `?page=` reads as page 1; the query clamps it into
  // range, so a bookmarked page past the end lands on the last real one.
  const requestPage = await listDateRequestsForStaff(db, session.user.shopId, {
    page: Number.parseInt(page ?? "", 10),
  });
  const { groups, undated } = groupDateRequests(requestPage.rows, (row) => row);
  const base = `/shop/${shopSlug}/requests`;
  const pageHref = (target: number) => (target > 1 ? `${base}?page=${target}` : base);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("requests.eyebrow")}
        title={t("requests.title")}
        description={t("requests.description")}
      />

      {requestPage.total === 0 ? (
        <EmptyState>
          <h2 className="font-medium">{t("requests.emptyHeading")}</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">{t("requests.emptyDetail")}</p>
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map((group) => (
            <section key={group.date} aria-labelledby={`date-${group.date}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                <div>
                  <h2 id={`date-${group.date}`} className="text-xl font-semibold tracking-tight">
                    {formatCalendarDate(group.date, locale)}
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    {t("requests.couldMake", { count: group.count })}
                    {` · ${t("requests.askedForThisDay", { count: group.firmCount })}`}
                  </p>
                </div>
                {/* The whole point of counting people against a day: the
                    builder opens on that date with the full form already
                    disclosed (ADR 20260806-one-trip-create-form). */}
                <Link
                  href={`/shop/${shopSlug}/schedule/board?add=full&date=${group.date}`}
                  className={buttonClass({
                    variant: "secondary",
                    size: "sm",
                    className: "text-foreground",
                  })}
                >
                  {t("requests.addDeparture")}
                </Link>
              </div>
              <ul className="mt-3 flex flex-col gap-3">
                {group.entries.map((entry) => (
                  <RequestCard
                    key={`${group.date}-${entry.request.id}`}
                    request={entry.request}
                    match={entry.match}
                    locale={locale}
                    timezone={timezone}
                    shopSlug={shopSlug}
                    t={t}
                  />
                ))}
              </ul>
            </section>
          ))}

          {/* Last, always: prose a date field could not hold is still a lead,
              but it is not a day anyone can put a boat on. */}
          {undated.length > 0 ? (
            <section aria-labelledby="no-date">
              <h2 id="no-date" className="text-xl font-semibold tracking-tight">
                {t("requests.noDateHeading")}
              </h2>
              <p className="mt-1 text-sm text-muted">{t("requests.noDateDetail")}</p>
              <ul className="mt-3 flex flex-col gap-3">
                {undated.map((request) => (
                  <RequestCard
                    key={request.id}
                    request={request}
                    match={null}
                    locale={locale}
                    timezone={timezone}
                    shopSlug={shopSlug}
                    t={t}
                  />
                ))}
              </ul>
            </section>
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
