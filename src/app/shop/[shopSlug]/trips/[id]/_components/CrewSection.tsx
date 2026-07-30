import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { staffTranslator } from "@/i18n/staff-messages";
import type { StaffList, Trip } from "./types";

export function CrewSection({
  action,
  trip,
  staff,
  crewIds,
  hasCourseInstructor,
  locale,
}: {
  action: (formData: FormData) => void;
  trip: Trip;
  staff: StaffList;
  crewIds: string[];
  hasCourseInstructor: boolean;
  locale: string;
}) {
  const t = staffTranslator(locale);
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">{t("trips.crew.heading")}</h2>
      <p className="mt-1 text-sm text-muted">{t("trips.crew.description")}</p>
      {trip.course && !hasCourseInstructor ? (
        <p className="mt-3 rounded-lg bg-warning/10 px-4 py-3 text-sm font-medium text-warning">
          {t("trips.crew.courseNeedsInstructor")}
        </p>
      ) : null}
      {staff.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{t("trips.crew.noCrew")}</p>
      ) : (
        <form action={action} className="mt-4 flex flex-col gap-3">
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {staff.map(({ person, roles }) => (
              <li key={person.id}>
                <label className="flex min-h-11 items-center gap-3 px-4 py-3 text-sm">
                  <input
                    type="checkbox"
                    name="crew"
                    value={person.id}
                    defaultChecked={crewIds.includes(person.id)}
                    className="size-4 accent-primary"
                  />
                  <span className="font-medium">{person.fullName}</span>
                  <span className="text-muted">{roles.join(", ")}</span>
                </label>
              </li>
            ))}
          </ul>
          <div>
            <SubmitButton
              pendingLabel={t("trips.crew.saving")}
              className={buttonClass({ variant: "secondary", className: "text-foreground" })}
            >
              {t("trips.crew.save")}
            </SubmitButton>
          </div>
        </form>
      )}
    </section>
  );
}
