import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { submitInquiryAction } from "@/app/actions/inquiry";
import { DateRequestForm } from "@/components/DateRequestForm";
import { JsonLd } from "@/components/JsonLd";
import { JumpNav } from "@/components/JumpNav";
import { getDb } from "@/db/client";
import { getCourseBySlug } from "@/db/courses";
import { getShopReviewAggregate } from "@/db/reviews";
import { getShopBySlug } from "@/db/shops";
import { listUpcomingSessionsForCourse } from "@/db/trips";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { dateRequestCopy } from "@/i18n/date-request-copy";
import { diverTranslator } from "@/i18n/messages";
import { DIVER_CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { requestTranslator } from "@/i18n/request";
import { courseDepthFormat } from "@/i18n/unit-labels";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import { courseTotalCents, resolveCourseContentDepths, resolveCourseDepths } from "@/lib/courses";
import { toShopCurrency } from "@/lib/money";
import { publicAppUrl } from "@/lib/notifications";
import { publicCoursePath } from "@/lib/public-routes";
import { openGraphSite, shopSearchListingRobots } from "@/lib/site-metadata";
import { coursePageJsonLd } from "@/lib/structured-data";
import {
  CourseAdmission,
  CourseFaqs,
  CourseGallery,
  CourseHero,
  CourseIncludes,
  CourseOverview,
  CourseSchedule,
  CourseSessions,
} from "./_components/CourseSections";

// `instant = true`: this route has a real static shell. Every request-scoped
// read below sits inside this segment's `loading.tsx` boundary, so the frame
// paints without waiting on the request and the data streams into it —
// and `next build` fails if that ever stops being true.
// See ADR 20260804-instant-navigation.
export const instant = true;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shopSlug: string; slug: string }>;
}): Promise<Metadata> {
  const { shopSlug, slug } = await params;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  const course = shop ? await getCourseBySlug(db, shop.id, slug) : null;
  if (!course) return { title: "Course — DiveDay" };
  // A hidden course 404s in the page body for anyone but this shop's own
  // staff (`staffView` below) — metadata must refuse it the same way, since
  // Next resolves `generateMetadata` independently of that later `notFound()`
  // and would otherwise leak the title/summary into the anonymous <head>.
  const session = await auth();
  const staffView = Boolean(
    shop && session?.user?.shopId === shop.id && isStaff(session.user.roles),
  );
  if (!course.isActive && !staffView) return { title: "Course — DiveDay" };
  const canonical = shop ? publicCoursePath(shop.slug, course.slug) : undefined;
  const title = `${course.title} — ${shop?.name ?? "DiveDay"}`;
  // `description` is the internal staff-picker blurb (schema comment on
  // `courses.description`), never diver-facing — falling back to it here
  // would leak it into a public <meta> tag. `summary` is the only field this
  // page may quote. Resolved for depth markers like the body is, or the
  // unfurl card would be the one surface still showing a raw `{depth18}`.
  // The shop's own locale, not the reader's: `generateMetadata` resolves
  // ahead of locale negotiation (the same reason a static `metadata.title` is
  // i18n-exempt), and reading request headers here would cost the route its
  // static shell.
  const description = course.summary
    ? resolveCourseDepths(
        course.summary,
        courseDepthFormat(diverTranslator(shop?.defaultLocale), shop?.depthUnit ?? "meters"),
      )
    : undefined;
  return {
    title,
    description,
    alternates: canonical ? { canonical } : undefined,
    robots: shopSearchListingRobots(shop?.searchListingOptOutAt),
    openGraph: { ...openGraphSite, title, description, url: canonical },
  };
}

/**
 * The public course page. Auth-exempt in src/lib/auth.config.ts, which matches
 * exactly this one segment under /courses/ — the staff catalog above it and the
 * editor below it stay gated.
 */
export default async function CoursePage({
  params,
}: {
  params: Promise<{ shopSlug: string; slug: string }>;
}) {
  await connection(); // session dates are live data — render per request
  const { shopSlug, slug } = await params;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) notFound();
  const stored = await getCourseBySlug(db, shop.id, slug);
  if (!stored) notFound();

  // A hidden course is invisible to the public, but its own staff need to
  // preview it — that is what the editor's Preview button opens.
  const session = await auth();
  const staffView = session?.user?.shopId === shop.id && isStaff(session.user.roles);
  if (!stored.isActive && !staffView) notFound();

  const sessions = await listUpcomingSessionsForCourse(db, shop.id, stored.id);
  const { locale, t } = await requestTranslator(shop.defaultLocale);
  // Every `{depth18}` in the shop's own prose becomes "18 meters" or "60 feet"
  // here, once, before anything reads a field — a component that reached past
  // this for `stored.overview` would be publishing the raw marker. The whole
  // row is resolved rather than the fields this page happens to render, so a
  // new prose field cannot quietly opt out (src/lib/courses.ts).
  const course = resolveCourseContentDepths(stored, courseDepthFormat(t, shop.depthUnit));

  const certificationRequired = course.minimumCertificationLevel
    ? t("course.certificationOrHigher", {
        level: t(DIVER_CERTIFICATION_LEVEL_KEYS[course.minimumCertificationLevel]),
      })
    : t("course.noCertification");
  // Logistics only. The cert gate and the minimum age are admission facts and
  // belong to CourseAdmission, which is the one place a diver reads them.
  const facts = [
    course.durationText ? { label: t("course.duration"), value: course.durationText } : null,
    course.groupSizeText ? { label: t("course.groupSize"), value: course.groupSizeText } : null,
  ].filter((fact) => fact !== null);
  const inquiryHref = shop.contactEmail ? "#get-in-touch" : null;

  // The one way down a long page (the same grammar Settings and the diver
  // record wear) — only the sections this course actually renders, in page
  // order, so a half-written page never promises an anchor with nothing at it.
  const jumpItems = [
    course.overview?.trim() ? { id: "about", label: t("course.jumpAbout") } : null,
    course.scheduleDays.length > 0 ? { id: "how-it-runs", label: t("course.jumpSchedule") } : null,
    course.includes.length > 0 || course.excludes.length > 0
      ? { id: "included", label: t("course.jumpIncluded") }
      : null,
    { id: "dates", label: t("course.jumpDates") },
    course.faqs.length > 0 ? { id: "faqs", label: t("course.jumpQuestions") } : null,
    inquiryHref ? { id: "get-in-touch", label: t("course.jumpContact") } : null,
  ].filter((item) => item !== null);

  // A hidden course is a staff preview, not a public document — emitting a
  // Course graph for a page divers cannot reach would advertise something that
  // isn't on sale (docs ADR 20260729-booking-page-structured-data).
  const structuredData = course.isActive
    ? coursePageJsonLd(
        shop,
        {
          slug: course.slug,
          title: course.title,
          agency: course.agency,
          summary: course.summary,
          description: course.description,
          priceCents: courseTotalCents(course),
          durationText: course.durationText,
        },
        publicAppUrl(),
        await getShopReviewAggregate(db, shop.id),
      )
    : null;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      {structuredData ? <JsonLd data={structuredData} /> : null}
      {course.isActive ? null : (
        <p
          role="status"
          className="mb-6 rounded-xl border border-warning/25 bg-warning/10 px-4 py-3 text-sm font-medium"
        >
          {t("course.hidden")}{" "}
          <Link
            href={`/shop/${shopSlug}/courses/${slug}/edit`}
            className="font-semibold text-primary hover:underline"
          >
            {t("course.backToEditing")}
          </Link>
        </p>
      )}
      <CourseHero
        course={course}
        totalCents={courseTotalCents(course)}
        currency={toShopCurrency(shop.currency)}
        locale={locale}
        t={t}
        facts={facts}
      />
      <CourseAdmission
        certificationRequired={certificationRequired}
        minimumAge={course.minimumAge}
        shopNote={course.prerequisiteNote}
        t={t}
      />
      {jumpItems.length > 1 ? (
        <JumpNav ariaLabel={t("course.onThisPage")} items={jumpItems} className="mt-10" />
      ) : null}
      <CourseOverview overview={course.overview} t={t} />
      <CourseGallery photos={course.galleryPhotos} title={course.title} t={t} />
      <CourseSchedule days={course.scheduleDays} locale={locale} t={t} />
      <CourseIncludes includes={course.includes} excludes={course.excludes} t={t} />
      <CourseSessions
        sessions={sessions}
        shopSlug={shopSlug}
        timezone={shop.timezone}
        locale={locale}
        inquiryHref={inquiryHref}
        t={t}
      />
      <CourseFaqs faqs={course.faqs} t={t} />
      {shop.contactEmail ? (
        // The composer's own refusals ("tell us where you are up to") are
        // chosen on the client as a diver types, so it needs its own
        // translator there — DiverIntlProvider is what makes
        // useTranslations() inside DateRequestForm work rather than throw.
        <DiverIntlProvider locale={locale} timeZone={shop.timezone} namespaces={["inquiry"]}>
          <DateRequestForm
            submitRequest={submitInquiryAction.bind(null, shopSlug, slug)}
            contactEmail={shop.contactEmail}
            contactPhone={shop.contactPhone}
            copy={dateRequestCopy(t, "course")}
          />
        </DiverIntlProvider>
      ) : null}
    </main>
  );
}
