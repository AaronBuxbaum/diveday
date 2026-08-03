import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EmptyState } from "@/components/EmptyState";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { listCoursePaths } from "@/db/course-paths";
import { getShopBySlug } from "@/db/shops";
import { requestTranslator } from "@/i18n/request";
import {
  publicCoursePathPath,
  publicCoursePathsPath,
  publicCoursesPath,
} from "@/lib/public-routes";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/** Per-shop title, description, and canonical URL for the public paths index. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}): Promise<Metadata> {
  const { shopSlug } = await params;
  const shop = await getShopBySlug(await getDb(), shopSlug);
  if (!shop) return { title: "Certification paths — DiveDay" };
  const { t } = await requestTranslator(shop.defaultLocale);
  const description = t("coursePaths.index.description");
  const canonical = publicCoursePathsPath(shop.slug);
  return {
    title: `Certification paths — ${shop.name}`,
    description,
    alternates: { canonical },
    openGraph: { title: `Certification paths — ${shop.name}`, description, url: canonical },
  };
}

/**
 * Certification paths — the shop's own guidance on what to take next, never a
 * gate (each course states its own admission on its own page). Active paths
 * only; the builder that creates, reorders, hides, and deletes them is a staff
 * surface at `/shop/[shopSlug]/courses/paths` (ADR
 * 20260803-public-shop-namespace).
 */
export default async function PublicCoursePathsPage({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}) {
  await connection(); // visibility can change between requests — render per request
  const { shopSlug } = await params;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) notFound();

  const { t } = await requestTranslator(shop.defaultLocale);
  const paths = await listCoursePaths(db, shop.id, { activeOnly: true });

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("coursePaths.index.eyebrow")}
        title={t("coursePaths.index.title")}
        description={t("coursePaths.index.description")}
        actions={
          <Link
            href={publicCoursesPath(shopSlug)}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("coursePaths.index.backToCourses")}
          </Link>
        }
      />

      {paths.length === 0 ? (
        <EmptyState>
          <h2 className="font-medium">{t("coursePaths.index.noPathsHeading")}</h2>
          <p className="mt-1 text-sm text-muted">{t("coursePaths.index.noPathsBody")}</p>
        </EmptyState>
      ) : (
        <ul className="mt-8 flex flex-col gap-3">
          {paths.map((path) => {
            // A path may outlive a course the shop stopped offering — never
            // name a hidden course in a listing an anonymous diver can read.
            const visibleSteps = path.steps.filter((step) => step.course.isActive);
            return (
              <li key={path.id}>
                <Link
                  href={publicCoursePathPath(shopSlug, path.slug)}
                  className="group card-scale-hint block rounded-2xl border border-border bg-surface p-5 shadow-sm transition-all duration-200 hover:border-primary/40"
                >
                  <h2 className="font-medium group-hover:text-primary">{path.title}</h2>
                  {path.summary ? <p className="mt-1 text-sm text-muted">{path.summary}</p> : null}
                  {visibleSteps.length > 0 ? (
                    <p className="mt-2 text-sm text-muted">
                      {visibleSteps.map((step) => step.course.title).join(" → ")}
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
