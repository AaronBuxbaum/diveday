import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { canPersonConfigureTrips } from "@/db/authz";
import { getDb } from "@/db/client";
import { getCoursePathBySlug } from "@/db/course-paths";
import { listCourses } from "@/db/courses";
import { getShopBySlug } from "@/db/shops";
import { CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { MAX_PATH_STEPS } from "@/lib/courses";
import { publicCoursePathPath } from "@/lib/public-routes";
import { requireStaffSession } from "@/lib/session";
import { noticeFromParam } from "@/lib/staff-notices";
import { PathBuilder } from "../_components/PathBuilder";
import { savePathAction } from "../actions";

// Not a TODO. The shop layout above already permits this route's blocking
// prerender (`isPageAllowedToBlock` reads only the outermost `instant`), so what
// this line still buys is keeping the page segment out of dev-time instant
// validation — which nothing above a page segment can do.
// See ADR 20260803-instant-opt-out-placement.
export const instant = false;

export const metadata: Metadata = {
  title: "Certification path — DiveDay",
};

/**
 * One certification path in the builder — rename, reorder, annotate, save.
 * Staff-only, like everything else under `/shop/**`; the page a diver reads is
 * `/s/[shopSlug]/courses/paths/[pathSlug]`, which this route used to render as
 * its other half behind a session check (ADR 20260803-public-shop-namespace).
 */
export default async function CoursePathEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; pathSlug: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await connection(); // visibility can change between requests — render per request
  const session = await requireStaffSession();
  const { shopSlug, pathSlug } = await params;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) notFound();
  const path = await getCoursePathBySlug(db, shop.id, pathSlug);
  if (!path) notFound();

  const st = staffTranslator(await requestLocale(shop.defaultLocale));
  const { error, saved } = await searchParams;
  const [courseList, canConfigure] = await Promise.all([
    listCourses(db, shop.id),
    canPersonConfigureTrips(db, shop.id, session.user.personId),
  ]);

  const ERROR_MESSAGES: Record<string, string> = {
    invalid: st("courses.pathEdit.errorInvalid"),
    duplicate: st("courses.pathEdit.errorDuplicate"),
    "not-authorized": st("courses.pathEdit.errorNotAuthorized"),
  };

  // `Object.hasOwn`, not `ERROR_MESSAGES[error]` — `error` is attacker-supplied
  // and a bare lookup walks the prototype (src/lib/staff-notices.ts).
  const message = noticeFromParam(error, ERROR_MESSAGES);
  const save = savePathAction.bind(null, shopSlug, pathSlug);
  const hiddenSteps = path.steps.filter((step) => !step.course.isActive);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={st("courses.pathEdit.eyebrow")}
        title={path.title}
        description={st("courses.pathEdit.description")}
        actions={
          <>
            {/* What a diver sees for this path — a hidden path renders here as
                a staff-only preview, the same rule the course page uses. */}
            <Link
              href={publicCoursePathPath(shopSlug, pathSlug)}
              className={buttonClass({ variant: "secondary" })}
            >
              {st("courses.pathEdit.viewPublicPage")}
            </Link>
            <Link
              href={`/shop/${shopSlug}/courses/paths`}
              className={buttonClass({ variant: "secondary" })}
            >
              {st("courses.pathEdit.allPaths")}
            </Link>
          </>
        }
      />

      {message ? (
        <ShopNotice tone="danger" role="alert" className="mb-6">
          {message}
        </ShopNotice>
      ) : null}
      {saved ? (
        <ShopNotice tone="success" className="mb-6">
          {st("courses.pathEdit.pathSaved")}
        </ShopNotice>
      ) : null}
      {hiddenSteps.length > 0 ? (
        <ShopNotice tone="warning" className="mb-6">
          {hiddenSteps.length === 1
            ? st("courses.pathEdit.oneHiddenStep", { course: hiddenSteps[0].course.title })
            : st("courses.pathEdit.manyHiddenSteps", { count: hiddenSteps.length })}
        </ShopNotice>
      ) : null}

      {canConfigure ? (
        <form action={save} className="flex flex-col gap-6">
          <FieldGrid columns={1} className="gap-y-4">
            <Field label={st("courses.pathEdit.pathNameLabel")}>
              <input
                name="title"
                type="text"
                required
                maxLength={120}
                defaultValue={path.title}
                className={controlClass}
              />
            </Field>
            <Field
              label={st("courses.pathEdit.summaryLabel")}
              hint={st("courses.edit.optionalHint")}
            >
              <input
                name="summary"
                type="text"
                maxLength={240}
                defaultValue={path.summary ?? ""}
                placeholder={st("courses.pathEdit.summaryPlaceholder")}
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
                ? st("courses.pathBuilder.orHigher", {
                    level: st(CERTIFICATION_LEVEL_KEYS[course.minimumCertificationLevel]),
                  })
                : st("courses.pathBuilder.openToUncertified"),
            }))}
            initialSteps={path.steps.map((step) => ({
              courseId: step.course.id,
              note: step.note ?? "",
            }))}
            copy={{
              noSteps: st("courses.pathBuilder.noSteps"),
              noStepsHeading: st("courses.pathBuilder.noStepsHeading"),
              noStepsAction: st("courses.pathBuilder.noStepsAction"),
              stepLabel: st("courses.pathBuilder.stepLabel"),
              courseGoneFromCatalog: st("courses.pathBuilder.courseGoneFromCatalog"),
              hidden: st("courses.pathBuilder.hidden"),
              moveEarlier: st("courses.pathBuilder.moveEarlier"),
              moveLater: st("courses.pathBuilder.moveLater"),
              removeFromPath: st("courses.pathBuilder.removeFromPath"),
              step: st("courses.pathBuilder.step"),
              remove: st("courses.pathBuilder.remove"),
              stepNoteLabel: st("courses.pathBuilder.stepNoteLabel"),
              optionalHint: st("courses.edit.optionalHint"),
              stepNotePlaceholder: st("courses.pathBuilder.stepNotePlaceholder"),
              addACourse: st("courses.pathBuilder.addACourse"),
              atCapDescription: st("courses.pathBuilder.atCapDescription", {
                max: MAX_PATH_STEPS,
              }),
              notOnPathDescription: st("courses.pathBuilder.notOnPathDescription"),
              chooseACourse: st("courses.pathBuilder.chooseACourse"),
              hiddenSuffix: st("courses.pathBuilder.hiddenSuffix"),
              addToPath: st("courses.pathBuilder.addToPath"),
              allCoursesOnPath: st("courses.pathBuilder.allCoursesOnPath"),
              pathPreviewLabel: st("courses.pathBuilder.pathPreviewLabel"),
              whatADiverSees: st("courses.pathBuilder.whatADiverSees"),
              addACourseToSee: st("courses.pathBuilder.addACourseToSee"),
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
              <span className="font-medium">{st("courses.pathEdit.offerToDivers")}</span>
              <span className="block text-muted">{st("courses.pathEdit.hiddenPathsNote")}</span>
            </span>
          </label>

          <div className="flex items-center gap-3">
            <SubmitButton
              pendingLabel={st("courses.pathEdit.saving")}
              className={buttonClass({ size: "lg", className: "rounded-xl text-base" })}
            >
              {st("courses.pathEdit.savePath")}
            </SubmitButton>
            <Link
              href={`/shop/${shopSlug}/courses/paths`}
              className="text-sm font-medium text-muted hover:text-foreground"
            >
              {st("courses.pathEdit.cancel")}
            </Link>
          </div>
        </form>
      ) : (
        <ShopNotice tone="neutral" role="status">
          {st("courses.pathEdit.notAuthorizedNotice")}
        </ShopNotice>
      )}
    </main>
  );
}
