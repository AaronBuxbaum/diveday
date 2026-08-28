import type { ReactNode } from "react";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { FieldErrorFocus } from "@/components/ui/FieldErrorFocus";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { maxPlausibleBirthDate } from "@/lib/age";
import { mailtoHref, telHref } from "@/lib/contact-links";
import { savePersonAction } from "../actions";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";
import type { DiverProfile } from "./shared";

/**
 * **The masthead** — who this is, how to reach them, and the record's one
 * primary act (ADR 20260827-people-not-lists, decision 1).
 *
 * The eyebrow is the way back up rather than a separate "← All divers" line
 * above the header: the word that names the parent becomes the door to it, in
 * the page's own column, which is the pattern the settings sub-pages already
 * use.
 *
 * **Book a departure is the page's one primary control**, and the only one:
 * this record used to carry three to four primary-weight buttons and lead with
 * money. Its disclosure sits on the line beneath the header rather than in the
 * header's right-hand column, because the column is the width of its buttons
 * and the picker that drops out of it is a full-width form — the same call the
 * details editor already made here, for the same reason.
 * `_lib/record-primaries.test.ts` fails the build if a second primary joins it.
 */
export function DiverHeader({
  diver,
  shopSlug,
  personId,
  t,
  status,
  editOpen = false,
  book,
  moment,
  visits,
}: {
  diver: DiverProfile;
  shopSlug: string;
  personId: string;
  t: StaffTranslator;
  /** This form's own outcome, rendered in its action row rather than page-top. */
  status?: DiverNotice;
  /**
   * Starts the details form expanded. Set right after the roster's three-field
   * "Add a diver" form lands here: the record exists but holds a name and
   * maybe an email, and everything that makes it useful — date of birth,
   * insurance, emergency contact — is behind a disclosure the front desk had
   * to know to open. Also set for a refused save, so the staffer can correct
   * the fields in place.
   */
  editOpen?: boolean;
  /**
   * The one primary: "Book a departure" and the trip picker it discloses.
   * Absent for a removed diver, who may not be seated onto a boat at all.
   */
  book?: ReactNode;
  /**
   * The record's one earned moment — the coral line that appears when the act
   * a staffer just took cleared the last open item, and nowhere else
   * (20260827-clearwater-surface-language, decision 11).
   */
  moment?: ReactNode;
  /** How many times this diver has been out with the shop, sailed plus imported. */
  visits: number;
}) {
  const formStatus = status?.tone === "danger" ? status : undefined;
  return (
    <>
      <ShopPageHeader
        eyebrow={t("divers.page.title")}
        eyebrowHref={`/shop/${shopSlug}/divers`}
        title={diver.person.fullName}
        align="start"
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            {/* `mailtoHref`/`telHref` (src/lib/contact-links.ts), not a template
                string with the sanitizing regex copied in beside it: a shop
                stores a number the way it prints it, and a `tel:` URI carrying
                spaces and parentheses is refused outright by several diallers —
                which is the one tap on this page a staffer makes with a diver
                already on the phone. Both links are button-shaped and go
                through `buttonClass` for it, so the 44px target is structural
                rather than a remembered `min-h-11`. */}
            {diver.person.email ? (
              <a
                href={mailtoHref(diver.person.email)}
                className={buttonClass({
                  variant: "link",
                  size: "sm",
                  flush: true,
                  className: "hover:underline",
                })}
              >
                {diver.person.email}
              </a>
            ) : null}
            {diver.person.phone ? (
              <a
                href={telHref(diver.person.phone)}
                className={buttonClass({
                  variant: "link",
                  size: "sm",
                  flush: true,
                  className: "hover:underline",
                })}
              >
                {diver.person.phone}
              </a>
            ) : null}
            {!diver.person.email && !diver.person.phone ? (
              <span>{t("divers.header.noContactDetails")}</span>
            ) : null}
            {diver.person.diveInsurance ? (
              <span>
                <span className="sr-only">{t("divers.header.diveInsurancePrefix")}</span>
                {diver.person.diveInsurance}
              </span>
            ) : null}
            {visits > 0 ? (
              <span className="tabular-nums">{t("divers.header.visits", { count: visits })}</span>
            ) : null}
          </div>
        }
      />
      {moment}
      {status?.tone === "success" ? <DiverFormStatus status={status} className="-mt-4" /> : null}
      <div className="mt-1 flex flex-wrap items-start gap-2">
        {book}
        <details open={editOpen} className="group open:w-full">
          <summary
            id="edit-details"
            className={buttonClass({
              variant: "secondary",
              size: "sm",
              className: "w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden",
            })}
          >
            {t("divers.header.editDetails")}
            <DisclosureCaret direction="down" className="group-open:rotate-180" />
          </summary>
          <FieldGrid
            as="form"
            action={savePersonAction.bind(null, shopSlug, personId)}
            columns={2}
            className={sectionCardClass({ className: "mt-3 w-full gap-y-3" })}
          >
            <Field label={t("divers.header.fullNameLabel")}>
              <input
                name="fullName"
                required
                defaultValue={diver.person.fullName}
                className={controlClass}
              />
            </Field>
            {/* The one refusal on this form the server can point at exactly: an
                email another active diver already holds. It belongs on the box,
                not in a sentence beside the button — and `Field`'s `error` wires
                `aria-invalid`/`aria-describedby`, which is what `FieldErrorFocus`
                below finds to put the cursor there. */}
            <Field
              label={t("divers.header.emailLabel")}
              hint={t("divers.header.optionalHint")}
              htmlFor="diver-email"
              error={formStatus?.field === "diver-email" ? formStatus.text : undefined}
            >
              <input
                id="diver-email"
                name="email"
                type="email"
                defaultValue={diver.person.email ?? ""}
                className={controlClass}
              />
            </Field>
            <Field label={t("divers.header.phoneLabel")} hint={t("divers.header.optionalHint")}>
              <input
                name="phone"
                type="tel"
                defaultValue={diver.person.phone ?? ""}
                className={controlClass}
              />
            </Field>
            <Field
              label={t("divers.header.dateOfBirthLabel")}
              hint={t("divers.header.optionalHint")}
            >
              <input
                name="dateOfBirth"
                type="date"
                // Mirrors the server-side plausibility bound so a mistyped year
                // is caught in the field, not by a redirect to `?notice=invalid`.
                max={maxPlausibleBirthDate()}
                min="1900-01-01"
                defaultValue={diver.person.dateOfBirth ?? ""}
                className={controlClass}
              />
            </Field>
            <Field
              label={t("divers.header.diveInsuranceFieldLabel")}
              hint={t("divers.header.optionalHint")}
              description={t("divers.header.diveInsuranceDescription")}
            >
              <input
                name="diveInsurance"
                defaultValue={diver.person.diveInsurance ?? ""}
                placeholder={t("divers.header.diveInsurancePlaceholder")}
                className={controlClass}
              />
            </Field>
            {/* Task 144 — Today used to tell staff to "ask at the counter" and
                link to a roster with nowhere to type it in. This and the
                roster's per-diver card are the two staff entry points; both
                write through the same columns the diver's own /ready and
                /waivers capture use, and it prints on the manifest. */}
            <Field
              label={t("divers.header.emergencyContactNameLabel")}
              hint={t("divers.header.optionalHint")}
            >
              <input
                name="emergencyContactName"
                autoComplete="name"
                defaultValue={diver.person.emergencyContactName ?? ""}
                className={controlClass}
              />
            </Field>
            <Field
              label={t("divers.header.emergencyContactPhoneLabel")}
              hint={t("divers.header.optionalHint")}
            >
              <input
                name="emergencyContactPhone"
                type="tel"
                autoComplete="tel"
                defaultValue={diver.person.emergencyContactPhone ?? ""}
                className={controlClass}
              />
            </Field>
            <FieldActions>
              {/* `busy`: it disables itself for its own save, which is "this is
                  happening", not "you cannot do this". */}
              <SubmitButton
                pendingLabel={t("divers.header.saving")}
                className={buttonClass({ variant: "secondary", busy: true })}
              >
                {t("divers.header.saveDetails")}
              </SubmitButton>
              {/* A field-level refusal already renders on its own control, so
                  repeating it here would say the same thing twice. */}
              {formStatus?.field ? null : <DiverFormStatus status={formStatus} />}
            </FieldActions>
          </FieldGrid>
        </details>
      </div>
      {/* Keyed on the notice text so an identical repeat refusal still re-fires:
          the effect only runs on a remount, and typing a second duplicate email
          produces the same URL as the first. */}
      {formStatus?.field ? (
        <FieldErrorFocus key={formStatus.text} field={formStatus.field} />
      ) : null}
    </>
  );
}
