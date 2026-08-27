import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import type { DiverMergeCandidate } from "@/db/diver-merge";
import { staffTranslator } from "@/i18n/staff-messages";
import { mergeDiverAction } from "../actions";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";

function contactLine(email: string | null, phone: string | null, missing: string): string {
  return [email, phone].filter(Boolean).join(" · ") || missing;
}

export function MergeDiver({
  candidates,
  shopSlug,
  personId,
  locale,
  status,
}: {
  candidates: DiverMergeCandidate[];
  shopSlug: string;
  personId: string;
  locale: string;
  status?: DiverNotice;
}) {
  const t = staffTranslator(locale);
  if (candidates.length === 0) {
    return <DiverFormStatus status={status} shopSlug={shopSlug} locale={locale} className="mt-6" />;
  }
  /**
   * Candidates only. The record being viewed used to head this list, checked by
   * default -- but the form posts one id and the action always merges the
   * route's diver *into* it, so choosing "keep this record" posted
   * `survivorId === personId`, which `mergeDiverRecords` refuses outright. The
   * default option was the one option that could never work, and the refusal
   * told the staffer to choose, which is what they had done.
   */
  const options = candidates.map((candidate) => ({
    id: candidate.id,
    name: candidate.fullName,
    contact: contactLine(candidate.email, candidate.phone, t("divers.merge.noContact")),
    reasons: candidate.reasons,
  }));

  return (
    <section
      aria-labelledby="merge-heading"
      className={sectionCardClass({ className: "mt-6 border-warning/40 bg-warning/5" })}
    >
      <h2 id="merge-heading" className="text-lg font-semibold">
        {t("divers.merge.heading")}
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">{t("divers.merge.description")}</p>
      <p className="mt-3 max-w-2xl text-sm font-medium text-warning-strong">
        {t("divers.merge.warning")}
      </p>
      <form
        action={mergeDiverAction.bind(null, shopSlug, personId)}
        className="mt-4 flex flex-col gap-3"
      >
        <fieldset className="grid gap-2">
          <legend className="sr-only">{t("divers.merge.survivorLabel")}</legend>
          {options.map((option, index) => (
            <label
              key={option.id}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface p-3 has-[:checked]:border-primary has-[:checked]:ring-2 has-[:checked]:ring-primary/20"
            >
              <input
                type="radio"
                name="survivorId"
                value={option.id}
                defaultChecked={index === 0}
                required
                className="mt-1 size-4 accent-primary"
              />
              <span className="min-w-0">
                <span className="block font-medium">
                  {t("divers.merge.keepCandidate", { name: option.name })}
                </span>
                <span className="mt-0.5 block text-sm text-muted">{option.contact}</span>
                {option.reasons.length > 0 ? (
                  <span className="mt-1 block text-xs text-warning-strong">
                    {option.reasons
                      .map((reason) =>
                        reason === "same_phone"
                          ? t("divers.merge.samePhone")
                          : t("divers.merge.sameName"),
                      )
                      .join(" · ")}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton
            pendingLabel={t("divers.merge.pending")}
            confirmMessage={t("divers.merge.confirm")}
            className={buttonClass({ variant: "danger-ghost" })}
          >
            {t("divers.merge.submit")}
          </SubmitButton>
          <DiverFormStatus status={status} shopSlug={shopSlug} locale={locale} />
        </div>
      </form>
    </section>
  );
}
