import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { rentableItemLabel, rentalFitLineText } from "@/i18n/rental-labels";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { rentalFitLine } from "@/lib/dive-prep";
import { offeredRentableItems } from "@/lib/rentals";
import { saveProfileAction, setNeedsStaffFitAction } from "../actions";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";
import type { DiverProfile } from "./shared";

export function RentalFit({
  diver,
  shopSlug,
  personId,
  rentalItems,
  canOverride,
  locale,
  status,
}: {
  diver: DiverProfile;
  shopSlug: string;
  personId: string;
  rentalItems: string[];
  /** Instructor/divemaster/manager may rewrite the diver's stated fit (H-06). */
  canOverride: boolean;
  locale: string;
  /**
   * This section's own outcome. Rental fit sits about halfway down a ~6,400px
   * record, so "Rental fit profile saved" in a banner under the `<h1>` was a
   * confirmation two screens above the button that earned it.
   */
  status?: DiverNotice;
}) {
  const t = staffTranslator(locale);
  const profile = diver.rentalFit;
  // Recording a first fit is data entry, open to any staff member; only
  // rewriting one already on file is the gated override (H-06).
  const mayEdit = canOverride || !profile;
  const offered = offeredRentableItems(rentalItems);
  const offers = new Set(offered.map((item) => item.kind));
  return (
    <section className="mt-10 border-t border-border pt-8" aria-labelledby="rental-fit-heading">
      <div>
        <h2 id="rental-fit-heading" className="text-lg font-semibold">
          {t("divers.rentalFit.heading")}
        </h2>
        <p className="mt-1 text-sm text-muted">{t("divers.rentalFit.description")}</p>
      </div>
      {mayEdit ? null : (
        <>
          <p className="mt-4 rounded-lg border border-border bg-surface-sunken px-4 py-3 text-sm text-muted">
            <span className="font-medium text-foreground">
              {rentalFitLineText(t, locale, rentalFitLine(profile ?? null))}
            </span>
            <br />
            {t("divers.rentalFit.changeRestricted")}
          </p>
          {/* No editable form to hang it on, and a refusal aimed at this
              section still belongs in it — a staffer who may only raise the
              check-in flag gets their "not authorized" here, not page-top. */}
          <DiverFormStatus status={status} shopSlug={shopSlug} locale={locale} className="mt-3" />
        </>
      )}

      {mayEdit ? (
        <FieldGrid
          as="form"
          action={saveProfileAction.bind(null, shopSlug, personId)}
          columns={2}
          // `padding="lg"`: a card someone works *inside*, and the same shell
          // the fallback form below it wears.
          className={sectionCardClass({ padding: "lg", className: "mt-4" })}
        >
          {offered.length > 0 ? (
            <fieldset className="sm:col-span-2">
              <legend className="text-sm font-medium">{t("divers.rentalFit.rentsFromShop")}</legend>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {offered.map(({ kind, name, field, defaultRented }) => (
                  <label
                    key={name}
                    className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm"
                  >
                    <input
                      name={name}
                      type="checkbox"
                      defaultChecked={profile?.[field] ?? defaultRented}
                      className="size-4 accent-primary"
                    />
                    {rentableItemLabel(t, kind)}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          {offers.has("bcd") ? (
            <Field label={t("divers.rentalFit.bcdSizeLabel")}>
              <input
                name="bcdSize"
                defaultValue={profile?.bcdSize ?? ""}
                placeholder={t("divers.rentalFit.bcdSizePlaceholder")}
                className={controlClass}
              />
            </Field>
          ) : null}
          {offers.has("wetsuit") ? (
            <Field label={t("divers.rentalFit.wetsuitSizeLabel")}>
              <input
                name="wetsuitSize"
                defaultValue={profile?.wetsuitSize ?? ""}
                placeholder={t("divers.rentalFit.wetsuitSizePlaceholder")}
                className={controlClass}
              />
            </Field>
          ) : null}
          {/* One shoe-size answer covers fins and boots — the two fields asked
              the same question, and the save writes it to both columns. */}
          {offers.has("mask_fins") || offers.has("wetsuit") ? (
            <Field label={t("divers.rentalFit.finSizeLabel")}>
              <input
                name="finSize"
                defaultValue={profile?.finSize ?? profile?.bootSize ?? ""}
                placeholder={t("divers.rentalFit.finSizePlaceholder")}
                className={controlClass}
              />
            </Field>
          ) : null}
          {offers.has("weights") ? (
            <Field label={t("divers.rentalFit.weightPreferenceLabel")} className="sm:col-span-2">
              <input
                name="weightPreference"
                defaultValue={profile?.weightPreference ?? ""}
                placeholder={t("divers.rentalFit.weightPreferencePlaceholder")}
                className={controlClass}
              />
            </Field>
          ) : null}
          <FieldActions>
            <SubmitButton
              pendingLabel={t("divers.rentalFit.saving")}
              className={buttonClass({ size: "lg" })}
            >
              {t("divers.rentalFit.saveRentalFit")}
            </SubmitButton>
            <DiverFormStatus status={status} shopSlug={shopSlug} locale={locale} />
          </FieldActions>
        </FieldGrid>
      ) : null}

      <StaffFitFallback
        profile={profile}
        shopSlug={shopSlug}
        personId={personId}
        hasFit={Boolean(profile)}
        canResolve={canOverride}
        t={t}
      />
    </section>
  );
}

/**
 * The H-06 safe fallback: when the shop can't fill a requested size, flag the
 * diver for hands-on fitting instead of packing a size they never chose.
 *
 * *Raising* the flag is open to every staff member — it escalates to a person
 * rather than overwriting what the diver asked for, and the captain who finds
 * the empty rack is exactly who needs it. *Clearing* it is the judgement call
 * ("we can pack her stated size after all"), so it takes the same gate as
 * editing the fit: an unattributed one-tap clear would put a diver back into
 * gear nobody re-checked, which is the very thing stickiness protects against.
 */
function StaffFitFallback({
  profile,
  shopSlug,
  personId,
  hasFit,
  canResolve,
  t,
}: {
  profile: DiverProfile["rentalFit"];
  shopSlug: string;
  personId: string;
  hasFit: boolean;
  canResolve: boolean;
  t: StaffTranslator;
}) {
  const flagged = Boolean(profile?.needsStaffFitAt);
  if (!hasFit) return null;
  return (
    <form
      action={setNeedsStaffFitAction.bind(null, shopSlug, personId)}
      // Flagged is a *tone* variant, not a second card: it keeps the canonical
      // geometry (radius, `padding="lg"`, elevation) and changes only the
      // border and fill, so raising the flag never restyles the box's shape.
      className={
        flagged
          ? "mt-4 rounded-2xl border border-warning/40 bg-warning/5 p-5 shadow-sm sm:p-6"
          : sectionCardClass({ padding: "lg", className: "mt-4" })
      }
    >
      <h3 className="text-sm font-medium">
        {flagged ? t("divers.rentalFit.flaggedHeading") : t("divers.rentalFit.cantFillHeading")}
      </h3>
      <p className="mt-1 text-sm text-muted">
        {flagged ? t("divers.rentalFit.flaggedBody") : t("divers.rentalFit.cantFillBody")}
      </p>
      {flagged ? (
        <>
          {profile?.needsStaffFitNote ? (
            <p className="mt-2 text-sm font-medium">{profile.needsStaffFitNote}</p>
          ) : null}
          {canResolve ? (
            <SubmitButton
              pendingLabel={t("divers.rentalFit.clearing")}
              className={buttonClass({ variant: "secondary", className: "mt-4" })}
            >
              {t("divers.rentalFit.fitResolved")}
            </SubmitButton>
          ) : (
            <p className="mt-3 text-sm text-muted">{t("divers.rentalFit.clearingRestricted")}</p>
          )}
        </>
      ) : (
        <FieldGrid columns={1} className="mt-3">
          <Field
            label={t("divers.rentalFit.whatsShortLabel")}
            hint={t("divers.rentalFit.optionalHint")}
          >
            <input
              name="needsStaffFitNote"
              maxLength={200}
              placeholder={t("divers.rentalFit.whatsShortPlaceholder")}
              className={controlClass}
            />
          </Field>
          <FieldActions>
            {/* The checkbox the action reads; checked because this form only sets the flag. */}
            <input type="hidden" name="needed" value="on" />
            <SubmitButton
              pendingLabel={t("divers.rentalFit.flagging")}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("divers.rentalFit.flagForStaffFit")}
            </SubmitButton>
          </FieldActions>
        </FieldGrid>
      )}
    </form>
  );
}
