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
import { requestTranslator } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import { createPathAction, deletePathAction, setPathVisibilityAction } from "./actions";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/** Per-shop title, description, and canonical URL for the public paths index. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}): Promise<Metadata> {
  const { shopSlug } = await params;
  const shop = await getShopBySlug(await getDb(), shopSlug);
  if (!shop) return { title: "Certification paths — DiveDay" };
  const { t } = await requestTranslator(shop.defaultLocale);
  const description = t("coursePaths.index.description");
  return {
    title: `Certification paths — ${shop.name}`,
    description,
    alternates: { canonical: `/shop/${shop.slug}/courses/paths` },
    openGraph: {
      title: `Certification paths — ${shop.name}`,
      description,
      url: `/shop/${shop.slug}/courses/paths`,
    },
  };
}

/**
 * Certification paths — the shop's own guidance on what to take next, never a
 * gate (each course states its own admission on its own page). Auth-exempt in
 * src/lib/auth.config.ts (`COURSE_PATHS_INDEX`) for a signed-out diver reading
 * the active paths; a signed-in staff member of this same shop instead gets
 * the builder — create, reorder, hide, delete — the way `courses/page.tsx`
 * and `schedule/page.tsx` already split staff affordances behind a session
 * check. The shop always resolves from the URL slug, never the session.
 */
export default async function CoursePathsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await connection(); // visibility can change between requests — render per request
  const { shopSlug } = await params;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) notFound();

  const session = await auth();
  const staffView = session?.user?.shopId === shop.id && isStaff(session.user.roles);

  const { locale, t } = await requestTranslator(shop.defaultLocale);

  if (staffView) {
    const { error } = await searchParams;
    const st = staffTranslator(locale);
    const [paths, canConfigure] = await Promise.all([
      listCoursePaths(db, shop.id),
      canPersonConfigureTrips(db, shop.id, session?.user?.personId ?? ""),
    ]);

    const ERROR_MESSAGES: Record<string, string> = {
      invalid: st("courses.pathsList.errorInvalid"),
      duplicate: st("courses.pathsList.errorDuplicate"),
      "not-authorized": st("courses.pathsList.errorNotAuthorized"),
    };
    const message = error ? ERROR_MESSAGES[error] : undefined;

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
            <Link
              href={`/shop/${shopSlug}/courses`}
              className={buttonClass({ variant: "secondary" })}
            >
              {st("courses.pathsList.backToCourses")}
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
                      <input
                        type="hidden"
                        name="visible"
                        value={path.isActive ? "false" : "true"}
                      />
                      <SubmitButton
                        pendingLabel="…"
                        className={buttonClass({ variant: "ghost", size: "sm" })}
                      >
                        {path.isActive
                          ? st("courses.pathsList.hide")
                          : st("courses.pathsList.show")}
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

  const paths = await listCoursePaths(db, shop.id, { activeOnly: true });

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("coursePaths.index.eyebrow")}
        title={t("coursePaths.index.title")}
        description={t("coursePaths.index.description")}
        actions={
          <Link
            href={`/shop/${shopSlug}/courses`}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("coursePaths.index.backToCourses")}
          </Link>
        }
      />

      {paths.length === 0 ? (
        <EmptyState>
          <h2 className="font-medium">{t("coursePaths.index.noPathsHeading")}</h2>
          <p className="mt-1 text-sm text-muted">{t("coursePaths.index.noPathsBody")}</p>
        </EmptyState>
      ) : (
        <ul className="mt-8 flex flex-col gap-3">
          {paths.map((path) => {
            // A path may outlive a course the shop stopped offering — never
            // name a hidden course in a listing an anonymous diver can read.
            const visibleSteps = path.steps.filter((step) => step.course.isActive);
            return (
              <li key={path.id}>
                <Link
                  href={`/shop/${shopSlug}/courses/paths/${path.slug}`}
                  className="group card-scale-hint block rounded-2xl border border-border bg-surface p-5 shadow-sm transition-all duration-200 hover:border-primary/40"
                >
                  <h2 className="font-medium group-hover:text-primary">{path.title}</h2>
                  {path.summary ? <p className="mt-1 text-sm text-muted">{path.summary}</p> : null}
                  {visibleSteps.length > 0 ? (
                    <p className="mt-2 text-sm text-muted">
                      {visibleSteps.map((step) => step.course.title).join(" → ")}
                    </p>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
