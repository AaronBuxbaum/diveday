import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { pagedCourses, setCourseVisibility } from "@/db/courses";
import { getShopBySlug } from "@/db/shops";
import { CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { publicCoursePath } from "@/lib/public-routes";
import { requireStaffSession } from "@/lib/session";

// Not a TODO. The shop layout above already permits this route's blocking
// prerender (`isPageAllowedToBlock` reads only the outermost `instant`), so what
// this line still buys is keeping the page segment out of dev-time instant
// validation — which nothing above a page segment can do.
// See ADR 20260803-instant-opt-out-placement.
export const instant = false;

export const metadata: Metadata = {
  title: "Courses — DiveDay",
};

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
 * The staff course roster: every course including the hidden ones, with the
 * visibility toggle, the editor, and a link out to each course's live public
 * page. Staff-only, like everything else under `/shop/**` — the diver-facing
 * catalog is `/s/[shopSlug]/courses`, which this page used to render as its
 * other half behind a session check (ADR 20260803-public-shop-namespace).
 */
export default async function CoursesPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ after?: string }>;
}) {
  await connection(); // visibility can change between requests — render per request
  await requireStaffSession();
  const { shopSlug } = await params;
  const { after } = await searchParams;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) notFound();

  const locale = await requestLocale(shop.defaultLocale);
  const st = staffTranslator(locale);

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
              {/* The one staff link that now leaves /shop: this is the page a
                  diver sees, so it points at the public namespace. */}
              <Link
                href={publicCoursePath(shop.slug, course.slug)}
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
