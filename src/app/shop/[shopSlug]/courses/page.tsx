import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EmptyState } from "@/components/EmptyState";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { listActiveCourses, pagedCourses, setCourseVisibility } from "@/db/courses";
import { getShopBySlug } from "@/db/shops";
import { CERTIFICATION_LEVEL_KEYS, DIVER_CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { requestTranslator } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import { courseTotalCents } from "@/lib/courses";
import { formatMoneyCents } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { requireStaffSession } from "@/lib/session";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/** A closed eye — shown for a course currently hidden from scheduling lists. */
function EyeOffIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <path d="M9.88 4.24A9.9 9.9 0 0 1 12 4c5 0 9.27 3.11 11 7.5a12.4 12.4 0 0 1-2.16 3.19M6.61 6.61A12.5 12.5 0 0 0 1 11.5c1.73 4.39 6 7.5 11 7.5a9.9 9.9 0 0 0 3.39-.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m3 3 18 18" />
    </svg>
  );
}

/** An open eye — shown for a course currently visible in scheduling lists. */
function EyeIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** A chain link — shown next to the eye toggle to jump to the course's live preview page. */
function LinkIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <path d="M9 17H7a5 5 0 0 1 0-10h2" />
      <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
      <path d="M8 12h8" />
    </svg>
  );
}

/**
 * Per-shop title, description, and canonical URL for the public catalog.
 * Diver copy only — a staff visitor sees the same `<head>`, which is fine
 * since the catalog's existence isn't a secret, only the editor beneath it.
 */
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
  return {
    title: `Courses — ${shop.name}`,
    description,
    alternates: { canonical: `/shop/${shop.slug}/courses` },
    openGraph: { title: `Courses — ${shop.name}`, description, url: `/shop/${shop.slug}/courses` },
  };
}

/**
 * The course catalog. Auth-exempt in src/lib/auth.config.ts (`COURSES_INDEX`)
 * for a signed-out diver browsing active courses; a signed-in staff member of
 * this same shop instead gets the full roster with edit/visibility controls,
 * the way `schedule/page.tsx` and `courses/[slug]/page.tsx` already split.
 * The shop always resolves from the URL slug, never the session, so a
 * signed-in staff member from a different shop still gets the public view.
 */
export default async function CoursesPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ after?: string }>;
}) {
  await connection(); // visibility can change between requests — render per request
  const { shopSlug } = await params;
  const { after } = await searchParams;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) notFound();

  const session = await auth();
  const staffView = session?.user?.shopId === shop.id && isStaff(session.user.roles);

  const { locale, t } = await requestTranslator(shop.defaultLocale);

  // No redirect: the icon and the "Hidden" badge already show the new state
  // in place, and a same-page redirect after a form submit resets scroll to
  // the top, which reads as the page jumping for a one-click toggle.
  async function visibilityAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const courseId = String(formData.get("courseId") ?? "");
    const visible = formData.get("visible") === "true";
    if (courseId) await setCourseVisibility(await getDb(), staff.user.shopId, courseId, visible);
    revalidatePath(`/shop/${staff.user.shopSlug}/courses`);
  }

  if (staffView) {
    const st = staffTranslator(locale);
    const { courses: courseList, nextCursor } = await pagedCourses(db, shop.id, { cursor: after });
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <ShopPageHeader
          eyebrow={st("courses.list.eyebrow")}
          title={st("courses.list.title")}
          description={st("courses.list.description")}
          actions={
            <Link
              href={`/shop/${shopSlug}/courses/paths`}
              className={buttonClass({ variant: "secondary" })}
            >
              {st("courses.list.certificationPaths")}
            </Link>
          }
        />

        <ul className="mt-8 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
          {courseList.map((course) => (
            <li
              key={course.id}
              className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-4 sm:px-5 ${
                course.isActive ? "" : "text-muted"
              }`}
            >
              <div className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-foreground">{course.title}</span>
                  <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-semibold tracking-wider text-muted uppercase">
                    {course.agency}
                  </span>
                  {course.isActive ? null : (
                    <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-muted">
                      {st("courses.list.hidden")}
                    </span>
                  )}
                </span>
                <p className="mt-1 text-sm text-muted">
                  {course.minimumCertificationLevel
                    ? st("courses.list.orHigher", {
                        level: st(CERTIFICATION_LEVEL_KEYS[course.minimumCertificationLevel]),
                      })
                    : st("courses.list.openToUncertified")}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Link
                  href={`/shop/${shop.slug}/courses/${course.slug}/edit`}
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  {st("courses.list.edit")}
                </Link>
                <form action={visibilityAction}>
                  <input type="hidden" name="courseId" value={course.id} />
                  <input type="hidden" name="visible" value={course.isActive ? "false" : "true"} />
                  <SubmitButton
                    pendingLabel="…"
                    className={buttonClass({ variant: "ghost", size: "sm", className: "px-2" })}
                  >
                    {course.isActive ? <EyeIcon /> : <EyeOffIcon />}
                    <span className="sr-only">
                      {st("courses.list.hideShowSrLabel", {
                        action: course.isActive ? st("courses.list.hide") : st("courses.list.show"),
                        title: course.title,
                      })}
                    </span>
                  </SubmitButton>
                </form>
                <Link
                  href={`/shop/${shop.slug}/courses/${course.slug}`}
                  className={buttonClass({ variant: "ghost", size: "sm", className: "px-2" })}
                >
                  <LinkIcon />
                  <span className="sr-only">
                    {st("courses.list.previewSrLabel", { title: course.title })}
                  </span>
                </Link>
              </div>
            </li>
          ))}
        </ul>
        {nextCursor || after ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {nextCursor ? (
              <Link
                href={`/shop/${shopSlug}/courses?after=${nextCursor}`}
                className={buttonClass({ variant: "secondary" })}
              >
                {st("courses.list.showMore")}
              </Link>
            ) : null}
            {after ? (
              <Link
                href={`/shop/${shopSlug}/courses`}
                className="text-sm font-medium text-primary hover:underline"
              >
                {st("courses.list.backToTop")}
              </Link>
            ) : null}
          </div>
        ) : null}
      </main>
    );
  }

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
                  href={`/shop/${shopSlug}/courses/${course.slug}`}
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
          href={`/shop/${shopSlug}/courses/paths`}
          className="font-medium text-primary hover:underline"
        >
          {t("courses.index.pathsLink")}
        </Link>
      </p>
    </main>
  );
}
