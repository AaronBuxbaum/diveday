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
import { requestTranslator } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import { MAX_PATH_STEPS } from "@/lib/courses";
import { PathBuilder } from "../_components/PathBuilder";
import { savePathAction } from "../actions";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/** Title, description, and canonical URL for the public path page. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ shopSlug: string; pathSlug: string }>;
}): Promise<Metadata> {
  const { shopSlug, pathSlug } = await params;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  const path = shop ? await getCoursePathBySlug(db, shop.id, pathSlug) : null;
  if (!shop || !path) return { title: "Certification path — DiveDay" };
  // A hidden path 404s in the page body for anyone but this shop's own staff
  // — metadata must refuse it the same way, since Next resolves
  // `generateMetadata` independently of that later `notFound()` and would
  // otherwise leak the title/summary into the anonymous <head>.
  const session = await auth();
  const staffView = session?.user?.shopId === shop.id && isStaff(session.user.roles);
  if (!path.isActive && !staffView) return { title: "Certification path — DiveDay" };
  const canonical = `/shop/${shop.slug}/courses/paths/${path.slug}`;
  const title = `${path.title} — ${shop.name}`;
  const description = path.summary ?? undefined;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical },
  };
}

/**
 * A single certification path. Auth-exempt in src/lib/auth.config.ts
 * (`COURSE_PATH_PAGE`) for a signed-out diver reading an active path's
 * progression; a signed-in staff member of this same shop instead gets the
 * builder, unchanged from before. The shop always resolves from the URL slug,
 * never the session, and a hidden path 404s for anyone but that staff member
 * — the same "preview, not a public document" rule `courses/[slug]/page.tsx`
 * applies to a hidden course.
 */
export default async function CoursePathPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; pathSlug: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await connection(); // visibility can change between requests — render per request
  const { shopSlug, pathSlug } = await params;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) notFound();
  const path = await getCoursePathBySlug(db, shop.id, pathSlug);
  if (!path) notFound();

  const session = await auth();
  const staffView = session?.user?.shopId === shop.id && isStaff(session.user.roles);
  if (!path.isActive && !staffView) notFound();

  const { locale, t } = await requestTranslator(shop.defaultLocale);

  if (staffView) {
    const { error, saved } = await searchParams;
    const st = staffTranslator(locale);
    const [courseList, canConfigure] = await Promise.all([
      listCourses(db, shop.id),
      canPersonConfigureTrips(db, shop.id, session?.user?.personId ?? ""),
    ]);

    const ERROR_MESSAGES: Record<string, string> = {
      invalid: st("courses.pathEdit.errorInvalid"),
      duplicate: st("courses.pathEdit.errorDuplicate"),
      "not-authorized": st("courses.pathEdit.errorNotAuthorized"),
    };

    const message = error ? ERROR_MESSAGES[error] : undefined;
    const save = savePathAction.bind(null, shopSlug, pathSlug);
    const hiddenSteps = path.steps.filter((step) => !step.course.isActive);

    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <ShopPageHeader
          eyebrow={st("courses.pathEdit.eyebrow")}
          title={path.title}
          description={st("courses.pathEdit.description")}
          actions={
            <Link
              href={`/shop/${shopSlug}/courses/paths`}
              className={buttonClass({ variant: "secondary" })}
            >
              {st("courses.pathEdit.allPaths")}
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

  // A hidden course's rung outlives the shop offering it — never name it on
  // a page an anonymous diver can read, the same discipline
  // `courses/[slug]/page.tsx`'s CoursePathTrail already applies.
  const visibleSteps = path.steps.filter((step) => step.course.isActive);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("coursePaths.page.eyebrow")}
        title={path.title}
        description={path.summary ?? undefined}
        actions={
          <Link
            href={`/shop/${shopSlug}/courses/paths`}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("coursePaths.page.backToPaths")}
          </Link>
        }
      />

      <section aria-labelledby="path-steps">
        <h2 id="path-steps" className="text-lg font-semibold">
          {t("coursePaths.page.stepsHeading")}
        </h2>
        {visibleSteps.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t("coursePaths.page.noStepsBody")}</p>
        ) : (
          <ol className="mt-4 flex flex-col gap-3">
            {visibleSteps.map((step, index) => (
              <li key={step.id} className="rounded-2xl border border-border bg-surface p-5">
                <p className="text-xs font-semibold tracking-wide text-muted uppercase">
                  {index + 1}
                </p>
                <Link
                  href={`/shop/${shopSlug}/courses/${step.course.slug}`}
                  className="font-semibold text-foreground hover:text-primary"
                >
                  {step.course.title}
                </Link>
                {step.note ? <p className="mt-1 text-sm text-muted">{step.note}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
