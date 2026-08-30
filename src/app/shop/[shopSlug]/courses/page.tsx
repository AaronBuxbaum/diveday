import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EmptyState } from "@/components/EmptyState";
import { Pager } from "@/components/Pager";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { canPersonConfigureTrips } from "@/db/authz";
import { getDb } from "@/db/client";
import { pagedCourses, setCourseVisibility } from "@/db/courses";
import { getShopBySlug } from "@/db/shops";
import { CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatMoneyScanned } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { publicCoursesPath } from "@/lib/public-routes";
import { requireStaffSession } from "@/lib/session";
import { CourseRoster, type CourseRosterRow } from "./_components/CourseRoster";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Courses — DiveDay",
};

/**
 * The staff course roster: every course including the hidden ones, as one
 * ledger grouped by agency (ADR 20260827-the-shops-shelves, decision 1 — the
 * library pattern). Each row opens its course's editor; the two list-level
 * acts (Schedule, Hide/Show) ride the row, and the header holds the one door
 * to the diver-facing catalog. Staff-only, like everything else under
 * `/shop/**` — that catalog is `/s/[shopSlug]/courses`, which this page used
 * to render as its other half behind a session check (ADR
 * 20260803-public-shop-namespace).
 *
 * The `?agency=` tab strip retired with the grouping: it showed one agency at
 * a time, so a shop teaching two ladders could not see its catalog, and each
 * tab paged separately. Agency is a fact every row in a run shares, and a
 * shared fact belongs to the group header.
 */
export default async function CoursesPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  await connection(); // visibility can change between requests — render per request
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { page } = await searchParams;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) notFound();
  // This page is the one staff surface that resolves its shop from the URL slug
  // rather than from `session.user.shopId`, and it then hands that URL-supplied
  // `shop.id` to a permission check joined against the *session's* personId. The
  // cross-tenant refusal in this segment's `layout.tsx` already covers the case,
  // but the outer wall is never allowed to be the only layer (ADR-0006, quoted
  // atop src/lib/authz.ts) — a layout is one refactor away from not running
  // before its page. For a staffer on their own shop the two ids are equal and
  // nothing below changes.
  if (shop.id !== session.user.shopId) notFound();

  const locale = await requestLocale(shop.defaultLocale);
  const st = staffTranslator(locale);

  // No redirect: the badge and the act's own verb already show the new state
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

  // A non-numeric or missing `?page=` reads as page 1; the query clamps it into
  // range so a bookmarked page past the end lands on the last real one. The
  // rows arrive agency-major, then in progression order — the sort the ledger's
  // groups are cut from.
  const coursePage = await pagedCourses(db, shop.id, {
    page: Number.parseInt(page ?? "", 10),
  });
  const courseList = coursePage.courses;
  // Scheduling is owner/manager/instructor work, so the button is absent — not
  // disabled — for anyone else (AGENTS.md: gate by not rendering). The
  // new-trip page re-checks against live roles either way.
  const canSchedule = await canPersonConfigureTrips(db, shop.id, session.user.personId);
  const base = `/shop/${shopSlug}/courses`;
  const pageHref = (target: number) => (target > 1 ? `${base}?page=${target}` : base);

  /**
   * The row's quiet line: who it is open to, how long it runs, what it costs.
   *
   * Duration is the shop's own words (`duration_text`); the price is a figure
   * a reader is *scanning* rather than reconciling, so it drops the `.00` that
   * would otherwise repeat down every row (`formatMoneyScanned`). Either can
   * be missing — a course a shop has not priced yet says nothing about price
   * rather than saying nothing at all.
   */
  const metaLine = (course: (typeof courseList)[number]) =>
    [
      course.minimumCertificationLevel
        ? st("courses.list.orHigher", {
            level: st(CERTIFICATION_LEVEL_KEYS[course.minimumCertificationLevel]),
          })
        : st("courses.list.openToUncertified"),
      course.durationText?.trim() || null,
      course.priceCents === null
        ? null
        : formatMoneyScanned(course.priceCents, toShopCurrency(shop.currency), locale),
    ]
      .filter(Boolean)
      .join(" · ");

  const rows: CourseRosterRow[] = courseList.map((course) => ({
    id: course.id,
    agency: course.agency,
    title: course.title,
    href: `/shop/${shop.slug}/courses/${course.slug}/edit`,
    linkLabel: st("courses.list.editSrLabel", { title: course.title }),
    meta: <span className="tabular-nums">{metaLine(course)}</span>,
    ...(course.isActive ? {} : { hiddenLabel: st("courses.list.hidden") }),
    actions: (
      <div className="flex max-w-full flex-wrap items-center gap-1">
        {/* The catalog's whole point is that a course gets taught. This hands
            the board's add panel (`?course=` opens it with the course
            preselected and shapes the title) the one fact staff would
            otherwise re-pick from a dropdown — never a second trip-creation
            path of its own. */}
        {canSchedule ? (
          <Link
            href={`/shop/${shopSlug}/schedule/board?course=${course.id}`}
            aria-label={st("courses.list.scheduleSrLabel", { title: course.title })}
            className={buttonClass({ variant: "ghost", size: "sm" })}
          >
            {st("courses.list.schedule")}
          </Link>
        ) : null}
        <form action={visibilityAction}>
          <input type="hidden" name="courseId" value={course.id} />
          <input type="hidden" name="visible" value={course.isActive ? "false" : "true"} />
          <SubmitButton
            pendingLabel="…"
            ariaLabel={st("courses.list.hideShowSrLabel", {
              action: course.isActive ? st("courses.list.hide") : st("courses.list.show"),
              title: course.title,
            })}
            className={buttonClass({ variant: "ghost", size: "sm" })}
          >
            {course.isActive ? st("courses.list.hide") : st("courses.list.show")}
          </SubmitButton>
        </form>
      </div>
    ),
  }));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={st("courses.list.eyebrow")}
        title={st("courses.list.title")}
        description={st("courses.list.description")}
        actions={
          // The one door to the catalog a diver sees — replacing the
          // arrow-out-of-a-box icon every row used to carry. "How does my
          // catalog read to a diver?" is a question about the catalog, so its
          // answer lives once, up here (the same door Reviews and the board
          // wear); "how does *this course's* page read?" is answered on the
          // course's own editor, whose header names its live URL.
          <Link
            href={publicCoursesPath(shop.slug)}
            className={buttonClass({ variant: "secondary" })}
          >
            {st("courses.list.viewPublicPage")}
          </Link>
        }
      />

      {courseList.length === 0 ? (
        // The roster used to render its card shell around nothing, giving a
        // shop with no courses an empty box and no sentence. The door is the
        // same act every row carries: a catalog exists to be taught, and a
        // shop with nothing in it can still put a departure on the board.
        <EmptyState
          title={st("courses.list.emptyTitle")}
          body={st("courses.list.emptyBody")}
          action={
            canSchedule ? (
              <Link
                href={`/shop/${shopSlug}/schedule/board`}
                className={buttonClass({ variant: "secondary", size: "sm", className: "mt-4" })}
              >
                {st("courses.list.emptyAction")}
              </Link>
            ) : null
          }
          className="mt-6"
        />
      ) : (
        <CourseRoster rows={rows} className="mt-8" />
      )}
      <Pager
        page={coursePage.page}
        pageCount={coursePage.pageCount}
        href={pageHref}
        total={st("courses.list.pagination.total", { count: coursePage.total })}
        t={st}
        className="mt-6"
      />
    </main>
  );
}
