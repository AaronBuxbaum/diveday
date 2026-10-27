import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/form";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { getDb } from "@/db/client";
import { trainingPlanView } from "@/db/training-plan-view";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { saveTrainingPlanAction } from "../training-plan-actions";

export async function TrainingPlan({
  shopId,
  shopSlug,
  tripId,
  canEdit,
  t,
}: {
  shopId: string;
  shopSlug: string;
  tripId: string;
  canEdit: boolean;
  t: StaffTranslator;
}) {
  const db = await getDb();
  const plan = await trainingPlanView(db, shopId, tripId);
  if (!plan) return null;
  const action = saveTrainingPlanAction.bind(null, shopSlug, tripId);
  const row = (
    kind: "assistant" | "student",
    subject: { id: string; name: string; instructorPersonId: string | null },
    eligible: string[],
  ) => {
    const choices = plan.instructors.filter((instructor) => eligible.includes(instructor.id));
    const selected = choices.some((choice) => choice.id === subject.instructorPersonId)
      ? (subject.instructorPersonId ?? "")
      : "";
    const id = `training-plan-${kind}-${subject.id}`;
    return (
      <form action={action} key={id} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="id" value={subject.id} />
        <Field label={t("trips.trainingPlan.instructor", { name: subject.name })} htmlFor={id}>
          <select
            id={id}
            name="instructor"
            className={controlClass}
            defaultValue={selected}
            disabled={!canEdit}
          >
            <option value="">{t("trips.trainingPlan.unassigned")}</option>
            {choices.map((choice) => (
              <option value={choice.id} key={choice.id}>
                {choice.name}
              </option>
            ))}
          </select>
        </Field>
        {canEdit ? (
          <SubmitButton
            className={buttonClass({ variant: "secondary" })}
            pendingLabel={t("trips.trainingPlan.saving")}
          >
            {t("trips.trainingPlan.save")}
          </SubmitButton>
        ) : null}
      </form>
    );
  };
  const allTeachers = plan.instructors.map((i) => i.id);
  return (
    <section id="training-plan" className="space-y-4">
      <h2 className={SECTION_TITLE_CLASS}>{t("trips.trainingPlan.title")}</h2>
      <p className="text-sm text-muted">{t("trips.trainingPlan.scope")}</p>
      {plan.allocation.unresolvedStudents.size > 0 ||
      plan.allocation.unresolvedAssistants.size > 0 ? (
        <p className="text-sm text-warning-strong">{t("trips.trainingPlan.unresolved")}</p>
      ) : null}
      {Array.from(plan.allocation.groups, ([id, group]) =>
        group.overRatio ? (
          <p key={id} className="text-sm text-warning-strong">
            {t("trips.trainingPlan.over", {
              name: plan.instructors.find((i) => i.id === id)?.name ?? "",
              students: group.students,
              capacity: group.capacity,
            })}
          </p>
        ) : null,
      )}
      {plan.assistants.length ? (
        <div className="space-y-3">
          <h3 className="font-semibold">{t("trips.trainingPlan.assistants")}</h3>
          {plan.assistants.map((assistant) => row("assistant", assistant, allTeachers))}
        </div>
      ) : null}
      <div className="space-y-3">
        <h3 className="font-semibold">{t("trips.trainingPlan.students")}</h3>
        {plan.students.map((student) => row("student", student, student.eligible))}
      </div>
    </section>
  );
}
