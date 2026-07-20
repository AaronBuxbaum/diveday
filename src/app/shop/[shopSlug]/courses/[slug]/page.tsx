import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getDb } from "@/db/client";
import { getCourseBySlug } from "@/db/courses";
import { getShopBySlug } from "@/db/shops";
import { listUpcomingSessionsForCourse } from "@/db/trips";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import { courseTotalCents } from "@/lib/courses";
import { CERTIFICATION_LEVEL_LABELS } from "@/lib/readiness";
import { CourseInquiry } from "./_components/CourseInquiry";
import {
  CourseAdmission,
  CourseFaqs,
  CourseGallery,
  CourseHero,
  CourseIncludes,
  CourseOverview,
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
  if (!course) return { title: "Course — Scuba" };
  return {
    title: `${course.title} — ${shop?.name ?? "Scuba"}`,
    description: course.summary ?? course.description ?? undefined,
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

  // A draft is invisible to the public, but its own staff need to preview it
  // before publishing — that is what the editor's Preview button opens.
  const session = await auth();
  const staffView = session?.user?.shopId === shop.id && isStaff(session.user.roles);
  if (!course.isPublished && !staffView) notFound();

  const sessions = await listUpcomingSessionsForCourse(db, shop.id, course.id);

  const certificationRequired = course.minimumCertificationLevel
    ? `${CERTIFICATION_LEVEL_LABELS[course.minimumCertificationLevel]} or higher`
    : "No certification required";
  // Logistics only. The cert gate and the minimum age are admission facts and
  // belong to CourseAdmission, which is the one place a diver reads them.
  const specs = [
    course.durationText ? { label: "Duration", value: course.durationText } : null,
    course.groupSizeText ? { label: "Group size", value: course.groupSizeText } : null,
  ].filter((spec) => spec !== null);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      {course.isPublished ? null : (
        <p
          role="status"
          className="mb-6 rounded-xl border border-warning/25 bg-warning/10 px-4 py-3 text-sm font-medium"
        >
          Draft preview — divers cannot see this page yet.{" "}
          <Link
            href={`/shop/${shopSlug}/courses/${slug}/edit`}
            className="font-semibold text-primary hover:underline"
          >
            Back to editing
          </Link>
        </p>
      )}
      <CourseHero
        course={course}
        totalCents={courseTotalCents(course)}
        bookHref={sessions.length > 0 ? "#dates" : null}
      />
      <CourseSpecs items={specs} />
      <CourseAdmission
        certificationRequired={certificationRequired}
        minimumAge={course.minimumAge}
        shopNote={course.prerequisiteNote}
      />
      <CourseOverview overview={course.overview} />
      <CourseGallery imageUrls={course.imageUrls} title={course.title} />
      <CourseSchedule days={course.scheduleDays} />
      <CourseIncludes includes={course.includes} excludes={course.excludes} />
      <CourseSessions
        sessions={sessions}
        shopSlug={shopSlug}
        timezone={shop.timezone}
        inquiryHref={shop.contactEmail ? "#get-in-touch" : null}
      />
      <CourseFaqs faqs={course.faqs} />
      {shop.contactEmail ? (
        <CourseInquiry
          courseTitle={course.title}
          shopName={shop.name}
          contactEmail={shop.contactEmail}
          contactPhone={shop.contactPhone}
        />
      ) : null}
    </main>
  );
}
