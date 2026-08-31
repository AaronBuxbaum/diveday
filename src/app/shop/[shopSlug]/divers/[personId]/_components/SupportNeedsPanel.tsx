import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { InsetGroup } from "@/components/ui/ledger";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { supportNeedsLines } from "@/i18n/support-needs-labels";
import type { SupportNeeds } from "@/lib/support-needs";
import { saveSupportNeedsAction } from "../actions";
import { DiverFileGroupDisclosure } from "./DiverFileGroupDisclosure";
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
  t,
  status,
}: {
  needs: SupportNeeds | null;
  shopSlug: string;
  personId: string;
  /** Rewriting what a diver already stated is the judgement call — see the action. */
  canOverride: boolean;
  t: StaffTranslator;
  /** This group's own outcome, beside the form that earned it. */
  status?: DiverNotice;
}) {
  // Recording arrangements nobody has stated yet is data entry, open to whoever
  // took the call. Overwriting the diver's own answer is gated.
  const mayEdit = canOverride || !needs;
  // No roster here: this is the diver's record, not a departure, so the "dives
  // with" line states the constraint and says nothing about whether that person
  // is booked. That question belongs to a boat.
  const stated = supportNeedsLines(t, needs);
  const supportSummary =
    stated.length > 0
      ? t("divers.file.supportCount", { count: stated.length })
      : t("divers.file.noSupport");

  return (
    <DiverFileGroupDisclosure
      id="support"
      label={t("divers.support.heading")}
      summary={supportSummary}
      open={Boolean(status)}
      desktopCollapsible
      className="mt-8"
    >
      <InsetGroup
        as="h2"
        id="support"
        label={t("divers.support.heading")}
        labelClassName="max-sm:hidden"
        className="scroll-mt-24"
      >
        <div className="px-5 py-4 sm:px-6">
          <p className="text-sm text-muted">{t("divers.support.description")}</p>
        </div>

        {mayEdit ? (
          <FieldGrid
            as="form"
            action={saveSupportNeedsAction.bind(null, shopSlug, personId)}
            columns={1}
            className="px-5 py-5 sm:px-6"
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
              <legend className="text-sm font-semibold">
                {t("divers.support.boardingLegend")}
              </legend>
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
              <legend className="text-sm font-semibold">
                {t("divers.support.briefingLegend")}
              </legend>
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
              <DiverFormStatus status={status} />
            </FieldActions>
          </FieldGrid>
        ) : (
          <div className="px-5 py-4 text-sm text-muted sm:px-6">
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
            {/* A refusal aimed at this section belongs in it, and there is no
                editable form here to hang it on. */}
            <DiverFormStatus status={status} className="mt-3" />
          </div>
        )}
      </InsetGroup>
    </DiverFileGroupDisclosure>
  );
}
