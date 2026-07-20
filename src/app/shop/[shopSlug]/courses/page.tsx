import type { Metadata } from "next";
import Link from "next/link";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { listCourses, setCourseVisibility } from "@/db/courses";
import { getShopById } from "@/db/shops";
import { revalidateAndRedirect } from "@/lib/navigation";
import { CERTIFICATION_LEVEL_LABELS } from "@/lib/readiness";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = { title: "Courses — Scuba" };

/** A closed eye — the action that hides a course from scheduling lists. */
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

/** An open eye — the action that shows a hidden course again. */
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

export default async function CoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const session = await requireStaffSession();
  const { notice } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return null;
  const courseList = await listCourses(db, shop.id);

  async function visibilityAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const courseId = String(formData.get("courseId") ?? "");
    const visible = formData.get("visible") === "true";
    const saved = courseId
      ? await setCourseVisibility(await getDb(), staff.user.shopId, courseId, visible)
      : null;
    revalidateAndRedirect(
      `/shop/${staff.user.shopSlug}/courses`,
      `/shop/${staff.user.shopSlug}/courses?notice=${saved ? (visible ? "shown" : "hidden") : "invalid"}`,
    );
  }
  const messages: Record<string, string> = {
    shown: "Course shown in scheduling lists.",
    hidden: "Course hidden from scheduling lists. Existing sessions are unchanged.",
    invalid: "That didn’t save. Try again.",
  };

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={shop.name}
        title="Courses"
        description="Your shop copy of the PADI and SSI catalog. Open a course to edit its page and pricing, or hide the ones you don’t offer."
      />
      {notice && messages[notice] ? (
        <ShopNotice tone={notice === "invalid" ? "danger" : "success"}>
          {messages[notice]}
        </ShopNotice>
      ) : null}

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
                    Hidden
                  </span>
                )}
                {/*
                  Two independent states, so two badges: "Hidden" is out of the
                  session picker, "Live" is on the public web.
                */}
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    course.isPublished
                      ? "bg-success/10 text-success"
                      : "bg-surface-sunken text-muted"
                  }`}
                >
                  {course.isPublished ? "Live" : "Draft"}
                </span>
              </span>
              <p className="mt-1 text-sm text-muted">
                {course.minimumCertificationLevel
                  ? `${CERTIFICATION_LEVEL_LABELS[course.minimumCertificationLevel]} or higher`
                  : "Open to uncertified"}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Link
                href={`/shop/${shop.slug}/courses/${course.slug}/edit`}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                Edit
              </Link>
              <form action={visibilityAction}>
                <input type="hidden" name="courseId" value={course.id} />
                <input type="hidden" name="visible" value={course.isActive ? "false" : "true"} />
                <SubmitButton
                  pendingLabel="…"
                  className={buttonClass({ variant: "ghost", size: "sm", className: "px-2" })}
                >
                  {course.isActive ? <EyeOffIcon /> : <EyeIcon />}
                  <span className="sr-only">
                    {course.isActive ? "Hide" : "Show"} {course.title}
                  </span>
                </SubmitButton>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
