import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
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
import { publicCoursePath } from "@/lib/public-routes";
import { requireStaffSession } from "@/lib/session";
import { AgencyTabs } from "./_components/AgencyTabs";

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

/** A calendar with a plus — schedules a session of this course. */
function CalendarPlusIcon() {
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
      <path d="M8 2v4M16 2v4M3 10h18" />
      <path d="M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7" />
      <path d="M16 19h6M19 16v6" />
    </svg>
  );
}

/**
 * An arrow leaving a frame — shown next to the eye toggle to open the course's
 * live public page.
 *
 * Not the chain link this used to be. A chain link is the web's mark for *the
 * address of this thing*, and beside a "hide/show" toggle staff read it as the
 * control that copies the URL to send a diver — which is not what it does. An
 * arrow out of a box is the mark for "this opens the page", which is.
 */
function OpenPageIcon() {
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
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
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
  searchParams: Promise<{ page?: string; agency?: string }>;
}) {
  await connection(); // visibility can change between requests — render per request
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { page, agency } = await searchParams;
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
      />

      <AgencyTabs
        agencies={agencies}
        current={selectedAgency}
        hrefFor={agencyHref}
        copy={{ label: st("courses.list.agencyTabsLabel") }}
      />

      {/* Progression order, not alphabetical: the list reads the way a shop
          teaches — a taster, then the entry certification, then everything it
          opens (src/db/courses.ts `progressionOrder`). */}
      <ul className="mt-6 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
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
              {/* The catalog's whole point is that a course gets taught. This
                  hands the board's add panel (`?course=` opens it with the
                  course preselected and shapes the title) the one fact staff
                  would otherwise re-pick from a dropdown — never a second
                  trip-creation path of its own. */}
              {canSchedule ? (
                <Link
                  href={`/shop/${shopSlug}/schedule/board?course=${course.id}`}
                  className={buttonClass({ variant: "ghost", size: "sm", className: "px-2" })}
                >
                  <CalendarPlusIcon />
                  <span className="sr-only">
                    {st("courses.list.scheduleSrLabel", { title: course.title })}
                  </span>
                </Link>
              ) : null}
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
                <OpenPageIcon />
                <span className="sr-only">
                  {st("courses.list.previewSrLabel", { title: course.title })}
                </span>
              </Link>
            </div>
          </li>
        ))}
      </ul>
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
