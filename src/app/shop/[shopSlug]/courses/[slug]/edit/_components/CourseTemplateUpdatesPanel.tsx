import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { TONE_PANEL_CLASS } from "@/components/ui/card";
import type { CourseTemplateUpdate } from "@/db/courses";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { courseTemplateFieldLabels } from "./template-field-labels";

/** The "a newer template is available" panel and its two ways to take it. */
export function CourseTemplateUpdatesPanel({
  update,
  labels,
  preserveAction,
  replaceAction,
  t,
}: {
  update: CourseTemplateUpdate;
  labels: ReturnType<typeof courseTemplateFieldLabels>;
  preserveAction: (formData: FormData) => void | Promise<void>;
  replaceAction: (formData: FormData) => void | Promise<void>;
  t: StaffTranslator;
}) {
  return (
    <section className={`mt-6 ${TONE_PANEL_CLASS} border-primary/30 bg-primary/5`}>
      <h2 className="text-base font-semibold">{t("courses.edit.templateUpdates.title")}</h2>
      <p className="mt-1 text-sm text-muted">
        {update.baselineUnavailable
          ? t("courses.edit.templateUpdates.baselineUnavailableDescription")
          : t("courses.edit.templateUpdates.description", {
              current: update.currentVersion,
              latest: update.latestVersion,
            })}
      </p>
      <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        {update.diff.map((change) => (
          <li
            key={change.field}
            className="flex min-h-10 items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2"
          >
            <span>{labels[change.field]}</span>
            <span className="shrink-0 text-xs font-medium text-muted">
              {change.shopChanged
                ? t("courses.edit.templateUpdates.shopEdit")
                : t("courses.edit.templateUpdates.templateChange")}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-muted">
        {t("courses.edit.templateUpdates.keepEditsDescription")}
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start">
        <form action={preserveAction} className="flex flex-col gap-1">
          <SubmitButton pendingLabel={t("courses.edit.templateUpdates.applying")}>
            {t("courses.edit.templateUpdates.keepEdits")}
          </SubmitButton>
          <span className="text-xs text-muted">
            {t("courses.edit.templateUpdates.keepEditsHint")}
          </span>
        </form>
        <form action={replaceAction} className="flex flex-col gap-1">
          <SubmitButton
            pendingLabel={t("courses.edit.templateUpdates.replacing")}
            className={buttonClass({ variant: "secondary" })}
            confirmMessage={t("courses.edit.templateUpdates.replaceConfirm")}
          >
            {t("courses.edit.templateUpdates.replaceCopy")}
          </SubmitButton>
          <span className="text-xs text-muted">
            {t("courses.edit.templateUpdates.replaceCopyHint")}
          </span>
        </form>
      </div>
    </section>
  );
}
