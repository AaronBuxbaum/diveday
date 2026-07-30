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
import { getShopById } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { requireStaffSession } from "@/lib/session";
import { createPathAction, deletePathAction, setPathVisibilityAction } from "./actions";

export const metadata: Metadata = { title: "Certification paths — DiveDay" };

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
  const [paths, canConfigure, shop] = await Promise.all([
    listCoursePaths(db, session.user.shopId),
    canPersonConfigureTrips(db, session.user.shopId, session.user.personId),
    getShopById(db, session.user.shopId),
  ]);
  const t = staffTranslator(await requestLocale(shop?.defaultLocale));

  const ERROR_MESSAGES: Record<string, string> = {
    invalid: t("courses.pathsList.errorInvalid"),
    duplicate: t("courses.pathsList.errorDuplicate"),
    "not-authorized": t("courses.pathsList.errorNotAuthorized"),
  };
  const message = error ? ERROR_MESSAGES[error] : undefined;

  const create = createPathAction.bind(null, shopSlug);
  const toggle = setPathVisibilityAction.bind(null, shopSlug);
  const remove = deletePathAction.bind(null, shopSlug);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("courses.pathsList.eyebrow")}
        title={t("courses.pathsList.title")}
        description={t("courses.pathsList.description")}
        actions={
          <Link
            href={`/shop/${shopSlug}/courses`}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("courses.pathsList.backToCourses")}
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
          <h2 className="font-medium">{t("courses.pathsList.noPathsHeading")}</h2>
          <p className="mt-1 text-sm text-muted">{t("courses.pathsList.noPathsBody")}</p>
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
                      ? t("courses.pathsList.oneCourse")
                      : t("courses.pathsList.manyCourses", { count: path.steps.length })}
                  </span>
                  {path.isActive ? null : (
                    <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-muted">
                      {t("courses.pathsList.hidden")}
                    </span>
                  )}
                </span>
                <p className="mt-1 text-sm text-muted">
                  {path.steps.length > 0
                    ? path.steps.map((step) => step.course.title).join(" → ")
                    : t("courses.pathsList.noCoursesYet")}
                </p>
              </div>
              {canConfigure ? (
                <div className="flex items-center gap-1">
                  <Link
                    href={`/shop/${shopSlug}/courses/paths/${path.slug}`}
                    className={buttonClass({ variant: "secondary", size: "sm" })}
                  >
                    {t("courses.pathsList.edit")}
                  </Link>
                  <form action={toggle}>
                    <input type="hidden" name="pathId" value={path.id} />
                    <input type="hidden" name="visible" value={path.isActive ? "false" : "true"} />
                    <SubmitButton
                      pendingLabel="…"
                      className={buttonClass({ variant: "ghost", size: "sm" })}
                    >
                      {path.isActive ? t("courses.pathsList.hide") : t("courses.pathsList.show")}
                      <span className="sr-only"> {path.title}</span>
                    </SubmitButton>
                  </form>
                  <form action={remove}>
                    <input type="hidden" name="pathId" value={path.id} />
                    <SubmitButton
                      pendingLabel="…"
                      className={buttonClass({ variant: "danger", size: "sm" })}
                    >
                      {t("courses.pathsList.delete")}
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
          <h2 className="font-semibold">{t("courses.pathsList.startNewPath")}</h2>
          <p className="mt-1 text-sm text-muted">{t("courses.pathsList.startNewPathBody")}</p>
          <FieldGrid as="form" action={create} columns={1} className="mt-4 gap-y-4">
            <Field label={t("courses.pathsList.pathNameLabel")}>
              <input
                name="title"
                type="text"
                required
                maxLength={120}
                placeholder={t("courses.pathsList.pathNamePlaceholder")}
                className={controlClass}
              />
            </Field>
            <Field
              label={t("courses.pathsList.summaryLabel")}
              hint={t("courses.edit.optionalHint")}
            >
              <input
                name="summary"
                type="text"
                maxLength={240}
                placeholder={t("courses.pathsList.summaryPlaceholder")}
                className={controlClass}
              />
            </Field>
            <div>
              <SubmitButton
                pendingLabel={t("courses.pathsList.creating")}
                className={buttonClass()}
              >
                {t("courses.pathsList.createPath")}
              </SubmitButton>
            </div>
          </FieldGrid>
        </section>
      ) : (
        <div className="mt-8">
          <ShopNotice tone="neutral" role="status">
            {t("courses.pathsList.notAuthorizedNotice")}
          </ShopNotice>
        </div>
      )}
    </main>
  );
}
