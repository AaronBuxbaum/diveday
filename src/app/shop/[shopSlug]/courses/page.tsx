import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { EmptyState } from "@/components/EmptyState";
import { Pager, staffPagerWords } from "@/components/Pager";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { buttonClass } from "@/components/ui/button";
import { type FilterChip, FilterChips } from "@/components/ui/FilterChips";
import { SearchField } from "@/components/ui/form";
import { QueryForm } from "@/components/ui/QueryForm";
import { canPersonConfigureTrips } from "@/db/authz";
import { getDb } from "@/db/client";
import {
  COURSE_LIST_VIEWS,
  type CourseListView,
  courseListViewParam,
  coursesAwaitingFormText,
  pagedCourses,
} from "@/db/courses";
import { getShopBySlug } from "@/db/shops";
import { nextSessionStartByCourse } from "@/db/trips";
import { CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { courseTotalCents } from "@/lib/courses";
import { formatMoneyScanned, formatShortDate, joinFacts } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { publicCoursesPath } from "@/lib/public-routes";
import { requireStaffSession } from "@/lib/session";
import { CourseFollowUps, LadderNotice } from "./_components/CourseFollowUps";
import { CourseRoster, type CourseRosterRow } from "./_components/CourseRoster";

// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Courses — DiveDay",
};

const COURSE_VIEW_KEYS: Record<CourseListView, StaffMessageKey> = {
  scheduled: "courses.list.views.scheduled",
  notYet: "courses.list.views.notYet",
  hidden: "courses.list.hidden",
};

/**
 * The staff course roster: every course including the hidden ones, as one
 * ledger grouped by agency (ADR 20260827-the-shops-shelves, decision 1 — the
 * library pattern). Each row opens its course's editor, whole; Schedule, on a
 * course the shop runs, is a header action on that editor (visual review
 * 2026-10-24, A39), and this header holds the one door to the diver-facing
 * catalog. Hiding a course from that catalog lives on the course's own editor,
 * beside Save: it is a rare act, and 55 standing Hide buttons were 55 controls
 * nobody was reaching for. Staff-only, like everything else under
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
  searchParams: Promise<{ page?: string; q?: string; view?: string; notice?: string }>;
}) {
  await connection(); // visibility can change between requests — render per request
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { page, q, view: viewParam, notice } = await searchParams;
  // **Find a course in one line** (third UX review, item 35): 55 courses over
  // three pages had paging and nothing else.
  const query = q?.trim() ?? "";
  const view = courseListViewParam(viewParam);
  const narrowed = Boolean(query || view);
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

  // A non-numeric or missing `?page=` reads as page 1; the query clamps it into
  // range so a bookmarked page past the end lands on the last real one. The
  // rows arrive agency-major, then in progression order — the sort the ledger's
  // groups are cut from.
  const coursePage = await pagedCourses(db, shop.id, {
    page: Number.parseInt(page ?? "", 10),
    query,
    view,
  });
  const courseList = coursePage.courses;
  // Together rather than in sequence: only the second needs the page of
  // courses, and the permission read does not, so awaiting them one after the
  // other would buy a serial round trip for nothing.
  const [canSchedule, nextSessions, formsAwaitingText] = await Promise.all([
    // Scheduling is owner/manager/instructor work, so the button is absent —
    // not disabled — for anyone else (AGENTS.md: gate by not rendering). The
    // new-trip page re-checks against live roles either way.
    canPersonConfigureTrips(db, shop.id, session.user.personId),
    // **The one live fact on a page of standing ones** (ADR 20260919-one-idea,
    // decision I · Tide, slice 23g — "a course is sessions on days"). Until
    // this, a diver reading `/s/<shop>/courses/<slug>` could see when a course
    // next ran and the shop teaching it could not: the roster said what is
    // taught, never when. One query for the whole page rather than one per row.
    //
    // `"shop"` and not `"storefront"`: a course booked out to one family is
    // scheduled, and the staffer who scheduled it must not read "Not scheduled"
    // on the morning it runs. The storefront's own call stays public-scoped,
    // because a diver cannot turn up to a private session.
    nextSessionStartByCourse(
      db,
      shop.id,
      courseList.map((course) => course.id),
      "shop",
    ),
    // The agency's forms a template set up with no text yet: nobody signs
    // them until the shop pastes the wording in. Said once above the list,
    // shop-wide, with a door to the first (UX review 2026-10-10, item 16);
    // under every row it was the same amber sentence nearly twenty times.
    coursesAwaitingFormText(db, shop.id),
  ]);
  const base = `/shop/${shopSlug}/courses`;
  // The search and the view travel with every page turn and chip.
  const listHref = ({
    target = 1,
    nextView = view,
    keepQuery = true,
  }: {
    target?: number;
    nextView?: CourseListView;
    keepQuery?: boolean;
  }) => {
    const search = new URLSearchParams();
    if (keepQuery && query) search.set("q", query);
    if (nextView) search.set("view", nextView);
    if (target > 1) search.set("page", String(target));
    const encoded = search.toString();
    return encoded ? `${base}?${encoded}` : base;
  };
  const pageHref = (target: number) => listHref({ target });
  const viewChips: FilterChip[] = [
    {
      key: "all",
      label: st("courses.list.views.all"),
      href: listHref({ nextView: undefined }),
      active: !view,
    },
    ...COURSE_LIST_VIEWS.map((key) => ({
      key,
      label: st(COURSE_VIEW_KEYS[key]),
      href: listHref({ nextView: key }),
      active: view === key,
    })),
  ];

  /**
   * The row's quiet line: when it next runs, who it is open to, how long it
   * runs, what it costs.
   *
   * Duration is the shop's own words (`duration_text`); the price is a figure
   * a reader is *scanning* rather than reconciling, so it drops the `.00` that
   * would otherwise repeat down every row (`formatMoneyScanned`). Either can
   * be missing — a course a shop has not priced yet says nothing about price
   * rather than saying nothing at all.
   */
  const nextLine = (course: (typeof courseList)[number]) => {
    const nextStart = nextSessions.get(course.id);
    return nextStart
      ? st("courses.list.nextSession", {
          // The shop's own zone, never the server's: a 7:30 AM session in Key
          // West renders as the previous day in UTC often enough to matter.
          date: formatShortDate(nextStart, locale, shop.timezone),
        })
      : st("courses.list.notScheduled");
  };
  // The course total a diver is charged, fee plus eLearning (fourth UX review,
  // item 26): "$709", as every diver sees it, never the fee alone.
  const priceLine = (course: (typeof courseList)[number]) => {
    const totalCents = courseTotalCents(course);
    return totalCents === null
      ? null
      : formatMoneyScanned(totalCents, toShopCurrency(shop.currency), locale);
  };
  const metaLine = (course: (typeof courseList)[number]) => {
    // `joinFacts`, not `.join(" · ")`: the line wraps only after a separator,
    // never inside "2 dives" or before a lone price.
    return joinFacts([
      // **First, so it is a column rather than a footnote.** It is the one fact
      // on this line that changes, and the reason the roster has a time in it
      // at all; appended last it landed at the end of a wrapped second line at
      // 390, in the same muted grey as the price, and "Not scheduled" read as
      // one more item in a run rather than a gap to act on. Leading with it
      // puts every row's answer at the same x, which is how a list is scanned.
      nextLine(course),
      course.minimumCertificationLevel
        ? st("courses.list.orHigher", {
            level: st(CERTIFICATION_LEVEL_KEYS[course.minimumCertificationLevel]),
          })
        : st("courses.list.openToUncertified"),
      course.durationText?.trim() || null,
      priceLine(course),
    ]);
  };

  const rows: CourseRosterRow[] = courseList.map((course) => ({
    id: course.id,
    agency: course.agency,
    title: course.title,
    href: `/shop/${shop.slug}/courses/${course.slug}/edit`,
    linkLabel: st("courses.list.editSrLabel", { title: course.title }),
    // **A phone reads when it next runs and what it costs**; who it is for
    // and how long it takes are the desktop's scan, and on a phone they ran
    // every one of twenty rows onto a second and third line. The full line
    // leads the markup, so a "first match" reads the desktop's words.
    meta: (
      <>
        <span className="tabular-nums max-sm:hidden">{metaLine(course)}</span>
        <span className="tabular-nums sm:hidden">
          {joinFacts([nextLine(course), priceLine(course)])}
        </span>
      </>
    ),
    ...(course.isActive ? {} : { hiddenLabel: st("courses.list.hidden") }),
  }));

  return (
    <StaffPage width="full">
      <ShopPageHeader
        title={st("courses.list.title")}
        actions={
          // The one door to the catalog a diver sees — replacing the
          // arrow-out-of-a-box icon every row used to carry. "How does my
          // catalog read to a diver?" is a question about the catalog, so its
          // answer lives once, up here (the same door Reviews and the board
          // wear); "how does *this course's* page read?" is answered on the
          // course's own editor, whose header names its live URL.
          <Link
            href={publicCoursesPath(shop.slug)}
            className={buttonClass({ variant: "link", flush: true })}
          >
            {st("courses.list.viewPublicPage")}
          </Link>
        }
      />

      <LadderNotice notice={notice} t={st} />
      {formsAwaitingText[0] ? (
        <ShopNotice tone="warning" className="mt-6">
          {st("courses.list.formsAwaitingTextSummary", { count: formsAwaitingText.length })}
          {/* The editor draws its Forms section only for a staffer who may
              configure courses (`canSetVisibility` there, the same read as
              `canSchedule` here), so the door is theirs alone: anyone else
              would land on an editor with no Forms in it. */}
          {canSchedule ? (
            <>
              {" "}
              <Link
                href={`/shop/${shop.slug}/courses/${formsAwaitingText[0].slug}/edit#forms`}
                className="font-medium underline"
              >
                {st("courses.list.formsAwaitingTextDoor", { title: formsAwaitingText[0].title })}
              </Link>
            </>
          ) : null}
        </ShopNotice>
      ) : null}

      {coursePage.total > 0 || narrowed ? (
        <div className="mt-6 flex flex-col gap-3">
          <QueryForm
            aria-label={st("courses.list.searchLabel")}
            keep={{ view }}
            className="flex items-center gap-2"
          >
            <SearchField
              id="course-search"
              name="q"
              label={st("courses.list.searchLabel")}
              defaultValue={query}
              placeholder={st("courses.list.searchPlaceholder")}
              className="w-full min-w-0 sm:w-80"
            />
            {query ? (
              <Link
                href={listHref({ keepQuery: false })}
                scroll={false}
                aria-label={st("courses.list.searchClear")}
                title={st("courses.list.searchClear")}
                className={buttonClass({ variant: "ghost", size: "icon" })}
              >
                <DiveDayIcon name="close" className="size-4" />
              </Link>
            ) : null}
          </QueryForm>
          <FilterChips label={st("courses.list.views.label")} chips={viewChips} />
        </div>
      ) : null}

      {courseList.length === 0 && narrowed ? (
        <EmptyState title={st("courses.list.noMatch")} className="mt-6" />
      ) : courseList.length === 0 ? (
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
                className={buttonClass({ variant: "secondary", size: "sm" })}
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
      <CourseFollowUps db={db} shop={shop} locale={locale} t={st} />
      <p className="mt-4 hidden text-sm text-muted print:block">
        {st("courses.list.pagination.paperSubset", {
          shown: courseList.length,
          total: coursePage.total,
        })}
      </p>
      <div className="print:hidden">
        <Pager
          page={coursePage.page}
          pageCount={coursePage.pageCount}
          href={pageHref}
          total={st("courses.list.pagination.total", { count: coursePage.total })}
          words={staffPagerWords(st)}
        />
      </div>
    </StaffPage>
  );
}
