import { controlClass, Field } from "@/components/ui/form";
import { listBoats } from "@/db/boats";
import type { AppDb } from "@/db/client";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { isSafetyKitKind } from "@/lib/boat-safety";
import type { GearItemKind } from "@/lib/gear";

/**
 * **Safety kit lives aboard a boat** (roadmap N-08): which hull a unit hangs
 * on, and which hulls it could. Only the safety-kit kinds of a shop that runs
 * boats are offered one; everything else reads `offered: false` and the page
 * draws neither the identity word nor the field.
 */
export type GearUnitHull = {
  offered: boolean;
  fleet: readonly { id: string; name: string }[];
  aboard: { id: string; name: string } | null;
};

export async function gearUnitHull(
  db: AppDb,
  shop: { id: string; hasBoatDiving: boolean },
  item: { kind: GearItemKind; aboardBoatId: string | null },
): Promise<GearUnitHull> {
  const fleet = shop.hasBoatDiving ? await listBoats(db, shop.id) : [];
  return {
    offered: isSafetyKitKind(item.kind) && fleet.length > 0,
    fleet,
    aboard: fleet.find((boat) => boat.id === item.aboardBoatId) ?? null,
  };
}

/** "Aboard Mantis I" for the masthead's identity line, or nothing. */
export function aboardText(hull: GearUnitHull, t: StaffTranslator): string | null {
  return hull.aboard ? t("gear.unit.aboard", { boatName: hull.aboard.name }) : null;
}

/** The details form's Aboard / Ashore choice. */
export function AboardBoatField({ hull, t }: { hull: GearUnitHull; t: StaffTranslator }) {
  if (!hull.offered) return null;
  return (
    <Field label={t("gear.form.aboard")}>
      <select name="aboardBoatId" className={controlClass} defaultValue={hull.aboard?.id ?? ""}>
        <option value="">{t("gear.form.ashore")}</option>
        {hull.fleet.map((boat) => (
          <option key={boat.id} value={boat.id}>
            {boat.name}
          </option>
        ))}
      </select>
    </Field>
  );
}
