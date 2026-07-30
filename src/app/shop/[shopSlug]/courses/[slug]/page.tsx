import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { JsonLd } from "@/components/JsonLd";
import { getDb } from "@/db/client";
import { listCoursePaths } from "@/db/course-paths";
import { getCourseBySlug } from "@/db/courses";
import { getShopReviewAggregate } from "@/db/reviews";
import { getShopBySlug } from "@/db/shops";
import { listUpcomingSessionsForCourse } from "@/db/trips";
import { requestTranslator } from "@/i18n/request";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import { courseTotalCents } from "@/lib/courses";
import { publicAppUrl } from "@/lib/notifications";
import { CERTIFICATION_LEVEL_LABELS } from "@/lib/readiness";
import { coursePageJsonLd } from "@/lib/structured-data";
import { CourseInquiry } from "./_components/CourseInquiry";
import {
  CourseAdmission,
  CourseFaqs,
  CourseGallery,
  CourseHero,
  CourseIncludes,
  CourseOverview,
  CoursePathTrail,
  CourseSchedule,
  CourseSessions,
  CourseSpecs,
} from "./_components/CourseSections";

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
  const canonical = shop ? `/shop/${shop.slug}/courses/${course.slug}` : undefined;
  const title = `${course.title} — ${shop?.name ?? "DiveDay"}`;
  const description = course.summary ?? course.description ?? undefined;
  return {
    title,
    description,
    alternates: canonical ? { canonical } : undefined,
    openGraph: { title, description, url: canonical },
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
  const course = await getCourseBySlug(db, shop.id, slug);
  if (!course) notFound();

  // A hidden course is invisible to the public, but its own staff need to
  // preview it — that is what the editor's Preview button opens.
  const session = await auth();
  const staffView = session?.user?.shopId === shop.id && isStaff(session.user.roles);
  if (!course.isActive && !staffView) notFound();

  const [sessions, paths] = await Promise.all([
    listUpcomingSessionsForCourse(db, shop.id, course.id),
    listCoursePaths(db, shop.id, { activeOnly: true }),
  ]);
  const { locale, t } = await requestTranslator(shop.defaultLocale);

  const certificationRequired = course.minimumCertificationLevel
    ? t("course.certificationOrHigher", {
        level: CERTIFICATION_LEVEL_LABELS[course.minimumCertificationLevel],
      })
    : t("course.noCertification");
  // Logistics only. The cert gate and the minimum age are admission facts and
  // belong to CourseAdmission, which is the one place a diver reads them.
  const specs = [
    course.durationText ? { label: t("course.duration"), value: course.durationText } : null,
    course.groupSizeText ? { label: t("course.groupSize"), value: course.groupSizeText } : null,
  ].filter((spec) => spec !== null);
  const inquiryHref = shop.contactEmail ? "#get-in-touch" : null;

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
        bookHref={sessions.length > 0 ? "#dates" : null}
        inquiryHref={inquiryHref}
        locale={locale}
        t={t}
      />
      <CourseSpecs items={specs} label={t("course.atAGlance")} />
      <CourseAdmission
        certificationRequired={certificationRequired}
        minimumAge={course.minimumAge}
        shopNote={course.prerequisiteNote}
        t={t}
      />
      <CoursePathTrail
        paths={paths.map((path) => ({
          slug: path.slug,
          title: path.title,
          summary: path.summary,
          // A path may outlive a course the shop stopped offering; a diver must
          // never be pointed at a page that 404s for them.
          steps: path.steps
            .filter((step) => step.course.isActive)
            .map((step) => ({
              id: step.course.id,
              title: step.course.title,
              slug: step.course.slug,
            })),
        }))}
        courseId={course.id}
        shopSlug={shopSlug}
        t={t}
      />
      <CourseOverview overview={course.overview} />
      <CourseGallery imageUrls={course.imageUrls} title={course.title} t={t} />
      <CourseSchedule days={course.scheduleDays} t={t} />
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
        <CourseInquiry
          courseTitle={course.title}
          shopName={shop.name}
          contactEmail={shop.contactEmail}
          contactPhone={shop.contactPhone}
          copy={{
            getInTouch: t("inquiry.getInTouch"),
            noDateBody: t("inquiry.noDateBody"),
            yourName: t("inquiry.yourName"),
            namePlaceholder: t("inquiry.namePlaceholder"),
            howManyDivers: t("inquiry.howManyDivers"),
            optional: t("common.optional"),
            whenSuits: t("inquiry.whenSuits"),
            whenSuitsHint: t("inquiry.whenSuitsHint"),
            whenSuitsPlaceholder: t("inquiry.whenSuitsPlaceholder"),
            whereYouAreUpTo: t("inquiry.whereYouAreUpTo"),
            chooseOne: t("inquiry.chooseOne"),
            anythingElse: t("inquiry.anythingElse"),
            messagePlaceholder: t("inquiry.messagePlaceholder"),
            messageSoFar: t("inquiry.messageSoFar"),
            openInEmailApp: t("inquiry.openInEmailApp"),
            copyMessage: t("inquiry.copy"),
            copied: t("inquiry.copied"),
            orWriteTo: t("inquiry.orWriteTo"),
            callLabel: t("inquiry.callLabel"),
          }}
        />
      ) : null}
    </main>
  );
}
