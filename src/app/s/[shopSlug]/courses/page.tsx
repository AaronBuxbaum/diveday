import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AgencyTabs } from "@/components/AgencyTabs";
import { EmptyState } from "@/components/EmptyState";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { getDb } from "@/db/client";
import { activeCourseAgencies, listActiveCourses } from "@/db/courses";
import { getShopBySlug } from "@/db/shops";
import { DIVER_CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { requestTranslator } from "@/i18n/request";
import { courseDepthFormat } from "@/i18n/unit-labels";
import { courseTotalCents, resolveCourseContentDepths } from "@/lib/courses";
import { formatMoneyScanned } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { publicCoursePath, publicCoursesPath } from "@/lib/public-routes";
import { openGraphSite, shopSearchListingRobots } from "@/lib/site-metadata";

// `instant = true`: this route has a real static shell. Every request-scoped
// read below sits inside this segment's `loading.tsx` boundary, so the frame
// paints without waiting on the request and the data streams into it —
// and `next build` fails if that ever stops being true.
// See ADR 20260804-instant-navigation.
export const instant = true;

/** Per-shop title, description, and canonical URL for the public catalog. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}): Promise<Metadata> {
  const { shopSlug } = await params;
  const shop = await getShopBySlug(await getDb(), shopSlug);
  if (!shop) return { title: "Courses — DiveDay" };
  const { t } = await requestTranslator(shop.defaultLocale);
  const description = t("courses.index.description");
  const canonical = publicCoursesPath(shop.slug);
  return {
    title: `Courses — ${shop.name}`,
    description,
    alternates: { canonical },
    robots: shopSearchListingRobots(shop.searchListingOptOutAt),
    openGraph: { ...openGraphSite, title: `Courses — ${shop.name}`, description, url: canonical },
  };
}

/**
 * The diver-facing course catalog — active courses only, every visitor sees
 * the same page. The staff roster (hidden courses, visibility toggles, edit
 * links) is its own surface at `/shop/[shopSlug]/courses`; this page used to be
 * that page's other half, chosen by a session check on a URL inside the staff
 * namespace (ADR 20260803-public-shop-namespace).
 */
export default async function PublicCoursesPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ agency?: string }>;
}) {
  await connection(); // visibility can change between requests — render per request
  const { shopSlug } = await params;
  const { agency } = await searchParams;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) notFound();

  const { locale, t } = await requestTranslator(shop.defaultLocale);
  const agencies = await activeCourseAgencies(db, shop.id);
  // An unknown `?agency=` reads as the shop's first agency rather than as an
  // empty catalog — the value is attacker- (and typo-) supplied on a public
  // page, and a catalog that silently shows nothing is indistinguishable from
  // a shop that teaches nothing. Null only when the shop publishes no courses
  // at all; there is no unfiltered view (see `AgencyTabs`).
  const requestedAgency = agency?.trim().toLowerCase();
  const selectedAgency =
    requestedAgency && agencies.includes(requestedAgency) ? requestedAgency : (agencies[0] ?? null);
  // `{depth18}` markers in the shop's own prose resolve into the shop's unit
  // before anything on this page reads a field — the same one-shot pass the
  // course page itself makes (src/lib/courses.ts).
  const depthFormat = courseDepthFormat(t, shop.depthUnit);
  const courseList = (
    await listActiveCourses(db, shop.id, {
      ...(selectedAgency ? { agency: selectedAgency } : {}),
    })
  ).map((course) => resolveCourseContentDepths(course, depthFormat));
  const currency = toShopCurrency(shop.currency);
  // The shop's first agency keeps the bare URL canonical, so the page a diver
  // lands on and the page a search engine indexes are the same one.
  const base = publicCoursesPath(shopSlug);
  const agencyHref = (target: string) =>
    target === agencies[0] ? base : `${base}?agency=${encodeURIComponent(target)}`;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("courses.index.eyebrow")}
        title={t("courses.index.title")}
        description={t("courses.index.description")}
      />

      {/* Which ladder a diver is reading. It replaces the per-row agency pill
          below, for the reason the staff roster dropped its own: a badge on
          every row spent visual weight repeating one of two answers, and
          answered "which agency?" without offering the action that always
          follows it. */}
      <AgencyTabs
        agencies={agencies}
        current={selectedAgency}
        hrefFor={agencyHref}
        copy={{ label: t("courses.index.agencyTabsLabel") }}
      />

      {courseList.length === 0 ? (
        <EmptyState
          title={t("courses.index.noCoursesHeading")}
          body={t("courses.index.noCoursesBody")}
        />
      ) : (
        // The ladder, not a card pile: one agency's courses in progression
        // order read as a single hairline ledger, and row ink is spent only on
        // what differs between rungs — the name, the pitch, the time it takes,
        // the card it requires, the price (design principle 9). A course with
        // no prerequisite says nothing about prerequisites: "None" is not a
        // status, and on this list "no certification required" was rendering
        // on almost every row.
        <ul className="mt-8 divide-y divide-border border-y border-border">
          {courseList.map((course) => {
            const totalCents = courseTotalCents(course);
            const detailLine = [
              course.durationText,
              course.minimumCertificationLevel
                ? t("courses.index.requires", {
                    level: t(DIVER_CERTIFICATION_LEVEL_KEYS[course.minimumCertificationLevel]),
                  })
                : null,
            ].filter((part): part is string => Boolean(part));
            return (
              <li key={course.id}>
                <Link
                  href={publicCoursePath(shopSlug, course.slug)}
                  className="group -mx-3 flex flex-col gap-2 rounded-2xl px-3 py-5 transition-colors hover:bg-surface-sunken sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
                >
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold group-hover:text-primary">
                      {course.title}
                    </h2>
                    {course.summary ? (
                      <p className="mt-1 max-w-xl text-sm text-muted">{course.summary}</p>
                    ) : null}
                    {detailLine.length > 0 ? (
                      <p className="mt-2 text-sm text-muted">{detailLine.join(" · ")}</p>
                    ) : null}
                  </div>
                  {totalCents !== null ? (
                    <p className="shrink-0 text-base font-semibold tabular-nums">
                      {formatMoneyScanned(totalCents, currency, locale)}
                    </p>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
