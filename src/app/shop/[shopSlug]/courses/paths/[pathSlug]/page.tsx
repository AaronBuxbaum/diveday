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
import { getShopById } from "@/db/shops";
import { CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { MAX_PATH_STEPS } from "@/lib/courses";
import { requireStaffSession } from "@/lib/session";
import { PathBuilder } from "../_components/PathBuilder";
import { savePathAction } from "../actions";

export const metadata: Metadata = { title: "Edit a path — DiveDay" };

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
  const [path, courseList, canConfigure, shop] = await Promise.all([
    getCoursePathBySlug(db, session.user.shopId, pathSlug),
    listCourses(db, session.user.shopId),
    canPersonConfigureTrips(db, session.user.shopId, session.user.personId),
    getShopById(db, session.user.shopId),
  ]);
  if (!path || !shop) notFound();
  const t = staffTranslator(await requestLocale(shop.defaultLocale));

  const ERROR_MESSAGES: Record<string, string> = {
    invalid: t("courses.pathEdit.errorInvalid"),
    duplicate: t("courses.pathEdit.errorDuplicate"),
    "not-authorized": t("courses.pathEdit.errorNotAuthorized"),
  };

  const message = error ? ERROR_MESSAGES[error] : undefined;
  const save = savePathAction.bind(null, shopSlug, pathSlug);
  const hiddenSteps = path.steps.filter((step) => !step.course.isActive);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("courses.pathEdit.eyebrow")}
        title={path.title}
        description={t("courses.pathEdit.description")}
        actions={
          <Link
            href={`/shop/${shopSlug}/courses/paths`}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("courses.pathEdit.allPaths")}
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
          {t("courses.pathEdit.pathSaved")}
        </ShopNotice>
      ) : null}
      {hiddenSteps.length > 0 ? (
        <ShopNotice tone="warning" className="mb-6">
          {hiddenSteps.length === 1
            ? t("courses.pathEdit.oneHiddenStep", { course: hiddenSteps[0].course.title })
            : t("courses.pathEdit.manyHiddenSteps", { count: hiddenSteps.length })}
        </ShopNotice>
      ) : null}

      {canConfigure ? (
        <form action={save} className="flex flex-col gap-6">
          <FieldGrid columns={1} className="gap-y-4">
            <Field label={t("courses.pathEdit.pathNameLabel")}>
              <input
                name="title"
                type="text"
                required
                maxLength={120}
                defaultValue={path.title}
                className={controlClass}
              />
            </Field>
            <Field label={t("courses.pathEdit.summaryLabel")} hint={t("courses.edit.optionalHint")}>
              <input
                name="summary"
                type="text"
                maxLength={240}
                defaultValue={path.summary ?? ""}
                placeholder={t("courses.pathEdit.summaryPlaceholder")}
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
              gateLabel: course.minimumCertificationLevel
                ? t("courses.pathBuilder.orHigher", {
                    level: t(CERTIFICATION_LEVEL_KEYS[course.minimumCertificationLevel]),
                  })
                : t("courses.pathBuilder.openToUncertified"),
            }))}
            initialSteps={path.steps.map((step) => ({
              courseId: step.course.id,
              note: step.note ?? "",
            }))}
            copy={{
              noSteps: t("courses.pathBuilder.noSteps"),
              stepLabel: t("courses.pathBuilder.stepLabel"),
              courseGoneFromCatalog: t("courses.pathBuilder.courseGoneFromCatalog"),
              hidden: t("courses.pathBuilder.hidden"),
              moveEarlier: t("courses.pathBuilder.moveEarlier"),
              moveLater: t("courses.pathBuilder.moveLater"),
              removeFromPath: t("courses.pathBuilder.removeFromPath"),
              step: t("courses.pathBuilder.step"),
              remove: t("courses.pathBuilder.remove"),
              stepNoteLabel: t("courses.pathBuilder.stepNoteLabel"),
              optionalHint: t("courses.edit.optionalHint"),
              stepNotePlaceholder: t("courses.pathBuilder.stepNotePlaceholder"),
              addACourse: t("courses.pathBuilder.addACourse"),
              atCapDescription: t("courses.pathBuilder.atCapDescription", {
                max: MAX_PATH_STEPS,
              }),
              notOnPathDescription: t("courses.pathBuilder.notOnPathDescription"),
              chooseACourse: t("courses.pathBuilder.chooseACourse"),
              hiddenSuffix: t("courses.pathBuilder.hiddenSuffix"),
              addToPath: t("courses.pathBuilder.addToPath"),
              allCoursesOnPath: t("courses.pathBuilder.allCoursesOnPath"),
              pathPreviewLabel: t("courses.pathBuilder.pathPreviewLabel"),
              whatADiverSees: t("courses.pathBuilder.whatADiverSees"),
              addACourseToSee: t("courses.pathBuilder.addACourseToSee"),
            }}
          />

          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={path.isActive}
              className="size-5 rounded border-border-strong"
            />
            <span>
              <span className="font-medium">{t("courses.pathEdit.offerToDivers")}</span>
              <span className="block text-muted">{t("courses.pathEdit.hiddenPathsNote")}</span>
            </span>
          </label>

          <div className="flex items-center gap-3">
            <SubmitButton
              pendingLabel={t("courses.pathEdit.saving")}
              className={buttonClass({ size: "lg", className: "rounded-xl text-base" })}
            >
              {t("courses.pathEdit.savePath")}
            </SubmitButton>
            <Link
              href={`/shop/${shopSlug}/courses/paths`}
              className="text-sm font-medium text-muted hover:text-foreground"
            >
              {t("courses.pathEdit.cancel")}
            </Link>
          </div>
        </form>
      ) : (
        <ShopNotice tone="neutral" role="status">
          {t("courses.pathEdit.notAuthorizedNotice")}
        </ShopNotice>
      )}
    </main>
  );
}
