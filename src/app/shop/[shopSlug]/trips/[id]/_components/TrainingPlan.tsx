import { getDb } from "@/db/client";
import { trainingPlanView } from "@/db/training-plan-view";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { saveTrainingPlanAction } from "../training-plan-actions";
import { TrainingPlanContent } from "./TrainingPlanContent";

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
  return (
    <TrainingPlanContent
      plan={plan}
      action={saveTrainingPlanAction.bind(null, shopSlug, tripId)}
      canEdit={canEdit}
      t={t}
    />
  );
}
