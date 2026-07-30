import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { canPersonConfigureTrips } from "@/db/authz";
import { getDb } from "@/db/client";
import { getCoursePathBySlug } from "@/db/course-paths";
import { listCourses } from "@/db/courses";
import { requireStaffSession } from "@/lib/session";
import { PathBuilder } from "../_components/PathBuilder";
import { savePathAction } from "../actions";

export const metadata: Metadata = { title: "Edit a path — DiveDay" };

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "That didn't save — give the path a name and try again.",
  duplicate: "You already have a path with that name.",
  "not-authorized": "Building paths is limited to owners, managers, and instructors.",
};

export default async function EditCoursePathPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; pathSlug: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug, pathSlug } = await params;
  const { error, saved } = await searchParams;
  const db = await getDb();
  const [path, courseList, canConfigure] = await Promise.all([
    getCoursePathBySlug(db, session.user.shopId, pathSlug),
    listCourses(db, session.user.shopId),
    canPersonConfigureTrips(db, session.user.shopId, session.user.personId),
  ]);
  if (!path) notFound();

  const message = error ? ERROR_MESSAGES[error] : undefined;
  const save = savePathAction.bind(null, shopSlug, pathSlug);
  const hiddenSteps = path.steps.filter((step) => !step.course.isActive);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow="Catalog"
        title={path.title}
        description="Drop courses in the order a diver would take them. Nothing here decides who may enrol — that stays with each course's own certification requirement."
        actions={
          <Link
            href={`/shop/${shopSlug}/courses/paths`}
            className={buttonClass({ variant: "secondary" })}
          >
            All paths
          </Link>
        }
      />

      {message ? (
        <ShopNotice tone="danger" role="alert" className="mb-6">
          {message}
        </ShopNotice>
      ) : null}
      {saved ? (
        <ShopNotice tone="success" className="mb-6">
          Path saved.
        </ShopNotice>
      ) : null}
      {hiddenSteps.length > 0 ? (
        <ShopNotice tone="warning" className="mb-6">
          {hiddenSteps.length === 1
            ? `${hiddenSteps[0].course.title} is hidden in your catalog, so divers won't be shown that step.`
            : `${hiddenSteps.length} courses on this path are hidden in your catalog, so divers won't be shown those steps.`}
        </ShopNotice>
      ) : null}

      {canConfigure ? (
        <form action={save} className="flex flex-col gap-6">
          <FieldGrid columns={1} className="gap-y-4">
            <Field label="Path name">
              <input
                name="title"
                type="text"
                required
                maxLength={120}
                defaultValue={path.title}
                className={controlClass}
              />
            </Field>
            <Field label="One-line summary" hint="(optional)">
              <input
                name="summary"
                type="text"
                maxLength={240}
                defaultValue={path.summary ?? ""}
                placeholder="Three courses and a season of diving between them."
                className={controlClass}
              />
            </Field>
          </FieldGrid>

          <PathBuilder
            courses={courseList.map((course) => ({
              id: course.id,
              title: course.title,
              agency: course.agency,
              isActive: course.isActive,
              minimumCertificationLevel: course.minimumCertificationLevel,
            }))}
            initialSteps={path.steps.map((step) => ({
              courseId: step.course.id,
              note: step.note ?? "",
            }))}
          />

          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={path.isActive}
              className="size-5 rounded border-border-strong"
            />
            <span>
              <span className="font-medium">Offer this path to divers</span>
              <span className="block text-muted">
                Hidden paths stay here for you and never suggest a next course.
              </span>
            </span>
          </label>

          <div className="flex items-center gap-3">
            <SubmitButton
              pendingLabel="Saving…"
              className={buttonClass({ size: "lg", className: "rounded-xl text-base" })}
            >
              Save path
            </SubmitButton>
            <Link
              href={`/shop/${shopSlug}/courses/paths`}
              className="text-sm font-medium text-muted hover:text-foreground"
            >
              Cancel
            </Link>
          </div>
        </form>
      ) : (
        <ShopNotice tone="neutral" role="status">
          Building paths is limited to owners, managers, and instructors.
        </ShopNotice>
      )}
    </main>
  );
}
