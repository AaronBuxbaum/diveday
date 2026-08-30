import type { ReactNode } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { InsetGroup } from "@/components/ui/ledger";
import { rentableItemLabel, rentalFitLineText, rentalItemLabel } from "@/i18n/rental-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { rentalFitLine } from "@/lib/dive-prep";
import { cachedListFormat } from "@/lib/intl-cache";
import { offeredRentableItems } from "@/lib/rentals";
import { saveProfileAction, setNeedsStaffFitAction } from "../actions";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";
import { DiverFileGroupDisclosure } from "./DiverFileGroupDisclosure";
import { RentalFitFields, type RentalFitSize } from "./RentalFitFields";
import type { DiverProfile } from "./shared";

/**
 * **Gear and sizes — two facts and a way to change them** (ADR
 * 20260827-people-not-lists, decision 1: "Gear & sizes (edit in place)").
 *
 * The section this replaces was a heading, a caption, a nine-control form
 * always open, and a second bordered card beneath it for the hands-on-fitting
 * flag — four boxes for a fact that reads in one line. What a staffer opening
 * a record wants to know is what this diver rents and what sizes to pull; the
 * form is what they want *sometimes*, so it is behind the one disclosure and
 * the two rows lead.
 *
 * Nothing about the rules moved. Recording a first fit is data entry, open to
 * whoever took the call; rewriting one already on file is the gated override
 * (H-06, `canPersonOverrideGearRequest`). Raising the can't-fill flag stays
 * open to every staff member — the captain who finds the empty rack is exactly
 * who needs it — and clearing it stays the judgement call.
 */

/** One label/value row of the group. The settings grammar, which is the file's. */
function FactRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-baseline sm:gap-6 sm:px-6">
      <span className="shrink-0 text-sm text-muted sm:w-40">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

export function GearAndSizes({
  diver,
  shopSlug,
  personId,
  rentalItems,
  canOverride,
  locale,
  t,
  status,
}: {
  diver: DiverProfile;
  shopSlug: string;
  personId: string;
  rentalItems: string[];
  /** Instructor/divemaster/manager may rewrite the diver's stated fit (H-06). */
  canOverride: boolean;
  locale: string;
  t: StaffTranslator;
  /** This group's own outcome, beside the form that earned it. */
  status?: DiverNotice;
}) {
  const profile = diver.rentalFit;
  const mayEdit = canOverride || !profile;
  const offered = offeredRentableItems(rentalItems);
  const offers = new Set(offered.map((item) => item.kind));
  const line = rentalFitLine(profile ?? null);
  const list = cachedListFormat(locale, { style: "long", type: "unit" });
  // Only sizes the shop can actually hand over. `requires` is the second half
  // of that question — which ticks make this size worth asking for — and it is
  // the client component's to answer, since it changes as the staffer types.
  const sizes: RentalFitSize[] = [
    offers.has("bcd") && {
      name: "bcdSize",
      label: t("divers.rentalFit.bcdSizeLabel"),
      placeholder: t("divers.rentalFit.bcdSizePlaceholder"),
      defaultValue: profile?.bcdSize ?? "",
      requires: ["bcd"],
    },
    offers.has("wetsuit") && {
      name: "wetsuitSize",
      label: t("divers.rentalFit.wetsuitSizeLabel"),
      placeholder: t("divers.rentalFit.wetsuitSizePlaceholder"),
      defaultValue: profile?.wetsuitSize ?? "",
      requires: ["wetsuit"],
    },
    // One shoe-size answer covers fins and boots — the two fields asked the
    // same question, and the save writes it to both columns.
    (offers.has("mask_fins") || offers.has("wetsuit")) && {
      name: "finSize",
      label: t("divers.rentalFit.finSizeLabel"),
      placeholder: t("divers.rentalFit.finSizePlaceholder"),
      defaultValue: profile?.finSize ?? profile?.bootSize ?? "",
      requires: ["maskFins", "wetsuit"],
    },
    offers.has("weights") && {
      name: "weightPreference",
      label: t("divers.rentalFit.weightPreferenceLabel"),
      placeholder: t("divers.rentalFit.weightPreferencePlaceholder"),
      defaultValue: profile?.weightPreference ?? "",
      requires: ["weights"],
    },
  ].filter((size) => size !== false);

  const sized = line.state === "rents" ? line.items.filter((item) => item.size) : [];
  const gearSummary =
    line.state === "rents"
      ? sized.length > 0
        ? sized.map((item) => `${rentalItemLabel(t, item.kind)} ${item.size}`).join(" · ")
        : t("divers.file.noSizes")
      : rentalFitLineText(t, locale, line);
  const flagged = Boolean(profile?.needsStaffFitAt);
  // **Only an outcome this form produced.** All four fit notices carry
  // `form: "fit"` — the two flag controls below the disclosure share it with
  // the size editor inside it — so `Boolean(status)` popped the editor open
  // when a staffer merely cleared a flag, and the "Edit" control they then
  // reached for *closed* it. Saving a fit and being refused one are the two
  // that belong to the box.
  const editorOutcome = status?.code === "profile-saved" || status?.code === "not-authorized-fit";
  // The other two, which belong to the flag form below rather than to the
  // editor — one `form: "fit"` covers all four, so the split is by code.
  const flagOutcome = status?.code === "fit-flagged" || status?.code === "fit-cleared";

  return (
    <DiverFileGroupDisclosure
      id="gear"
      label={t("divers.file.gearHeading")}
      summary={gearSummary}
      open={Boolean(status)}
      className="mt-8"
    >
      <InsetGroup
        as="h2"
        id="gear"
        label={t("divers.file.gearHeading")}
        labelClassName="max-sm:hidden"
        className="scroll-mt-24"
      >
        <FactRow label={t("divers.file.rentsFromUs")}>
          {line.state === "rents"
            ? list.format(line.items.map((item) => rentalItemLabel(t, item.kind)))
            : rentalFitLineText(t, locale, line)}
        </FactRow>
        {line.state === "rents" ? (
          <FactRow label={t("divers.file.sizes")}>
            {sized.length > 0
              ? sized.map((item) => `${rentalItemLabel(t, item.kind)} ${item.size}`).join(" · ")
              : t("divers.file.noSizes")}
          </FactRow>
        ) : null}
        {mayEdit ? (
          <details
            className="group px-5 py-3 sm:px-6"
            // Open when *this form* has an outcome to show. The save redirects
            // and the record re-renders with its disclosures shut, so the
            // "Saved." this form is about would otherwise sit inside a closed
            // box and the staffer be told nothing at all. `undefined` rather
            // than `false` for every other render: a `<details>` React drives
            // to `open={false}` cannot be opened by the reader's own tap.
            open={editorOutcome || undefined}
          >
            <summary
              className={buttonClass({
                variant: "secondary",
                size: "sm",
                className: "w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden",
              })}
            >
              {t("divers.file.editSizes")}
              <DisclosureCaret direction="down" className="group-open:rotate-180" />
            </summary>
            <FieldGrid
              as="form"
              action={saveProfileAction.bind(null, shopSlug, personId)}
              columns={2}
              className="mt-4 gap-y-3"
            >
              <RentalFitFields
                legend={t("divers.rentalFit.rentsFromShop")}
                toggles={offered.map(({ kind, name, field, defaultRented }) => ({
                  name,
                  label: rentableItemLabel(t, kind),
                  defaultChecked: profile?.[field] ?? defaultRented,
                }))}
                /* The shop's catalog decides which sizes exist at all; the
                   ticks above decide which of them are asked for. */
                sizes={sizes}
              />
              <FieldActions>
                <SubmitButton
                  pendingLabel={t("divers.rentalFit.saving")}
                  className={buttonClass({ variant: "secondary" })}
                >
                  {t("divers.rentalFit.saveRentalFit")}
                </SubmitButton>
                <DiverFormStatus status={editorOutcome ? status : undefined} />
              </FieldActions>
            </FieldGrid>
          </details>
        ) : (
          <div className="px-5 py-4 sm:px-6">
            <p className="text-sm text-muted">{t("divers.rentalFit.changeRestricted")}</p>
            {/* No editable form to hang it on, and a refusal aimed at this
                group still belongs in it. */}
            <DiverFormStatus status={status} className="mt-3" />
          </div>
        )}
        {/* The H-06 safe fallback: when the shop can't fill a requested size,
            flag the diver for hands-on fitting instead of packing a size they
            never chose. Only ever offered once a fit exists — there is nothing
            to fall back *from* otherwise. */}
        {profile ? (
          <form
            action={setNeedsStaffFitAction.bind(null, shopSlug, personId)}
            className="px-5 py-4 sm:px-6"
          >
            <p className={`font-medium ${flagged ? "text-warning-strong" : ""}`.trim()}>
              {flagged
                ? t("divers.rentalFit.flaggedHeading")
                : t("divers.rentalFit.cantFillHeading")}
            </p>
            <p className="mt-1 text-sm text-muted">
              {flagged ? t("divers.rentalFit.flaggedBody") : t("divers.rentalFit.cantFillBody")}
            </p>
            {flagged ? (
              <>
                {profile.needsStaffFitNote ? (
                  <p className="mt-2 text-sm font-medium">{profile.needsStaffFitNote}</p>
                ) : null}
                {canOverride ? (
                  <SubmitButton
                    pendingLabel={t("divers.rentalFit.clearing")}
                    className={buttonClass({ variant: "secondary", size: "sm", className: "mt-3" })}
                  >
                    {t("divers.rentalFit.fitResolved")}
                  </SubmitButton>
                ) : (
                  <p className="mt-3 text-sm text-muted">
                    {t("divers.rentalFit.clearingRestricted")}
                  </p>
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
                  {/* The checkbox the action reads; this form only sets the flag. */}
                  <input type="hidden" name="needed" value="on" />
                  <SubmitButton
                    pendingLabel={t("divers.rentalFit.flagging")}
                    className={buttonClass({ variant: "secondary", size: "sm" })}
                  >
                    {t("divers.rentalFit.flagForStaffFit")}
                  </SubmitButton>
                </FieldActions>
              </FieldGrid>
            )}
            {/* Beside the control that produced it. Flagging and resolving both
                answer here rather than inside the size editor's disclosure,
                which is a different form and had nothing to do with the tap. */}
            <DiverFormStatus status={flagOutcome ? status : undefined} className="mt-3" />
          </form>
        ) : null}
      </InsetGroup>
    </DiverFileGroupDisclosure>
  );
}
