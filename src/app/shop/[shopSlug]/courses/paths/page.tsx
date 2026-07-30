import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { canPersonConfigureTrips } from "@/db/authz";
import { getDb } from "@/db/client";
import { listCoursePaths } from "@/db/course-paths";
import { requireStaffSession } from "@/lib/session";
import { createPathAction, deletePathAction, setPathVisibilityAction } from "./actions";

export const metadata: Metadata = { title: "Certification paths — DiveDay" };

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "That didn’t save — give the path a name and try again.",
  duplicate: "You already have a path with that name.",
  "not-authorized": "Building paths is limited to owners, managers, and instructors.",
};

export default async function CoursePathsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { error } = await searchParams;
  const db = await getDb();
  const [paths, canConfigure] = await Promise.all([
    listCoursePaths(db, session.user.shopId),
    canPersonConfigureTrips(db, session.user.shopId, session.user.personId),
  ]);
  const message = error ? ERROR_MESSAGES[error] : undefined;

  const create = createPathAction.bind(null, shopSlug);
  const toggle = setPathVisibilityAction.bind(null, shopSlug);
  const remove = deletePathAction.bind(null, shopSlug);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow="Catalog"
        title="Certification paths"
        description="The order you’d walk a diver through your courses. A path is guidance, not a gate — it never changes who may enrol in anything."
        actions={
          <Link
            href={`/shop/${shopSlug}/courses`}
            className={buttonClass({ variant: "secondary" })}
          >
            Back to courses
          </Link>
        }
      />

      {message ? (
        <ShopNotice tone="danger" role="alert">
          {message}
        </ShopNotice>
      ) : null}

      {paths.length === 0 ? (
        <EmptyState>
          <h2 className="font-medium">No paths yet</h2>
          <p className="mt-1 text-sm text-muted">
            Most shops start with the one every diver asks about: Open Water, then Advanced, then
            Rescue.
          </p>
        </EmptyState>
      ) : (
        <ul className="mt-8 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
          {paths.map((path) => (
            <li
              key={path.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-4 sm:px-5"
            >
              <div className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/shop/${shopSlug}/courses/paths/${path.slug}`}
                    className="font-semibold text-foreground hover:text-primary"
                  >
                    {path.title}
                  </Link>
                  <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-muted tabular-nums">
                    {path.steps.length === 1 ? "1 course" : `${path.steps.length} courses`}
                  </span>
                  {path.isActive ? null : (
                    <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-muted">
                      Hidden
                    </span>
                  )}
                </span>
                <p className="mt-1 text-sm text-muted">
                  {path.steps.length > 0
                    ? path.steps.map((step) => step.course.title).join(" → ")
                    : "No courses on this path yet."}
                </p>
              </div>
              {canConfigure ? (
                <div className="flex items-center gap-1">
                  <Link
                    href={`/shop/${shopSlug}/courses/paths/${path.slug}`}
                    className={buttonClass({ variant: "secondary", size: "sm" })}
                  >
                    Edit
                  </Link>
                  <form action={toggle}>
                    <input type="hidden" name="pathId" value={path.id} />
                    <input type="hidden" name="visible" value={path.isActive ? "false" : "true"} />
                    <SubmitButton
                      pendingLabel="…"
                      className={buttonClass({ variant: "ghost", size: "sm" })}
                    >
                      {path.isActive ? "Hide" : "Show"}
                      <span className="sr-only"> {path.title}</span>
                    </SubmitButton>
                  </form>
                  <form action={remove}>
                    <input type="hidden" name="pathId" value={path.id} />
                    <SubmitButton
                      pendingLabel="…"
                      className={buttonClass({ variant: "danger", size: "sm" })}
                    >
                      Delete
                      <span className="sr-only"> {path.title}</span>
                    </SubmitButton>
                  </form>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canConfigure ? (
        <section className="mt-8 rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <h2 className="font-semibold">Start a new path</h2>
          <p className="mt-1 text-sm text-muted">
            Name it the way a diver would ask for it. You’ll add the courses next.
          </p>
          <FieldGrid as="form" action={create} columns={1} className="mt-4 gap-y-4">
            <Field label="Path name">
              <input
                name="title"
                type="text"
                required
                maxLength={120}
                placeholder="From first breath to Rescue Diver"
                className={controlClass}
              />
            </Field>
            <Field label="One-line summary" hint="(optional)">
              <input
                name="summary"
                type="text"
                maxLength={240}
                placeholder="Three courses and a season of diving between them."
                className={controlClass}
              />
            </Field>
            <div>
              <SubmitButton pendingLabel="Creating…" className={buttonClass()}>
                Create path
              </SubmitButton>
            </div>
          </FieldGrid>
        </section>
      ) : (
        <div className="mt-8">
          <ShopNotice tone="neutral" role="status">
            Building paths is limited to owners, managers, and instructors.
          </ShopNotice>
        </div>
      )}
    </main>
  );
}
