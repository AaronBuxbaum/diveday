import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { AssistPhotoButton } from "@/components/assists/AssistPhotoButton";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { CERTIFICATION_LEVEL_KEYS, SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { addCardAction } from "../card-actions";
import { readCardPhotoAction } from "../card-assist-actions";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";
import { AGENCY_KEYS } from "./shared";

/** The anchor the ledger's "Add certification" lands on: the capture form's own disclosure. */
const ADD_ANCHOR = "card-add";

/** The add-a-card disclosure and its form, as the last list item of the certifications group. */
export function AddCertificationForm({
  t,
  shopSlug,
  personId,
  groupStatus,
  canAssist = false,
}: {
  t: StaffTranslator;
  shopSlug: string;
  personId: string;
  /** The group's own outcome, unless a card-number refusal already sits on its box. */
  groupStatus?: DiverNotice;
  /** Claude can read a card photo into the form (`certscan`); off while assists are dark. */
  canAssist?: boolean;
}) {
  return (
    <>
      {/* `<li>`, not `<div>`: the shell above is a `<ul>`, and a list that
            directly contains anything but a list item is a serious axe
            violation (`only-listitems`) — the count a screen reader is given
            before it starts reading is exactly what stops being true. Every
            non-row block in this group is one for the same reason. */}
      <li className="px-5 py-3 sm:px-6">
        {/* The status ledger's "Add certification" lands here
              (`STATUS_TARGET_ANCHORS.add_card`), and opens it: a fix that
              scrolled to a shut door would leave the form one more tap away. */}
        <AutoOpenDetails
          id={ADD_ANCHOR}
          openOnHash={ADD_ANCHOR}
          className="group scroll-mt-8 print:[&:not([open])]:hidden"
        >
          <summary
            className={buttonClass({
              variant: "link",
              size: "sm",
              flush: true,
              className: "w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden",
            })}
          >
            {t("divers.certifications.addCard")}
            <DisclosureCaret direction="down" className="group-open:rotate-180" />
          </summary>
          {/* No `encType`: a function `action` is a server action, not a
                native form post — React builds the `FormData` and ships it over
                its own transport, so the browser never reads that attribute. */}
          <FieldGrid
            as="form"
            action={addCardAction.bind(null, shopSlug, personId)}
            columns={2}
            // Flat, not a card: it already sits inside the group's own panel,
            // and a bordered card in a bordered card read as a second page.
            className="mt-4 gap-y-3"
          >
            <Field label={t("divers.certifications.agency")}>
              <select name="agency" className={controlClass}>
                {Object.entries(AGENCY_KEYS).map(([value, key]) => (
                  <option key={value} value={value}>
                    {t(key)}
                  </option>
                ))}
              </select>
            </Field>
            {/* One question, not two: a staffer holding a card reads what it
                  is, and the ladder and the specialties are the same list to
                  them. The `<optgroup>`s are what keeps a rung from reading as
                  a specialty. */}
            <Field label={t("divers.certifications.cardLabel")}>
              <select name="card" className={controlClass} defaultValue="level:open_water">
                <optgroup label={t("divers.certifications.cardKindLevel")}>
                  {Object.entries(CERTIFICATION_LEVEL_KEYS).map(([value, key]) => (
                    <option key={value} value={`level:${value}`}>
                      {t(key)}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t("divers.certifications.cardKindSpecialty")}>
                  {Object.entries(SPECIALTY_KEYS).map(([value, key]) => (
                    <option key={value} value={`specialty:${value}`}>
                      {t(key)}
                    </option>
                  ))}
                  <option value="nitrox">{t("divers.specialty.nitroxOption")}</option>
                </optgroup>
              </select>
            </Field>
            <Field label={t("divers.certifications.cardNumber")}>
              <input name="identifier" required className={controlClass} />
            </Field>
            <FieldActions>
              {canAssist ? (
                <AssistPhotoButton
                  read={readCardPhotoAction.bind(null, shopSlug)}
                  label={t("deskAssists.cardPhoto")}
                  pendingLabel={t("deskAssists.cardPhotoPending")}
                  emptyLabel={t("deskAssists.nothing")}
                />
              ) : null}
              <SubmitButton
                pendingLabel={t("divers.certifications.capturing")}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("divers.certifications.captureForReview")}
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        </AutoOpenDetails>
        <DiverFormStatus status={groupStatus} className="mt-3" />
      </li>
    </>
  );
}
