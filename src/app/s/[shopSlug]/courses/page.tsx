import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EmptyState } from "@/components/EmptyState";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { getDb } from "@/db/client";
import { listActiveCourses } from "@/db/courses";
import { getShopBySlug } from "@/db/shops";
import { DIVER_CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { requestTranslator } from "@/i18n/request";
import { courseTotalCents } from "@/lib/courses";
import { formatMoneyCents } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { publicCoursePath, publicCoursePathsPath, publicCoursesPath } from "@/lib/public-routes";

// Not a TODO. The shop layout above already permits this route's blocking
// prerender (`isPageAllowedToBlock` reads only the outermost `instant`), so what
// this line still buys is keeping the page segment out of dev-time instant
// validation — which nothing above a page segment can do.
// See ADR 20260803-instant-opt-out-placement.
export const instant = false;

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
    openGraph: { title: `Courses — ${shop.name}`, description, url: canonical },
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
}: {
  params: Promise<{ shopSlug: string }>;
}) {
  await connection(); // visibility can change between requests — render per request
  const { shopSlug } = await params;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) notFound();

  const { locale, t } = await requestTranslator(shop.defaultLocale);
  const courseList = await listActiveCourses(db, shop.id);
  const currency = toShopCurrency(shop.currency);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("courses.index.eyebrow")}
        title={t("courses.index.title")}
        description={t("courses.index.description")}
      />

      {courseList.length === 0 ? (
        <EmptyState>
          <h2 className="font-medium">{t("courses.index.noCoursesHeading")}</h2>
          <p className="mt-1 text-sm text-muted">{t("courses.index.noCoursesBody")}</p>
        </EmptyState>
      ) : (
        <ul className="mt-8 flex flex-col gap-3">
          {courseList.map((course) => {
            const totalCents = courseTotalCents(course);
            return (
              <li key={course.id}>
                <Link
                  href={publicCoursePath(shopSlug, course.slug)}
                  className="group card-scale-hint flex flex-col gap-2 rounded-2xl border border-border bg-surface p-5 shadow-sm transition-all duration-200 hover:border-primary/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <h2 className="font-medium group-hover:text-primary">{course.title}</h2>
                      <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-semibold tracking-wider text-muted uppercase">
                        {course.agency}
                      </span>
                    </span>
                    {course.summary ? (
                      <p className="mt-1 text-sm text-muted">{course.summary}</p>
                    ) : null}
                    <p className="mt-1 text-sm text-muted">
                      {course.minimumCertificationLevel
                        ? t("course.certificationOrHigher", {
                            level: t(
                              DIVER_CERTIFICATION_LEVEL_KEYS[course.minimumCertificationLevel],
                            ),
                          })
                        : t("course.noCertification")}
                    </p>
                  </div>
                  {totalCents !== null ? (
                    <p className="shrink-0 text-sm font-semibold tabular-nums">
                      {formatMoneyCents(totalCents, currency, locale)}
                    </p>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-8 text-sm">
        <Link
          href={publicCoursePathsPath(shopSlug)}
          className="font-medium text-primary hover:underline"
        >
          {t("courses.index.pathsLink")}
        </Link>
      </p>
    </main>
  );
}
