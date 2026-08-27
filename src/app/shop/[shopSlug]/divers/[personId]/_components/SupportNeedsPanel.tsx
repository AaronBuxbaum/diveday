import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { staffTranslator } from "@/i18n/staff-messages";
import { supportNeedsLines } from "@/i18n/support-needs-labels";
import type { SupportNeeds } from "@/lib/support-needs";
import { saveSupportNeedsAction } from "../actions";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";

/**
 * **The shop's copy of what a diver's dive needs set up** (issue #1069).
 *
 * The record's author is the diver, on `/ready/[token]`, and that is the ADR's
 * decision and stands — this is a second door, not a replacement. It exists
 * because adaptive divers frequently book by **phone**, precisely so they can
 * talk to a human about arrangements before committing: the shop took the whole
 * conversation and had nowhere to put it, and the best it could do was ask the
 * diver to go and find the link in their email. Walk-ups without a smartphone
 * had the same problem. It was sharper than that — the prep panel links each
 * diver's name to this record, and what a staffer had just been reading was
 * invisible on the page they landed on, next to an editable rental fit.
 *
 * **Tone is the load-bearing part.** `src/lib/dive-recency.ts` is the standard:
 * a fact to plan around, never a warning, and never anything that reads as a
 * medical note about a person. Every question is about the *dive* — how many
 * hands in the water, getting aboard, how the briefing arrives — and none is
 * about the diver. There is no condition to declare, and nothing here gates
 * anything.
 *
 * A staff entry is deliberately **not** marked as one; `saveSupportNeedsAction`
 * carries the reasoning.
 */
export function SupportNeedsPanel({
  needs,
  shopSlug,
  personId,
  canOverride,
  locale,
  status,
}: {
  needs: SupportNeeds | null;
  shopSlug: string;
  personId: string;
  /** Rewriting what a diver already stated is the judgement call — see the action. */
  canOverride: boolean;
  locale: string;
  /** This section's own outcome, beside the form that earned it. */
  status?: DiverNotice;
}) {
  const t = staffTranslator(locale);
  // Recording arrangements nobody has stated yet is data entry, open to whoever
  // took the call. Overwriting the diver's own answer is gated.
  const mayEdit = canOverride || !needs;
  // No roster here: this is the diver's record, not a departure, so the "dives
  // with" line states the constraint and says nothing about whether that person
  // is booked. That question belongs to a boat.
  const stated = supportNeedsLines(t, needs);

  return (
    <section className="mt-10" aria-labelledby="support-heading">
      <h2 id="support-heading" className="text-lg font-semibold">
        {t("divers.support.heading")}
      </h2>
      <p className="mt-1 text-sm text-muted">{t("divers.support.description")}</p>

      {mayEdit ? null : (
        <>
          <div className="mt-4 rounded-lg border border-border bg-surface-sunken px-4 py-3 text-sm text-muted">
            {stated.length > 0 ? (
              <ul className="font-medium text-foreground">
                {stated.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
            <p className={stated.length > 0 ? "mt-2" : undefined}>
              {t("divers.support.changeRestricted")}
            </p>
          </div>
          {/* A refusal aimed at this section belongs in it, and there is no
              editable form here to hang it on. */}
          <DiverFormStatus status={status} shopSlug={shopSlug} locale={locale} className="mt-3" />
        </>
      )}

      {mayEdit ? (
        <FieldGrid
          as="form"
          action={saveSupportNeedsAction.bind(null, shopSlug, personId)}
          columns={1}
          className={sectionCardClass({ padding: "lg", className: "mt-4" })}
        >
          {/* **How many, and who brings them** — two questions, because the
              shop's action is opposite in each: "we arrange them" is more crew
              to roster, "they're coming with the diver" is more seats to book
              and a buddy team to build. The same split `/ready` asks for. */}
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold">
              {t("divers.support.supportDiversLegend")}
            </legend>
            {(
              [
                ["", "supportDiversNone"],
                ["shop", "supportDiversFromShop"],
                ["diver", "supportDiversOwn"],
              ] as const
            ).map(([value, key]) => (
              <label key={key} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="supportDiversProvidedBy"
                  value={value}
                  defaultChecked={(needs?.supportDiversProvidedBy ?? "") === value}
                  className="size-4"
                />
                <span>{t(`divers.support.${key}`)}</span>
              </label>
            ))}
          </fieldset>
          <Field
            label={t("divers.support.countLabel")}
            htmlFor="support-divers-count"
            // The ceiling is a typo guard rather than a limit, and has to say
            // so: a browser's own validation bubble would read as a refusal on
            // a record that must never feel like one.
            hint={t("divers.support.countHint")}
          >
            <input
              id="support-divers-count"
              name="supportDiversNeeded"
              type="number"
              inputMode="numeric"
              min={0}
              max={4}
              defaultValue={needs?.supportDiversNeeded ?? ""}
              className={`${controlClass} max-w-24`}
            />
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold">{t("divers.support.boardingLegend")}</legend>
            {(
              [
                ["needsBoardingAssistance", "boardingAssistance", needs?.needsBoardingAssistance],
                ["needsWaterLift", "waterLift", needs?.needsWaterLift],
              ] as const
            ).map(([name, key, checked]) => (
              <label key={name} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name={name}
                  defaultChecked={checked ?? false}
                  className="size-4"
                />
                <span>{t(`divers.support.${key}`)}</span>
              </label>
            ))}
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold">{t("divers.support.briefingLegend")}</legend>
            {(
              [
                ["briefingInSign", "briefingSign", needs?.briefingInSign],
                ["briefingInWriting", "briefingWriting", needs?.briefingInWriting],
                ["briefingAloud", "briefingAloud", needs?.briefingAloud],
                ["briefingBySignals", "briefingSignals", needs?.briefingBySignals],
              ] as const
            ).map(([name, key, checked]) => (
              <label key={name} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name={name}
                  defaultChecked={checked ?? false}
                  className="size-4"
                />
                <span>{t(`divers.support.${key}`)}</span>
              </label>
            ))}
          </fieldset>

          <Field label={t("divers.support.equipmentLabel")} htmlFor="support-equipment">
            <textarea
              id="support-equipment"
              name="equipmentAdaptation"
              rows={2}
              maxLength={300}
              defaultValue={needs?.equipmentAdaptation ?? ""}
              className={controlClass}
            />
          </Field>
          <Field label={t("divers.support.divesWithLabel")} htmlFor="support-dives-with">
            <input
              id="support-dives-with"
              name="divesWithName"
              maxLength={120}
              defaultValue={needs?.divesWithName ?? ""}
              className={controlClass}
            />
          </Field>
          <FieldActions>
            <SubmitButton
              pendingLabel={t("divers.support.saving")}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("divers.support.save")}
            </SubmitButton>
            <DiverFormStatus status={status} shopSlug={shopSlug} locale={locale} />
          </FieldActions>
        </FieldGrid>
      ) : null}
    </section>
  );
}
