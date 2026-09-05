import type { ReactNode } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import type { DiverRentalFit, RentalFitItem } from "@/db/rental-fit";
import type { DiverMessageKey, DiverTranslator } from "@/i18n/messages";
import { cachedListFormat } from "@/lib/intl-cache";
import { SIZED_RENTAL_KINDS, sizeForRentalItem } from "@/lib/rentals";

/**
 * **"Anything changed?"** — the one question a returning diver is asked, and
 * the three facts behind it (ADR 20260904-reef-all-the-way-down, D15 with D19
 * folded in).
 *
 * A diver whose sizes the shop was already holding does not need a settled
 * "Gear and sizes" row they cannot act on. They need to see what is on file and
 * say, in one tap, that none of it moved. So this replaces the gear step
 * (`buildThreadSteps`) rather than sitting beside it, and its primary act is
 * the answer *no*.
 *
 * **Each fact has its own door and its own action.** That is the whole design
 * rather than a detail: a partial post to the dense prep form would clear
 * fields the diver never touched, which is issue #1175's named trap. The sizes
 * door opens the form that already owns every size column and posts all of
 * them; the tanks door writes `bookings.wants_nitrox` and nothing else; the
 * contact door writes a name and a phone and never blanks either.
 *
 * **What is deliberately not here**: the crew note, the support-needs record
 * and the hotel pickup stay inside Day-of details. Support needs are a record
 * about a person's dive (#1179's privacy call), and a confirm-at-a-glance panel
 * is the wrong place to restate one.
 *
 * No drawing, no coral, no motion. Sizes and an emergency contact are
 * safety-adjacent, and Budget rule 8 stands.
 */

/** The sized items' words, diver-side — `RentalFitForm`'s bundle, never the staff map. */
const DIVER_SIZED_ITEM_KEYS: Record<RentalFitItem, DiverMessageKey> = {
  bcd: "rental.itemLabels.bcd",
  wetsuit: "rental.itemLabels.wetsuit",
  boots: "rental.itemLabels.boots",
  mask_fins: "rental.itemLabels.maskFins",
  weights: "rental.itemLabels.weights",
};

/** The recall sentence's three facts, or nothing. Assembled by the page from `fitConfirmation`. */
export type FitRecall = { staffFullName: string; item: RentalFitItem; size: string };

function FactRow({
  label,
  value,
  changeWord,
  children,
  footnote,
}: {
  label: string;
  value: string;
  changeWord: string;
  children: ReactNode;
  /**
   * The recall line, on the row rather than behind its door. It is the reason
   * the value beside it reads as it does, so a diver skimming the three facts
   * has to be able to see it without opening anything.
   */
  footnote?: ReactNode;
}) {
  return (
    <details className="group/fact py-4">
      {/* Every part of the head is phrasing content — `<span>`s and never
          `<p>`s — because `<summary>`'s content model takes phrasing, and a
          paragraph in here is invalid markup browsers silently re-parent. */}
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 py-1 select-none [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{label}</span>
          <span className="block text-base text-muted">{value}</span>
          {footnote ? <span className="mt-1 block text-sm text-muted">{footnote}</span> : null}
        </span>
        <span className="shrink-0 text-sm font-medium text-primary">{changeWord}</span>
        <DisclosureCaret className="text-muted group-open/fact:rotate-90" />
      </summary>
      <div className="pt-4">{children}</div>
    </details>
  );
}

export function ChangedFacts({
  t,
  locale,
  fit,
  wantsNitrox,
  offerNitrox,
  emergencyContact,
  fitRecall,
  fitForm,
  actions,
}: {
  t: DiverTranslator;
  /** For the sizes list's own punctuation — `Intl.ListFormat`, through the cache. */
  locale: string;
  fit: DiverRentalFit | null;
  wantsNitrox: boolean;
  /**
   * The shop fills nitrox and this departure may run on it (`nitroxAvailableOn`,
   * re-derived by the page). False hides the row entirely rather than showing a
   * question with one possible answer.
   */
  offerNitrox: boolean;
  emergencyContact: { name: string | null; phone: string | null };
  /** D14's recall, or null. Null unless the staffer, the item and the size are all on file. */
  fitRecall: FitRecall | null;
  /** The page's own `<RentalFitForm>` node, already bound to `saveFitFromReady`. */
  fitForm: ReactNode;
  actions: {
    confirm: () => void;
    saveTanks: (formData: FormData) => void;
    saveContact: (formData: FormData) => void;
  };
}) {
  const changeWord = t("ready.changeThis");
  const saveButton = buttonClass({ variant: "secondary", size: "sm" });

  // What the shop is holding, item by item — never a summary the page composed.
  // A diver bringing their own kit has no sizes and reads their own answer back
  // (`rental.ownGear`) rather than an empty line.
  const sizes = SIZED_RENTAL_KINDS.map((kind) => {
    const size = sizeForRentalItem(fit, kind);
    return size
      ? t("ready.changesItemWithSize", { item: t(DIVER_SIZED_ITEM_KEYS[kind]), size })
      : null;
  }).filter((part): part is string => part !== null);
  const sizesValue =
    sizes.length > 0
      ? cachedListFormat(locale, { style: "long", type: "unit" }).format(sizes)
      : t("rental.ownGear");

  const contactValue =
    [emergencyContact.name, emergencyContact.phone].filter(Boolean).join(" · ") ||
    t("ready.contactNotOnFile");

  return (
    <div className="divide-y divide-border">
      <FactRow
        label={t("ready.changesSizesLabel")}
        value={sizesValue}
        changeWord={changeWord}
        footnote={
          fitRecall
            ? t("ready.fitKeptByCrew", {
                name: fitRecall.staffFullName,
                item: t(DIVER_SIZED_ITEM_KEYS[fitRecall.item]),
                size: fitRecall.size,
              })
            : null
        }
      >
        {fitForm}
      </FactRow>
      {offerNitrox ? (
        <FactRow
          label={t("ready.changesTanksLabel")}
          value={wantsNitrox ? t("ready.tanksNitrox") : t("ready.tanksAir")}
          changeWord={changeWord}
        >
          <form action={actions.saveTanks} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field label={t("ready.tanksLegend")} htmlFor="changed-tanks" className="flex-1">
              <select
                id="changed-tanks"
                name="nitrox"
                defaultValue={wantsNitrox ? "on" : "air"}
                className={controlClass}
              >
                <option value="air">{t("ready.tanksAir")}</option>
                <option value="on">{t("ready.tanksNitrox")}</option>
              </select>
            </Field>
            <SubmitButton pendingLabel={t("common.saving")} className={saveButton}>
              {t("ready.saveChange")}
            </SubmitButton>
          </form>
        </FactRow>
      ) : null}
      <FactRow label={t("waiver.emergencyContact")} value={contactValue} changeWord={changeWord}>
        {/* The waiver's own two fields and its own bounds, deliberately: this
            writes through the same `saveBookingEmergencyContact`, which never
            lets a blank overwrite what is on file. */}
        <form action={actions.saveContact}>
          <FieldGrid columns={2}>
            <Field label={t("waiver.contactName")} htmlFor="changed-contact-name">
              <input
                id="changed-contact-name"
                name="emergencyContactName"
                autoComplete="name"
                maxLength={120}
                defaultValue={emergencyContact.name ?? ""}
                className={controlClass}
              />
            </Field>
            <Field label={t("waiver.contactPhone")} htmlFor="changed-contact-phone">
              <input
                id="changed-contact-phone"
                name="emergencyContactPhone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={40}
                defaultValue={emergencyContact.phone ?? ""}
                className={controlClass}
              />
            </Field>
          </FieldGrid>
          <div className="mt-3">
            <SubmitButton pendingLabel={t("common.saving")} className={saveButton}>
              {t("ready.saveChange")}
            </SubmitButton>
          </div>
        </form>
      </FactRow>
      {/* The one primary act, and the answer this step expects: nothing moved. */}
      <form action={actions.confirm} className="pt-4">
        <SubmitButton pendingLabel={t("common.saving")} className={buttonClass({ size: "sm" })}>
          {t("ready.changesNothing")}
        </SubmitButton>
      </form>
    </div>
  );
}
