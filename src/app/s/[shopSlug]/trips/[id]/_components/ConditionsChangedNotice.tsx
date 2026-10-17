import { TONE_PANEL_LG_CLASS } from "@/components/ui/card";
import { diverTranslator } from "@/i18n/messages";

/**
 * What a booked diver is told when the shop has changed the conditions since
 * they were last briefed. Only a booked diver sees it, and a booking renders
 * the booked moment on the `lg` rung below, so this panel is its `lg` twin.
 */
export function ConditionsChangedNotice({ locale }: { locale: string }) {
  const t = diverTranslator(locale);
  return (
    <section className={`${TONE_PANEL_LG_CLASS} border-warning/40 bg-warning/10`} role="status">
      <h2 className="font-semibold">{t("trip.conditionsChangedHeading")}</h2>
      <p className="mt-1 text-sm text-muted">{t("trip.conditionsChangedBody")}</p>
    </section>
  );
}
