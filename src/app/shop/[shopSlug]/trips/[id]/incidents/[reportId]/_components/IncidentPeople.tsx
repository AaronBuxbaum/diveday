import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { ChoiceFieldset, ChoiceRow, controlClass, Field, FormStatus } from "@/components/ui/form";
import type { IncidentPersonLine } from "@/db/incident-reports";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { INCIDENT_INVOLVEMENTS, INCIDENT_SHORT_TEXT_MAX } from "@/lib/incident-reports";
import type { FormNotice } from "@/lib/staff-notices";
import { INVOLVEMENT_KEYS, PERSON_KIND_KEYS } from "./incident-words";

type Editing = {
  seats: readonly { bookingId: string; name: string }[];
  crew: readonly { personId: string; name: string }[];
  shopStaff: readonly { personId: string; name: string }[];
  addAction: (formData: FormData) => Promise<void>;
  removeAction: (rowId: string) => (formData: FormData) => Promise<void>;
};

/**
 * Who was involved. On a draft its writer can add and remove names; on a filed
 * report the list is part of the record and only reads.
 */
export function IncidentPeople({
  people,
  editing,
  notice,
  t,
}: {
  people: readonly IncidentPersonLine[];
  editing: Editing | null;
  notice: FormNotice | undefined;
  t: StaffTranslator;
}) {
  return (
    <SectionCard
      id="people"
      className="scroll-mt-24"
      title={t("incidents.people.title")}
      description={editing ? t("incidents.people.description") : undefined}
    >
      {people.length === 0 ? (
        <p className="text-muted">{t("incidents.people.empty")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {people.map((person) => (
            <li
              key={person.id}
              className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-2"
            >
              <span className="font-medium">{person.name}</span>
              <span className="text-sm text-muted">
                {t(INVOLVEMENT_KEYS[person.involvement])}
                {" "}· {t(PERSON_KIND_KEYS[person.kind])}
              </span>
              {editing ? (
                <form action={editing.removeAction(person.id)} className="ms-auto">
                  <SubmitButton
                    pendingLabel={t("incidents.people.removing")}
                    ariaLabel={t("incidents.people.removeLabel", { name: person.name })}
                    className={buttonClass({ variant: "ghost", size: "sm" })}
                  >
                    {t("incidents.people.remove")}
                  </SubmitButton>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <form action={editing.addAction} className="mt-6 space-y-4 border-t border-border pt-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("incidents.people.who")}>
              <select name="who" required defaultValue="" className={controlClass}>
                <option value="" disabled>
                  {t("incidents.people.choose")}
                </option>
                {editing.seats.length > 0 ? (
                  <optgroup label={t("incidents.people.seats")}>
                    {editing.seats.map((seat) => (
                      <option key={seat.bookingId} value={`booking:${seat.bookingId}`}>
                        {seat.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {editing.crew.length > 0 ? (
                  <optgroup label={t("incidents.people.crew")}>
                    {editing.crew.map((member) => (
                      <option key={member.personId} value={`staff:${member.personId}`}>
                        {member.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {editing.shopStaff.length > 0 ? (
                  <optgroup label={t("incidents.people.shopStaff")}>
                    {editing.shopStaff.map((member) => (
                      <option key={member.personId} value={`staff:${member.personId}`}>
                        {member.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                <option value="outsider">{t("incidents.people.someoneElse")}</option>
              </select>
            </Field>
            <Field
              label={t("incidents.people.outsiderName")}
              hint={t("incidents.form.optional")}
              description={t("incidents.people.outsiderNameHint")}
            >
              <input
                name="outsiderName"
                maxLength={INCIDENT_SHORT_TEXT_MAX}
                className={controlClass}
              />
            </Field>
          </div>
          <ChoiceFieldset
            legend={t("incidents.people.part")}
            required
            bodyClassName="flex flex-wrap gap-x-6"
          >
            {INCIDENT_INVOLVEMENTS.map((involvement, index) => (
              <ChoiceRow
                key={involvement}
                type="radio"
                name="involvement"
                value={involvement}
                required
                defaultChecked={index === 0}
              >
                {t(INVOLVEMENT_KEYS[involvement])}
              </ChoiceRow>
            ))}
          </ChoiceFieldset>
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton
              pendingLabel={t("incidents.people.adding")}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("incidents.people.add")}
            </SubmitButton>
            <FormStatus tone={notice?.tone}>{notice?.text}</FormStatus>
          </div>
        </form>
      ) : null}
    </SectionCard>
  );
}
