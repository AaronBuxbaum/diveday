import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { TripUnitToCheckIn } from "@/db/gear";
import { gearItemKindLabel } from "@/i18n/gear-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { scopedId } from "@/lib/element-id";
import { returnTripGearUnitAction } from "../actions";
import { GearReturnPane } from "./GearReturnPane";

/**
 * **Back from the boat** (fifth-loop ideas, item 5): once the boat is home,
 * the Gear tab leads with every unit that went out on it and is still out,
 * one row per unit, so kit comes back by boat rather than waiting for the
 * register's due-back date.
 *
 * Two answers per unit: **Back**, and **Back with a problem**, which asks
 * what is wrong before it saves and closes the unit as a service concern, the
 * flag a technician answers on the unit's page. One unit at a time because the
 * problem is one unit's ("inflator sticks"); the per-diver set pane it replaces
 * after Home asked once for an armful. Nothing here pulls a unit to the bench.
 *
 * Not on paper: it is a list to work, not a record.
 */
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
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
