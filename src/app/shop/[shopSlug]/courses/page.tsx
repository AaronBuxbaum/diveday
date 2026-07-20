import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { listCourses, setCourseVisibility, updateCourse } from "@/db/courses";
import { getShopById } from "@/db/shops";
import { courseTotalCents } from "@/lib/courses";
import { revalidateAndRedirect } from "@/lib/navigation";
import { CERTIFICATION_LEVEL_LABELS } from "@/lib/readiness";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = { title: "Courses — Scuba" };

const money = z.union([z.literal(""), z.coerce.number().nonnegative().max(100000)]);
/**
 * A shop prices its own courses; it does not invent the syllabus. Title,
 * agency, and the prerequisite card come from PADI/SSI, and every course
 * session requires an instructor and a signed waiver — so none of those are
 * fields here.
 */
const courseSchema = z.object({
  description: z.string().trim().max(500),
  price: money,
  eLearningPrice: money,
});

const centsFromDollars = (value: number | "") => (value === "" ? null : Math.round(value * 100));
const dollarsInput = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const formatMoney = (cents: number | null) => (cents === null ? "—" : usd.format(cents / 100));

/** A money cell: right-aligned so the decimal points line up down the column. */
const priceInputClass =
  "min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-right text-base font-normal tabular-nums transition-colors focus:border-primary";

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

  async function updateCourseAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const courseId = String(formData.get("courseId") ?? "");
    const parsed = courseSchema.safeParse(Object.fromEntries(formData));
    if (!courseId || !parsed.success)
      redirect(`/shop/${staff.user.shopSlug}/courses?notice=invalid`);
    const value = parsed.data;
    const course = await updateCourse(await getDb(), staff.user.shopId, courseId, {
      description: value.description || undefined,
      priceCents: centsFromDollars(value.price),
      eLearningPriceCents: centsFromDollars(value.eLearningPrice),
    });
    revalidateAndRedirect(
      `/shop/${staff.user.shopSlug}/courses`,
      `/shop/${staff.user.shopSlug}/courses?notice=${course ? "saved" : "invalid"}`,
    );
  }
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
    saved: "Course pricing saved. New bookings will use the updated prices.",
    shown: "Course shown in scheduling lists.",
    hidden: "Course hidden from scheduling lists. Existing sessions are unchanged.",
    invalid: "That didn’t save. Check the prices and try again.",
  };

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={shop.name}
        title="Courses"
        description="Your shop copy of the PADI and SSI catalog. Set local pricing and hide courses you do not offer — prerequisites, instructor, and waiver rules come from the agency."
      />
      {notice && messages[notice] ? (
        <ShopNotice tone={notice === "invalid" ? "danger" : "success"}>
          {messages[notice]}
        </ShopNotice>
      ) : null}

      {/*
        Each row edits in place. The row's <form> sits in its last cell and the
        price inputs point back at it with `form=`: a <form> cannot wrap a <tr>
        without breaking table layout, and a per-row popover is what used to
        open off the side of the screen.
      */}
      <div className="mt-8 overflow-x-auto rounded-2xl border border-border bg-surface shadow-sm">
        <table className="w-full min-w-[56rem] table-fixed border-collapse text-sm">
          <caption className="sr-only">
            Course catalog with per-course pricing and scheduling visibility
          </caption>
          {/* Fixed widths so the money columns stay a straight edge down the page. */}
          <colgroup>
            <col className="w-[28%]" />
            <col className="w-[17%]" />
            <col className="w-[13%]" />
            <col className="w-[13%]" />
            <col className="w-[12%]" />
            <col className="w-[17%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-border text-left align-bottom text-xs tracking-wide text-muted uppercase">
              <th scope="col" className="px-4 py-3 font-semibold">
                Course
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Prerequisite
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                Instruction
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                e-Learning
                <span className="block text-[0.625rem] font-medium normal-case">
                  its own invoice line
                </span>
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                Student pays
                <span className="block text-[0.625rem] font-medium normal-case">one payment</span>
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {courseList.map((course) => {
              const formId = `course-${course.id}`;
              return (
                <tr key={course.id} className={course.isActive ? "" : "text-muted"}>
                  <th scope="row" className="px-4 py-4 text-left align-top font-normal">
                    <span className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{course.title}</span>
                      <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-semibold tracking-wider text-muted uppercase">
                        {course.agency}
                      </span>
                      {course.isActive ? null : (
                        <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-muted">
                          Hidden
                        </span>
                      )}
                    </span>
                    <input
                      form={formId}
                      name="description"
                      defaultValue={course.description ?? ""}
                      aria-label={`${course.title} shop blurb`}
                      placeholder="Add a line divers will read"
                      className="mt-1 min-h-11 w-full rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm font-normal text-muted transition-colors hover:border-border focus:border-primary focus:bg-surface focus:text-foreground"
                    />
                  </th>
                  <td className="px-4 py-4 align-top text-muted">
                    {course.minimumCertificationLevel
                      ? `${CERTIFICATION_LEVEL_LABELS[course.minimumCertificationLevel]} or higher`
                      : "Open to uncertified"}
                  </td>
                  <td className="px-4 py-4 text-right align-top">
                    <input
                      form={formId}
                      name="price"
                      inputMode="decimal"
                      defaultValue={dollarsInput(course.priceCents)}
                      aria-label={`${course.title} instruction fee in dollars`}
                      placeholder="—"
                      className={priceInputClass}
                    />
                  </td>
                  <td className="px-4 py-4 text-right align-top">
                    <input
                      form={formId}
                      name="eLearningPrice"
                      inputMode="decimal"
                      defaultValue={dollarsInput(course.eLearningPriceCents)}
                      aria-label={`${course.title} e-learning fee in dollars`}
                      placeholder="—"
                      className={priceInputClass}
                    />
                  </td>
                  <td className="px-4 py-4 text-right align-top font-semibold tabular-nums">
                    <span className="inline-flex min-h-11 items-center">
                      {formatMoney(courseTotalCents(course))}
                    </span>
                  </td>
                  <td className="px-4 py-4 align-top">
                    <span className="flex items-center justify-end gap-1">
                      <form id={formId} action={updateCourseAction}>
                        <input type="hidden" name="courseId" value={course.id} />
                        <SubmitButton
                          pendingLabel="Saving…"
                          className={buttonClass({ variant: "secondary", size: "sm" })}
                        >
                          Save
                        </SubmitButton>
                      </form>
                      <form action={visibilityAction}>
                        <input type="hidden" name="courseId" value={course.id} />
                        <input
                          type="hidden"
                          name="visible"
                          value={course.isActive ? "false" : "true"}
                        />
                        <SubmitButton
                          pendingLabel="Saving…"
                          className={buttonClass({ variant: "ghost", size: "sm" })}
                        >
                          {course.isActive ? "Hide" : "Show"}
                        </SubmitButton>
                      </form>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
