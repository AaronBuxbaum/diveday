import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/form";
import { staffTranslator } from "@/i18n/staff-messages";
import { erasePersonAction } from "../actions";
import type { DiverProfile } from "./shared";

/**
 * The one control in the app that destroys data on purpose
 * (ADR 20260802-diver-data-erasure). Deliberately unlike "Remove from active
 * divers" directly above it, which is reversible and keeps everything:
 *
 * - it is rendered only for an owner (the page checks; the action re-checks),
 * - it sits behind a disclosure *and* a typed confirmation of the diver's name,
 *   so it cannot be reached by a stray tap on a phone at the counter, and
 * - its copy states plainly what is destroyed and what survives, rather than
 *   the reassuring "stays on file" the removal control can honestly offer.
 */
export function ErasePersonalData({
  diver,
  shopSlug,
  personId,
  locale,
}: {
  diver: DiverProfile;
  shopSlug: string;
  personId: string;
  locale: string;
}) {
  const t = staffTranslator(locale);
  return (
    <section className="mt-8 border-t border-danger/30 pt-8" aria-labelledby="erase-heading">
      <h2 id="erase-heading" className="text-lg font-semibold text-danger">
        {t("divers.erase.heading")}
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">{t("divers.erase.description")}</p>
      <details className="mt-4 rounded-lg border border-danger/40 bg-danger/5 p-4">
        <summary className="flex min-h-11 cursor-pointer items-center py-2 text-sm font-medium text-danger">
          {t("divers.erase.summary", { name: diver.person.fullName })}
        </summary>
        <p className="mt-3 max-w-2xl text-sm text-muted">{t("divers.erase.destroyedNote")}</p>
        <p className="mt-2 max-w-2xl text-sm text-muted">{t("divers.erase.keptNote")}</p>
        <p className="mt-2 max-w-2xl text-sm font-medium text-danger">
          {t("divers.erase.noUndoNote")}
        </p>
        <form
          action={erasePersonAction.bind(null, shopSlug, personId)}
          className="mt-4 flex flex-wrap items-end gap-3"
        >
          <Field
            label={t("divers.erase.confirmLabel", { name: diver.person.fullName })}
            hint={t("divers.erase.confirmHint")}
          >
            <input
              name="confirmName"
              required
              autoComplete="off"
              className={controlClass}
              placeholder={diver.person.fullName}
            />
          </Field>
          <SubmitButton
            pendingLabel={t("divers.erase.erasing")}
            className={buttonClass({ variant: "danger-solid" })}
          >
            {t("divers.erase.eraseDiver")}
          </SubmitButton>
        </form>
      </details>
    </section>
  );
}
