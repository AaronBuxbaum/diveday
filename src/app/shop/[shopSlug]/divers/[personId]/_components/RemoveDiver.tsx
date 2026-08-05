import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { staffTranslator } from "@/i18n/staff-messages";
import { deletePersonAction } from "../actions";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";
import type { DiverProfile } from "./shared";

export function RemoveDiver({
  diver,
  shopSlug,
  personId,
  locale,
  status,
}: {
  diver: DiverProfile;
  shopSlug: string;
  personId: string;
  locale: string;
  /** This section's own outcome — a permission refusal stays with its control. */
  status?: DiverNotice;
}) {
  const t = staffTranslator(locale);
  return (
    <section className="mt-12 border-t border-border pt-8" aria-labelledby="remove-heading">
      <h2 id="remove-heading" className="text-lg font-semibold">
        {t("divers.remove.heading")}
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">{t("divers.remove.description")}</p>
      {/* Opened by its own outcome: a refusal rendered inside a shut
          disclosure is invisible, which is worse than page-top. */}
      <details
        open={Boolean(status)}
        className="mt-4 rounded-lg border border-danger/30 bg-danger/5 p-4"
      >
        <summary className="flex min-h-11 cursor-pointer items-center py-2 text-sm font-medium text-danger">
          {t("divers.remove.removePersonSummary", { name: diver.person.fullName })}
        </summary>
        <form
          action={deletePersonAction.bind(null, shopSlug, personId)}
          className="mt-3 flex flex-wrap items-center gap-3"
        >
          <p className="text-sm text-muted">{t("divers.remove.addAgainNote")}</p>
          <SubmitButton
            pendingLabel={t("divers.remove.removing")}
            className={buttonClass({ variant: "danger-solid" })}
          >
            {t("divers.remove.removeDiver")}
          </SubmitButton>
          <DiverFormStatus status={status} shopSlug={shopSlug} locale={locale} />
        </form>
      </details>
    </section>
  );
}
