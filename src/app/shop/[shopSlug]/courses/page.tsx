import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AgencyTabs } from "@/components/AgencyTabs";
import { EmptyState } from "@/components/EmptyState";
import { Pager } from "@/components/Pager";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { canPersonConfigureTrips } from "@/db/authz";
import { getDb } from "@/db/client";
import { courseAgencies, pagedCourses, setCourseVisibility } from "@/db/courses";
import { getShopBySlug } from "@/db/shops";
import { CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { publicCoursesPath } from "@/lib/public-routes";
import { requireStaffSession } from "@/lib/session";

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
 * The staff course roster: every course including the hidden ones. Each row
 * opens its course's editor; the rail carries only the two list-level acts
 * (Schedule, Hide/Show), and the header holds the one door to the diver-facing
 * catalog. Staff-only, like everything else under `/shop/**` — that catalog is
 * `/s/[shopSlug]/courses`, which this page used to render as its other half
 * behind a session check (ADR 20260803-public-shop-namespace).
 */
export default async function CoursesPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ page?: string; agency?: string }>;
}) {
  await connection(); // visibility can change between requests — render per request
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { page, agency } = await searchParams;
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

  const agencies = await courseAgencies(db, shop.id);
  // An unknown `?agency=` reads as the first agency rather than as an empty
  // catalog: the value is attacker- (and typo-) supplied, and a roster that
  // silently shows nothing is indistinguishable from a shop that has no
  // courses. Null only when the shop has no courses at all — there is no
  // unfiltered view any more (see `AgencyTabs`).
  const selectedAgency = agency && agencies.includes(agency) ? agency : (agencies[0] ?? null);

  // A non-numeric or missing `?page=` reads as page 1; the query clamps it into
  // range so a bookmarked page past the end lands on the last real one.
  const coursePage = await pagedCourses(db, shop.id, {
    page: Number.parseInt(page ?? "", 10),
    ...(selectedAgency ? { agency: selectedAgency } : {}),
  });
  const courseList = coursePage.courses;
  // Scheduling is owner/manager/instructor work, so the button is absent — not
  // disabled — for anyone else (AGENTS.md: gate by not rendering). The
  // new-trip page re-checks against live roles either way.
  const canSchedule = await canPersonConfigureTrips(db, shop.id, session.user.personId);
  const base = `/shop/${shopSlug}/courses`;
  const withParams = (params: Record<string, string>) => {
    const query = new URLSearchParams(params).toString();
    return query ? `${base}?${query}` : base;
  };
  // A tab change drops `?page=`: page 3 of one agency's ladder is rarely page 3
  // of another's, and landing on an empty page reads as a broken tab. The
  // shop's first agency is the default, so its tab keeps the bare URL
  // canonical.
  const agencyHref = (target: string) =>
    withParams(target === agencies[0] ? {} : { agency: target });
  const pageHref = (target: number) =>
    withParams({
      ...(selectedAgency ? { agency: selectedAgency } : {}),
      ...(target > 1 ? { page: String(target) } : {}),
    });
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

      <AgencyTabs
        agencies={agencies}
        current={selectedAgency}
        hrefFor={agencyHref}
        copy={{ label: st("courses.list.agencyTabsLabel") }}
      />

      {/* Progression order, not alphabetical: the list reads the way a shop
          teaches — a taster, then the entry certification, then everything it
          opens (src/db/courses.ts `progressionOrder`).

          The row itself is the door to the course's page — the page's own
          description says what a row is for ("Open a course to edit its page
          and pricing"), so opening it is the row's tap, not one button among
          four. What used to trail every row — Edit, plus three icon-only ghost
          buttons whose names lived in sr-only spans — is down to the two acts
          that are genuinely *list-level* work, each wearing its verb: Schedule
          (a catalog exists to be taught) and Hide/Show (thinning the catalog
          to what the shop offers is a walk down this list, and the roster is
          deliberately the one place visibility changes — the editor's own
          toggle was removed for it). The per-row Preview icon moved onto the
          destination it duplicated: the editor's header names and links the
          course's live URL. */}
      {courseList.length === 0 ? (
        // The roster's shell is a bordered, shadowed card, so rendering it
        // around nothing gave a shop with no courses an empty box and no
        // sentence — the one paged staff list with no empty branch. The door is
        // the same act every row carries: a catalog exists to be taught, and a
        // shop with nothing in it can still put a departure on the board.
        <EmptyState className="mt-6">
          <h2 className="font-medium">{st("courses.list.emptyTitle")}</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">{st("courses.list.emptyBody")}</p>
          {canSchedule ? (
            <Link
              href={`/shop/${shopSlug}/schedule/board`}
              className={buttonClass({ variant: "secondary", size: "sm", className: "mt-4" })}
            >
              {st("courses.list.emptyAction")}
            </Link>
          ) : null}
        </EmptyState>
      ) : (
        <ul className="mt-6 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
          {courseList.map((course) => (
            <li
              key={course.id}
              className={`group relative flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors duration-200 hover:bg-surface-sunken sm:px-5 ${
                course.isActive ? "" : "text-muted"
              }`}
            >
              <div className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  {/* Stretched over the whole row (same grammar as the divers
                    table): the title is the visible name, the label says what
                    the tap does. */}
                  <Link
                    href={`/shop/${shop.slug}/courses/${course.slug}/edit`}
                    aria-label={st("courses.list.editSrLabel", { title: course.title })}
                    className="font-semibold text-foreground after:absolute after:inset-0 group-hover:text-primary focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-primary"
                  >
                    {course.title}
                    {/* The arrow is CSS `content`, not a text node: specs locate
                      this row by the title's exact text, and a DOM arrow would
                      make the link read "Rescue Diver →" to them. */}
                    <span
                      aria-hidden="true"
                      className="ml-1 opacity-0 transition-opacity before:content-['→'] group-hover:opacity-100"
                    />
                  </Link>
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
              {/* Above the stretched link, so the rail's own taps win. */}
              <div className="relative z-10 flex items-center gap-1">
                {/* The catalog's whole point is that a course gets taught. This
                  hands the board's add panel (`?course=` opens it with the
                  course preselected and shapes the title) the one fact staff
                  would otherwise re-pick from a dropdown — never a second
                  trip-creation path of its own. */}
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
            </li>
          ))}
        </ul>
      )}
      <Pager
        page={coursePage.page}
        pageCount={coursePage.pageCount}
        href={pageHref}
        total={st("courses.list.pagination.total", { count: coursePage.total })}
        t={st}
        className="mt-4"
      />
    </main>
  );
}
