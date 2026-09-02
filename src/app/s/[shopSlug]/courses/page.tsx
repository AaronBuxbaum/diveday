import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AgencyTabs } from "@/components/AgencyTabs";
import { CourseWavePlaceholder } from "@/components/CourseWavePlaceholder";
import { EmptyState } from "@/components/EmptyState";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StoredPhoto } from "@/components/StoredPhoto";
import { GroupLabel } from "@/components/ui/ledger";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
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
import { type CertificationLevel, certificationRank } from "@/lib/readiness";
import { openGraphSite, shopSearchListingRobots } from "@/lib/site-metadata";

// `instant = true`: this route has a real static shell. Every request-scoped
// read below sits inside this segment's `loading.tsx` boundary, so the frame
// paints without waiting on the request and the data streams into it —
// and `next build` fails if that ever stops being true.
// See ADR 20260804-instant-navigation.
export const instant = true;

/**
 * The catalog partitioned by the card each rung requires, groups in rank order
 * (no card first), progression order kept within each group. Grouping is what
 * lets the shared prerequisite live in one header instead of repeating down
 * the rows, and what makes the ladder visible as a ladder.
 */
function certificationGroups<T extends { minimumCertificationLevel: CertificationLevel | null }>(
  courseList: readonly T[],
): { level: CertificationLevel | null; courses: T[] }[] {
  const groups = new Map<CertificationLevel | null, T[]>();
  for (const course of courseList) {
    const key = course.minimumCertificationLevel;
    const group = groups.get(key);
    if (group) group.push(course);
    else groups.set(key, [course]);
  }
  return [...groups.entries()]
    .map(([level, courses]) => ({ level, courses }))
    .sort(
      (a, b) =>
        (a.level ? certificationRank(a.level) : -1) - (b.level ? certificationRank(b.level) : -1),
    );
}

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
      {/* No eyebrow: it read "COURSES" over "Courses" — a caption restating
          its own heading (the public nav already marks Courses current). */}
      <ShopPageHeader
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
        // The ladder, *visibly* a ladder: rungs grouped by the card each one
        // requires, in rank order, so a newcomer can see which rung they are
        // on and what unlocks next. The shared prerequisite is said once in
        // each group's header — "Requires Open Water or higher" used to
        // re-type itself down fourteen of twenty-two rows (principle 9;
        // 2026-08-28 diver-views review, finding 13). Progression order
        // survives within each group.
        certificationGroups(courseList).map(({ level, courses }) => (
          <section key={level ?? "start"} className="mt-8">
            <GroupLabel as="h2">
              {level
                ? t("courses.index.requires", { level: t(DIVER_CERTIFICATION_LEVEL_KEYS[level]) })
                : t("courses.index.groupStart")}
            </GroupLabel>
            <ul className="mt-2 divide-y divide-border border-y border-border">
              {courses.map((course) => {
                const totalCents = courseTotalCents(course);
                return (
                  <li key={course.id}>
                    <Link
                      href={publicCoursePath(shopSlug, course.slug)}
                      className="group -mx-3 flex gap-4 rounded-2xl px-3 py-5 transition-colors hover:bg-surface-sunken"
                    >
                      {/* The course's own face, decorative (`alt=""` — the
                          title beside it names the course). A course with no
                          photo wears the same drawn swell the storefront shelf
                          uses, so the ladder keeps one left edge instead of a
                          ragged mix of indented and flush rows. */}
                      {course.heroImageUrl ? (
                        <StoredPhoto
                          src={course.heroImageUrl}
                          alt=""
                          className="size-16 shrink-0 rounded-xl"
                          sizes="64px"
                        />
                      ) : (
                        <CourseWavePlaceholder className="size-16 shrink-0 rounded-xl" />
                      )}
                      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                        <div className="min-w-0">
                          <h3 className={`${SECTION_TITLE_CLASS} group-hover:text-primary`}>
                            {course.title}
                          </h3>
                          {course.summary ? (
                            <p className="mt-1 max-w-xl text-sm text-muted">{course.summary}</p>
                          ) : null}
                          {course.durationText ? (
                            <p className="mt-2 text-sm text-muted">{course.durationText}</p>
                          ) : null}
                        </div>
                        {totalCents !== null ? (
                          <p className="shrink-0 text-base font-semibold tabular-nums">
                            {formatMoneyScanned(totalCents, currency, locale)}
                          </p>
                        ) : null}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
