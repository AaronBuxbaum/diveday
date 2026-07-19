import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader, ShopStat } from "@/components/ShopPageHeader";
import { getDb } from "@/db/client";
import { listCourses, setCourseVisibility, updateCourse } from "@/db/courses";
import { getShopById } from "@/db/queries";
import { CERTIFICATION_LEVEL_LABELS } from "@/lib/readiness";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = { title: "Courses — Scuba" };

const money = z.union([z.literal(""), z.coerce.number().nonnegative().max(100000)]);
const courseSchema = z.object({
  agency: z.enum(["padi", "ssi"]),
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500),
  price: money,
  eLearningPrice: money,
  minimumCertificationLevel: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["open_water", "advanced_open_water", "rescue", "divemaster", "instructor"]).optional(),
  ),
  requiresInstructor: z.string().optional(),
  requiresWaiver: z.string().optional(),
});
const inputClass =
  "min-h-11 rounded-lg border border-border-strong bg-surface px-3 py-2 text-base font-normal";
const dollars = (cents: number | null) =>
  cents === null ? "Not set" : `$${(cents / 100).toFixed(2)}`;

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
  const courseList = await listCourses(db, shop.id);

  async function updateCourseAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const courseId = String(formData.get("courseId") ?? "");
    const parsed = courseSchema.safeParse(Object.fromEntries(formData));
    if (!courseId || !parsed.success)
      redirect(`/shop/${staff.user.shopSlug}/courses?notice=invalid`);
    const value = parsed.data;
    const course = await updateCourse(await getDb(), staff.user.shopId, courseId, {
      agency: value.agency,
      title: value.title,
      description: value.description || undefined,
      priceCents: value.price === "" ? null : Math.round(value.price * 100),
      eLearningPriceCents:
        value.eLearningPrice === "" ? null : Math.round(value.eLearningPrice * 100),
      minimumCertificationLevel: value.minimumCertificationLevel ?? null,
      requiresInstructor: value.requiresInstructor === "on",
      requiresWaiver: value.requiresWaiver === "on",
    });
    redirect(`/shop/${staff.user.shopSlug}/courses?notice=${course ? "saved" : "invalid"}`);
  }
  async function visibilityAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const courseId = String(formData.get("courseId") ?? "");
    const visible = formData.get("visible") === "true";
    const saved = courseId
      ? await setCourseVisibility(await getDb(), staff.user.shopId, courseId, visible)
      : null;
    redirect(
      `/shop/${staff.user.shopSlug}/courses?notice=${saved ? (visible ? "shown" : "hidden") : "invalid"}`,
    );
  }
  const messages: Record<string, string> = {
    saved: "Course settings saved. New bookings will use the updated prices.",
    shown: "Course shown in scheduling lists.",
    hidden: "Course hidden from scheduling lists. Existing sessions are unchanged.",
    invalid: "That didn’t save. Check the course details and try again.",
  };
  const active = courseList.filter((c) => c.isActive);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={shop.name}
        title="Courses"
        description="Your shop copy of the PADI and SSI catalog. Set local pricing and hide courses you do not offer."
        actions={
          <Link
            href={`/shop/${shopSlug}/trips/new`}
            className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground"
          >
            Schedule a session
          </Link>
        }
      />
      <section aria-label="Course catalog snapshot" className="mb-8 grid gap-3 sm:grid-cols-3">
        <ShopStat
          label="Available"
          value={active.length}
          detail="Shown when scheduling"
          tone="primary"
        />
        <ShopStat
          label="PADI"
          value={courseList.filter((c) => c.agency === "padi").length}
          detail="Catalog courses"
        />
        <ShopStat
          label="SSI"
          value={courseList.filter((c) => c.agency === "ssi").length}
          detail="Catalog courses"
          tone="success"
        />
      </section>
      {notice && messages[notice] ? (
        <ShopNotice tone={notice === "invalid" ? "danger" : "success"}>
          {messages[notice]}
        </ShopNotice>
      ) : null}
      <ul className="mt-8 grid gap-3 lg:grid-cols-2">
        {courseList.map((course) => (
          <li
            key={course.id}
            className={`rounded-2xl border border-border bg-surface p-5 shadow-sm ${course.isActive ? "" : "opacity-65"}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold tracking-widest text-primary uppercase">
                  {course.agency}
                </p>
                <h2 className="mt-1 text-lg font-semibold">{course.title}</h2>
                <p className="mt-1 text-sm text-muted">{course.description}</p>
              </div>
              <span className="shrink-0 rounded-full bg-surface-sunken px-2.5 py-1 text-xs font-medium text-muted">
                {course.isActive ? "Shown" : "Hidden"}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              <span className="rounded-full bg-primary/10 px-3 py-1 text-primary">
                Course {dollars(course.priceCents)}
              </span>
              <span className="rounded-full bg-primary/10 px-3 py-1 text-primary">
                With eLearning {dollars(course.eLearningPriceCents)}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <details className="relative">
                <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-xl border border-border px-4 py-2 text-sm font-medium text-primary [&::-webkit-details-marker]:hidden">
                  Edit
                </summary>
                <form
                  action={updateCourseAction}
                  className="mt-2 grid gap-3 rounded-2xl border border-border bg-surface p-4 shadow-xl sm:absolute sm:right-0 sm:z-10 sm:w-96"
                >
                  <input type="hidden" name="courseId" value={course.id} />
                  <input type="hidden" name="agency" value={course.agency} />
                  <input type="hidden" name="title" value={course.title} />
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    Description
                    <textarea
                      name="description"
                      rows={2}
                      defaultValue={course.description ?? ""}
                      className={inputClass}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1 text-sm font-medium">
                      Course price ($)
                      <input
                        name="price"
                        inputMode="decimal"
                        defaultValue={
                          course.priceCents === null ? "" : (course.priceCents / 100).toFixed(2)
                        }
                        className={inputClass}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-medium">
                      With eLearning ($)
                      <input
                        name="eLearningPrice"
                        inputMode="decimal"
                        defaultValue={
                          course.eLearningPriceCents === null
                            ? ""
                            : (course.eLearningPriceCents / 100).toFixed(2)
                        }
                        className={inputClass}
                      />
                    </label>
                  </div>
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    Existing certification required
                    <select
                      name="minimumCertificationLevel"
                      defaultValue={course.minimumCertificationLevel ?? ""}
                      className={inputClass}
                    >
                      <option value="">None</option>
                      {Object.entries(CERTIFICATION_LEVEL_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l} or higher
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
                    className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                  >
                    Save course
                  </button>
                </form>
              </details>
              <form action={visibilityAction}>
                <input type="hidden" name="courseId" value={course.id} />
                <input type="hidden" name="visible" value={course.isActive ? "false" : "true"} />
                <button
                  className="inline-flex min-h-11 items-center rounded-xl px-4 py-2 text-sm font-medium text-muted hover:bg-surface-sunken"
                  type="submit"
                >
                  {course.isActive ? "Hide" : "Show"}
                </button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
