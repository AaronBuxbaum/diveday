import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader, ShopStat } from "@/components/ShopPageHeader";
import { getDb } from "@/db/client";
import { archiveCourse, createCourse, listActiveCourses, updateCourse } from "@/db/courses";
import { getShopById } from "@/db/queries";
import { CERTIFICATION_LEVEL_LABELS } from "@/lib/readiness";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Courses — Scuba",
};

const courseSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500),
  minimumCertificationLevel: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(["open_water", "advanced_open_water", "rescue", "divemaster", "instructor"]).optional(),
  ),
  requiresInstructor: z.string().optional(),
  requiresWaiver: z.string().optional(),
});

const inputClass =
  "min-h-11 rounded-lg border border-border-strong bg-surface px-3 py-2 text-base font-normal";

export default async function CoursesPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { notice } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return null;
  const courseList = await listActiveCourses(db, shop.id);

  async function createCourseAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const parsed = courseSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`/shop/${staff.user.shopSlug}/courses?notice=invalid`);
    const course = await createCourse(await getDb(), {
      shopId: staff.user.shopId,
      title: parsed.data.title,
      description: parsed.data.description || undefined,
      minimumCertificationLevel: parsed.data.minimumCertificationLevel ?? null,
      requiresInstructor: parsed.data.requiresInstructor === "on",
      requiresWaiver: parsed.data.requiresWaiver === "on",
    });
    redirect(`/shop/${staff.user.shopSlug}/courses?notice=${course ? "created" : "invalid"}`);
  }

  async function updateCourseAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const courseId = String(formData.get("courseId") ?? "");
    const parsed = courseSchema.safeParse(Object.fromEntries(formData));
    if (!courseId || !parsed.success)
      redirect(`/shop/${staff.user.shopSlug}/courses?notice=invalid`);
    const course = await updateCourse(await getDb(), staff.user.shopId, courseId, {
      title: parsed.data.title,
      description: parsed.data.description || undefined,
      minimumCertificationLevel: parsed.data.minimumCertificationLevel ?? null,
      requiresInstructor: parsed.data.requiresInstructor === "on",
      requiresWaiver: parsed.data.requiresWaiver === "on",
    });
    redirect(`/shop/${staff.user.shopSlug}/courses?notice=${course ? "saved" : "invalid"}`);
  }

  async function archiveCourseAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const courseId = String(formData.get("courseId") ?? "");
    const archived = courseId && (await archiveCourse(await getDb(), staff.user.shopId, courseId));
    redirect(`/shop/${staff.user.shopSlug}/courses?notice=${archived ? "archived" : "invalid"}`);
  }

  const banner =
    notice === "created"
      ? "Course added. Schedule a session when you’re ready to put students on the calendar."
      : notice === "saved"
        ? "Course updated. New sessions will use the updated admission rules."
        : notice === "archived"
          ? "Course archived. Existing sessions and their rules are unchanged."
          : notice === "invalid"
            ? "That didn’t save. Check the course name and try again."
            : undefined;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={shop.name}
        title="Courses"
        description="Define a course once, then schedule instructor-led sessions on the same safe booking spine as every charter."
        actions={
          <>
            <a
              href="#add-course"
              className="min-h-11 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
            >
              <span aria-hidden="true">+</span> Add course
            </a>
            <Link
              href={`/shop/${shopSlug}/trips/new`}
              className="min-h-11 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-surface-sunken"
            >
              Schedule a session
            </Link>
          </>
        }
      />

      <section aria-label="Course catalog snapshot" className="mb-8 grid gap-3 sm:grid-cols-3">
        <ShopStat
          label="Active courses"
          value={courseList.length}
          detail="Reusable catalog entries"
          tone="primary"
        />
        <ShopStat
          label="Admission rules"
          value={
            courseList.filter((course) => course.minimumCertificationLevel || course.requiresWaiver)
              .length
          }
          detail="Courses with readiness gates"
        />
        <ShopStat
          label="Instructor-led"
          value={courseList.filter((course) => course.requiresInstructor).length}
          detail="Courses requiring crew assignment"
          tone="success"
        />
      </section>

      {banner ? (
        <ShopNotice tone={notice === "invalid" ? "danger" : "success"}>{banner}</ShopNotice>
      ) : null}

      <section className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Course catalog</h2>
            <p className="mt-1 text-sm text-muted">
              Sessions inherit this entry’s waiver and certification baseline when they’re created.
            </p>
          </div>
          <span className="text-sm text-muted">{courseList.length} active in the catalog</span>
        </div>
        {courseList.length === 0 ? (
          <p className="mt-4 rounded-lg border border-border bg-surface p-5 text-sm text-muted">
            Add your first course below. You can still schedule ordinary charters without one.
          </p>
        ) : (
          <ul className="mt-4 grid gap-3 lg:grid-cols-2">
            {courseList.map((course) => (
              <li
                key={course.id}
                className="flex flex-col justify-between gap-4 rounded-2xl border border-border bg-surface p-5 shadow-sm"
              >
                <div>
                  <h3 className="text-lg font-semibold">{course.title}</h3>
                  {course.description ? (
                    <p className="mt-1 text-sm text-muted">{course.description}</p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
                    <span className="rounded-full bg-primary/10 px-2.5 py-1 text-primary">
                      {course.minimumCertificationLevel
                        ? `${CERTIFICATION_LEVEL_LABELS[course.minimumCertificationLevel]}+ card`
                        : "Open to new divers"}
                    </span>
                    {course.requiresInstructor ? (
                      <span className="rounded-full bg-surface-sunken px-2.5 py-1 text-muted">
                        Instructor required
                      </span>
                    ) : null}
                    {course.requiresWaiver ? (
                      <span className="rounded-full bg-surface-sunken px-2.5 py-1 text-muted">
                        Waiver required
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="relative flex shrink-0 flex-wrap gap-2 sm:justify-end">
                  <Link
                    href={`/shop/${shopSlug}/trips/new?course=${course.id}`}
                    className="min-h-11 rounded-xl border border-border bg-surface px-4 py-2 text-center text-sm font-medium transition-colors duration-200 hover:bg-surface-sunken"
                  >
                    Schedule session
                  </Link>
                  <details>
                    <summary className="min-h-11 cursor-pointer rounded-xl border border-border bg-surface px-4 py-2 text-center text-sm font-medium text-primary">
                      Edit
                    </summary>
                    <form
                      action={updateCourseAction}
                      className="mt-3 grid gap-3 rounded-2xl border border-border bg-surface p-4 shadow-xl sm:absolute sm:right-0 sm:z-10 sm:w-96"
                    >
                      <input type="hidden" name="courseId" value={course.id} />
                      <label className="flex flex-col gap-1 text-sm font-medium">
                        Course name
                        <input
                          name="title"
                          required
                          defaultValue={course.title}
                          className={inputClass}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm font-medium">
                        Description
                        <textarea
                          name="description"
                          rows={2}
                          defaultValue={course.description ?? ""}
                          className={inputClass}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm font-medium">
                        Existing certification required
                        <select
                          name="minimumCertificationLevel"
                          defaultValue={course.minimumCertificationLevel ?? ""}
                          className={inputClass}
                        >
                          <option value="">None — new divers may enroll</option>
                          {Object.entries(CERTIFICATION_LEVEL_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label} or higher
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex min-h-11 items-center gap-3 text-sm">
                        <input
                          name="requiresInstructor"
                          type="checkbox"
                          defaultChecked={course.requiresInstructor}
                          className="size-4 accent-primary"
                        />
                        Require an instructor
                      </label>
                      <label className="flex min-h-11 items-center gap-3 text-sm">
                        <input
                          name="requiresWaiver"
                          type="checkbox"
                          defaultChecked={course.requiresWaiver}
                          className="size-4 accent-primary"
                        />
                        Require a signed waiver
                      </label>
                      <button
                        type="submit"
                        className="min-h-11 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                      >
                        Save course
                      </button>
                    </form>
                  </details>
                  <details>
                    <summary className="min-h-11 cursor-pointer rounded-xl px-3 py-2 text-sm font-medium text-danger hover:bg-danger/10">
                      Archive
                    </summary>
                    <form
                      action={archiveCourseAction}
                      className="absolute right-0 z-10 mt-2 w-64 rounded-2xl border border-danger/25 bg-surface p-4 text-sm shadow-xl"
                    >
                      <input type="hidden" name="courseId" value={course.id} />
                      <p className="text-muted">
                        Existing sessions keep their rules. This course will leave future scheduling
                        pickers.
                      </p>
                      <button
                        type="submit"
                        className="mt-3 min-h-11 rounded-xl bg-danger px-3 py-2 text-sm font-medium text-primary-foreground"
                      >
                        Archive course
                      </button>
                    </form>
                  </details>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        id="add-course"
        className="mt-12 scroll-mt-24 rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6"
      >
        <h2 className="text-lg font-semibold">Add a course</h2>
        <p className="mt-1 text-sm text-muted">
          Start with the published admission rules you’ll actually enforce. Agency-specific ratios
          and medical policy still need their recorded human approval.
        </p>
        <form action={createCourseAction} className="mt-5 flex flex-col gap-5">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Course name
            <input
              name="title"
              required
              maxLength={120}
              placeholder="Open Water Diver"
              autoComplete="off"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            What it is <span className="font-normal text-muted">(optional)</span>
            <textarea
              name="description"
              rows={2}
              maxLength={500}
              placeholder="A friendly sentence for the schedule and staff."
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Existing certification required
            <select name="minimumCertificationLevel" defaultValue="" className={inputClass}>
              <option value="">None — new divers may enroll</option>
              {Object.entries(CERTIFICATION_LEVEL_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label} or higher
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              name="requiresInstructor"
              type="checkbox"
              defaultChecked
              className="size-4 accent-primary"
            />
            Require an assigned instructor before this session can take bookings
          </label>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              name="requiresWaiver"
              type="checkbox"
              defaultChecked
              className="size-4 accent-primary"
            />
            Require a signed waiver for every enrolled student
          </label>
          <div>
            <button
              type="submit"
              className="min-h-11 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover"
            >
              Add course
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
