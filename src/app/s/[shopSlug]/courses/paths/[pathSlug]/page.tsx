import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { getCoursePathBySlug } from "@/db/course-paths";
import { getShopBySlug } from "@/db/shops";
import { requestTranslator } from "@/i18n/request";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import { publicCoursePath, publicCoursePathPath, publicCoursePathsPath } from "@/lib/public-routes";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/** Title, description, and canonical URL for the public path page. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ shopSlug: string; pathSlug: string }>;
}): Promise<Metadata> {
  const { shopSlug, pathSlug } = await params;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  const path = shop ? await getCoursePathBySlug(db, shop.id, pathSlug) : null;
  if (!shop || !path) return { title: "Certification path — DiveDay" };
  // A hidden path 404s in the page body for anyone but this shop's own staff
  // — metadata must refuse it the same way, since Next resolves
  // `generateMetadata` independently of that later `notFound()` and would
  // otherwise leak the title/summary into the anonymous <head>.
  const session = await auth();
  const staffPreview = session?.user?.shopId === shop.id && isStaff(session.user.roles);
  if (!path.isActive && !staffPreview) return { title: "Certification path — DiveDay" };
  const canonical = publicCoursePathPath(shop.slug, path.slug);
  const title = `${path.title} — ${shop.name}`;
  const description = path.summary ?? undefined;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical },
  };
}

/**
 * A single certification path as a diver reads it. The builder — reorder,
 * rename, hide, delete — is a staff surface at
 * `/shop/[shopSlug]/courses/paths/[pathSlug]` (ADR
 * 20260803-public-shop-namespace). A hidden path still 404s for everyone but
 * this shop's own staff, who reach this URL as the builder's preview: the same
 * "preview, not a public document" rule `courses/[slug]/page.tsx` applies to a
 * hidden course.
 */
export default async function PublicCoursePathPage({
  params,
}: {
  params: Promise<{ shopSlug: string; pathSlug: string }>;
}) {
  await connection(); // visibility can change between requests — render per request
  const { shopSlug, pathSlug } = await params;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) notFound();
  const path = await getCoursePathBySlug(db, shop.id, pathSlug);
  if (!path) notFound();

  const session = await auth();
  const staffPreview = session?.user?.shopId === shop.id && isStaff(session.user.roles);
  if (!path.isActive && !staffPreview) notFound();

  const { t } = await requestTranslator(shop.defaultLocale);

  // A hidden course's rung outlives the shop offering it — never name it on
  // a page an anonymous diver can read, the same discipline
  // `courses/[slug]/page.tsx`'s CoursePathTrail already applies.
  const visibleSteps = path.steps.filter((step) => step.course.isActive);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("coursePaths.page.eyebrow")}
        title={path.title}
        description={path.summary ?? undefined}
        actions={
          <Link
            href={publicCoursePathsPath(shopSlug)}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("coursePaths.page.backToPaths")}
          </Link>
        }
      />

      <section aria-labelledby="path-steps">
        <h2 id="path-steps" className="text-lg font-semibold">
          {t("coursePaths.page.stepsHeading")}
        </h2>
        {visibleSteps.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t("coursePaths.page.noStepsBody")}</p>
        ) : (
          <ol className="mt-4 flex flex-col gap-3">
            {visibleSteps.map((step, index) => (
              <li key={step.id} className="rounded-2xl border border-border bg-surface p-5">
                <p className="text-xs font-semibold tracking-wide text-muted uppercase">
                  {index + 1}
                </p>
                <Link
                  href={publicCoursePath(shopSlug, step.course.slug)}
                  className="font-semibold text-foreground hover:text-primary"
                >
                  {step.course.title}
                </Link>
                {step.note ? <p className="mt-1 text-sm text-muted">{step.note}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
