import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { TripUnitToCheckIn } from "@/db/gear";
import { gearItemKindLabel } from "@/i18n/gear-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { scopedId } from "@/lib/element-id";
import { pullStartsTicked } from "@/lib/gear";
import { returnTripGearUnitAction } from "../actions";
import { GearReturnPane } from "./GearReturnPane";

/** Close returns per unit; reported concerns are recorded against that unit for service. Omitted from paper. */
export function PrepBackFromBoat({
  units,
  tripId,
  t,
  idPrefix,
}: {
  units: readonly TripUnitToCheckIn[];
  tripId: string;
  t: StaffTranslator;
  idPrefix: string | undefined;
}) {
  if (units.length === 0) return null;
  const headingId = scopedId(idPrefix, "back-from-boat-heading");
  return (
    <section aria-labelledby={headingId} className="print:hidden">
      <h2 id={headingId} className={SECTION_TITLE_CLASS}>
        {t("gear.prep.backHeading")}
      </h2>
      <p className="mt-1 text-sm text-muted">{t("gear.prep.backCount", { count: units.length })}</p>
      <ul className="mt-3 divide-y divide-border border-y border-border">
        {units.map((unit) => (
          <li key={unit.reservationId} className="py-3">
            <p className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-mono font-medium">{unit.label}</span>
              <span className="text-sm text-muted">
                {unit.size
                  ? t("gear.prep.kindWithSize", {
                      kindLabel: gearItemKindLabel(t, unit.kind),
                      size: unit.size,
                    })
                  : gearItemKindLabel(t, unit.kind)}
              </span>
              <span className="text-sm">{unit.personName}</span>
            </p>
            <GearReturnPane
              fields={{ tripId, reservationId: unit.reservationId }}
              action={returnTripGearUnitAction}
              labels={{
                allGood: t("gear.prep.backUnit"),
                serviceConcern: t("gear.prep.backProblem"),
                cancelConcern: t("gear.prep.returnCancelConcern"),
                noteLabel: t("gear.prep.backNoteLabel"),
                notePlaceholder: t("gear.prep.backNotePlaceholder"),
              }}
              bench={{
                legend: t("gear.prep.returnPullToBench"),
                units: [
                  {
                    id: unit.gearItemId,
                    label: unit.label,
                    defaultChecked: pullStartsTicked(unit.kind),
                  },
                ],
              }}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
