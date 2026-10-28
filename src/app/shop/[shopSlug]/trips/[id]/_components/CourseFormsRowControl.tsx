import { waiverSendCopy } from "@/app/actions/waiver-send-types";
import { WaiverSendControl } from "@/app/shop/[shopSlug]/_components/today/WaiverSendControl";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { ChoiceRow, controlClass, DateField, Field, FieldGrid } from "@/components/ui/form";
import { guardianRelationshipText } from "@/i18n/guardian-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { isYouthForm, type RequiredCourseForm } from "@/lib/course-forms";
import { GUARDIAN_RELATIONSHIPS } from "@/lib/guardian";
import { CourseFormsQrButton } from "./CourseFormsQr";

/**
 * **The course forms a seat still owes, on its row** (ADR
 * 20261008-course-forms).
 *
 * While forms block boarding, the row's own blocker lines already name each
 * one; when they only warn (`COURSE_FORMS_BLOCK_BOARDING` off), this says
 * which in one line, so a shop sees what is owed either way. Then the two
 * ways to clear them: send the student their forms link (the release's own
 * send, which covers the forms once the release is signed — so only drawn
 * then), or record a form they signed on paper.
 */
export function CourseFormsRowControl({
  tripId,
  bookingId,
  personName,
  owed,
  warnOnly,
  offerSend,
  requiresGuardian,
  recordAction,
  t,
}: {
  tripId: string;
  bookingId: string;
  personName: string;
  owed: readonly RequiredCourseForm[];
  /**
   * Forms do not block: say what is owed, since no blocker line will. A form
   * marked medical screening still blocks, so its own blocker line speaks and
   * it is left out of this one (#2337).
   */
  warnOnly: boolean;
  /** The release is signed, so the row's waiver send is not drawn and this one is. */
  offerSend: boolean;
  requiresGuardian: boolean;
  recordAction: ((formData: FormData) => void) | undefined;
  t: StaffTranslator;
}) {
  if (owed.length === 0) return null;
  // A youth form is co-signed whatever the record holds (H6); a guardian
  // typed beside another form is ignored by the writer.
  const guardianAsked = requiresGuardian || owed.some(isYouthForm);
  const warned = warnOnly ? owed.filter((form) => !form.medicalScreening) : [];
  return (
    <div className="mt-3 flex flex-col gap-2" data-course-forms-owed={bookingId}>
      {warned.length > 0 ? (
        <p className="text-sm text-warning-strong">
          {t("trips.roster.courseForms.owed", {
            count: warned.length,
            forms: warned.map((form) => form.title).join(", "),
          })}
        </p>
      ) : null}
      <div className="print:hidden">
        <CourseFormsQrButton bookingId={bookingId} name={personName} />
      </div>
      {offerSend ? (
        <WaiverSendControl
          surface="roster"
          tripId={tripId}
          bookingIds={[bookingId]}
          label={t("trips.roster.courseForms.send")}
          pendingLabel={t("trips.roster.sending")}
          className={buttonClass({ variant: "secondary", size: "sm" })}
          wrapperClassName=""
          copy={waiverSendCopy(t)}
        />
      ) : null}
      {recordAction ? (
        <details className="group/paper-form">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-sm font-medium text-muted hover:text-foreground [&::-webkit-details-marker]:hidden">
            {t("trips.roster.courseForms.recordPaper")}
          </summary>
          <form action={recordAction} className="mt-2 flex flex-col gap-3">
            <input type="hidden" name="bookingId" value={bookingId} />
            <FieldGrid columns={1}>
              <Field
                label={t("trips.roster.courseForms.formLabel")}
                htmlFor={`paper-form-${bookingId}`}
              >
                <select
                  id={`paper-form-${bookingId}`}
                  name="formId"
                  required
                  className={controlClass}
                >
                  {owed.map((form) => (
                    <option key={form.formId} value={form.formId}>
                      {form.title}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={t("trips.roster.courseForms.signedOn")}
                description={t("trips.roster.courseForms.signedOnHint")}
                htmlFor={`paper-form-signed-on-${bookingId}`}
              >
                <DateField id={`paper-form-signed-on-${bookingId}`} name="signedOn" />
              </Field>
              {guardianAsked ? (
                <>
                  <Field
                    label={t("trips.roster.courseForms.guardianName")}
                    htmlFor={`paper-form-guardian-${bookingId}`}
                  >
                    <input
                      id={`paper-form-guardian-${bookingId}`}
                      name="guardianName"
                      required
                      minLength={2}
                      maxLength={120}
                      autoComplete="off"
                      className={controlClass}
                    />
                  </Field>
                  <Field
                    label={t("trips.roster.courseForms.guardianRelationship")}
                    htmlFor={`paper-form-relationship-${bookingId}`}
                  >
                    <select
                      id={`paper-form-relationship-${bookingId}`}
                      name="guardianRelationship"
                      required
                      defaultValue=""
                      className={controlClass}
                    >
                      <option value="" disabled>
                        {t("trips.roster.courseForms.guardianChoose")}
                      </option>
                      {GUARDIAN_RELATIONSHIPS.map((relationship) => (
                        <option key={relationship} value={relationship}>
                          {guardianRelationshipText(t, relationship)}
                        </option>
                      ))}
                    </select>
                  </Field>
                </>
              ) : null}
            </FieldGrid>
            {guardianAsked ? (
              <ChoiceRow type="checkbox" name="guardianNamesake" value="on" className="text-sm">
                {t("trips.roster.courseForms.guardianNamesake")}
              </ChoiceRow>
            ) : null}
            <ChoiceRow type="checkbox" name="paperCopy" value="on" required className="text-sm">
              {t("trips.roster.courseForms.paperCopy")}
            </ChoiceRow>
            <div>
              <SubmitButton
                pendingLabel={t("trips.roster.courseForms.recording")}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {t("trips.roster.courseForms.record")}
              </SubmitButton>
            </div>
          </form>
        </details>
      ) : null}
    </div>
  );
}
