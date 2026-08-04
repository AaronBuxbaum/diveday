import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EmptyState } from "@/components/EmptyState";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { canPersonConfigureTrips } from "@/db/authz";
import { getDb } from "@/db/client";
import { listCoursePaths } from "@/db/course-paths";
import { getShopBySlug } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { publicCoursePathsPath } from "@/lib/public-routes";
import { requireStaffSession } from "@/lib/session";
import { noticeFromParam } from "@/lib/staff-notices";
import { createPathAction, deletePathAction, setPathVisibilityAction } from "./actions";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Certification paths — DiveDay",
};

/**
 * The certification-path builder — create, reorder, hide, delete. Staff-only,
 * like everything else under `/shop/**`; the guidance a diver reads is
 * `/s/[shopSlug]/courses/paths`, which this page used to render as its other
 * half behind a session check (ADR 20260803-public-shop-namespace).
 *
 * A path is guidance, never a gate — admission stays on each course's own
 * `minimum_certification_level`.
 */
export default async function CoursePathsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await connection(); // visibility can change between requests — render per request
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) notFound();

  const { error } = await searchParams;
  const st = staffTranslator(await requestLocale(shop.defaultLocale));
  const [paths, canConfigure] = await Promise.all([
    listCoursePaths(db, shop.id),
    canPersonConfigureTrips(db, shop.id, session.user.personId),
  ]);

  const ERROR_MESSAGES: Record<string, string> = {
    invalid: st("courses.pathsList.errorInvalid"),
    duplicate: st("courses.pathsList.errorDuplicate"),
    "not-authorized": st("courses.pathsList.errorNotAuthorized"),
  };
  // `Object.hasOwn`, not `ERROR_MESSAGES[error]` — `error` is attacker-supplied
  // and a bare lookup walks the prototype (src/lib/staff-notices.ts).
  const message = noticeFromParam(error, ERROR_MESSAGES);

  const create = createPathAction.bind(null, shopSlug);
  const toggle = setPathVisibilityAction.bind(null, shopSlug);
  const remove = deletePathAction.bind(null, shopSlug);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={st("courses.pathsList.eyebrow")}
        title={st("courses.pathsList.title")}
        description={st("courses.pathsList.description")}
        actions={
          <>
            {/* The diver-facing counterpart of this builder — the one link on
                this page that leaves /shop for the public namespace. */}
            <Link
              href={publicCoursePathsPath(shopSlug)}
              className={buttonClass({ variant: "secondary" })}
            >
              {st("courses.pathsList.viewPublicPage")}
            </Link>
            <Link
              href={`/shop/${shopSlug}/courses`}
              className={buttonClass({ variant: "secondary" })}
            >
              {st("courses.pathsList.backToCourses")}
            </Link>
          </>
        }
      />

      {message ? (
        <ShopNotice tone="danger" role="alert">
          {message}
        </ShopNotice>
      ) : null}

      {paths.length === 0 ? (
        <EmptyState>
          <h2 className="font-medium">{st("courses.pathsList.noPathsHeading")}</h2>
          <p className="mt-1 text-sm text-muted">{st("courses.pathsList.noPathsBody")}</p>
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
                    {path.steps.length === 1
                      ? st("courses.pathsList.oneCourse")
                      : st("courses.pathsList.manyCourses", { count: path.steps.length })}
                  </span>
                  {path.isActive ? null : (
                    <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-muted">
                      {st("courses.pathsList.hidden")}
                    </span>
                  )}
                </span>
                <p className="mt-1 text-sm text-muted">
                  {path.steps.length > 0
                    ? path.steps.map((step) => step.course.title).join(" → ")
                    : st("courses.pathsList.noCoursesYet")}
                </p>
              </div>
              {canConfigure ? (
                <div className="flex items-center gap-1">
                  <Link
                    href={`/shop/${shopSlug}/courses/paths/${path.slug}`}
                    className={buttonClass({ variant: "secondary", size: "sm" })}
                  >
                    {st("courses.pathsList.edit")}
                  </Link>
                  <form action={toggle}>
                    <input type="hidden" name="pathId" value={path.id} />
                    <input type="hidden" name="visible" value={path.isActive ? "false" : "true"} />
                    <SubmitButton
                      pendingLabel="…"
                      className={buttonClass({ variant: "ghost", size: "sm" })}
                    >
                      {path.isActive ? st("courses.pathsList.hide") : st("courses.pathsList.show")}
                      <span className="sr-only"> {path.title}</span>
                    </SubmitButton>
                  </form>
                  <form action={remove}>
                    <input type="hidden" name="pathId" value={path.id} />
                    <SubmitButton
                      pendingLabel="…"
                      className={buttonClass({ variant: "danger", size: "sm" })}
                    >
                      {st("courses.pathsList.delete")}
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
          <h2 className="font-semibold">{st("courses.pathsList.startNewPath")}</h2>
          <p className="mt-1 text-sm text-muted">{st("courses.pathsList.startNewPathBody")}</p>
          <FieldGrid as="form" action={create} columns={1} className="mt-4 gap-y-4">
            <Field label={st("courses.pathsList.pathNameLabel")}>
              <input
                name="title"
                type="text"
                required
                maxLength={120}
                placeholder={st("courses.pathsList.pathNamePlaceholder")}
                className={controlClass}
              />
            </Field>
            <Field
              label={st("courses.pathsList.summaryLabel")}
              hint={st("courses.edit.optionalHint")}
            >
              <input
                name="summary"
                type="text"
                maxLength={240}
                placeholder={st("courses.pathsList.summaryPlaceholder")}
                className={controlClass}
              />
            </Field>
            <div>
              <SubmitButton
                pendingLabel={st("courses.pathsList.creating")}
                className={buttonClass()}
              >
                {st("courses.pathsList.createPath")}
              </SubmitButton>
            </div>
          </FieldGrid>
        </section>
      ) : (
        <div className="mt-8">
          <ShopNotice tone="neutral" role="status">
            {st("courses.pathsList.notAuthorizedNotice")}
          </ShopNotice>
        </div>
      )}
    </main>
  );
}
