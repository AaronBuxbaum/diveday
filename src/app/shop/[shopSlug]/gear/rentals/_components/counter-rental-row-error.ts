import type { PickerUnit } from "./CounterRentalCart";
export function counterRentalRowError(
  unit: PickerUnit,
  refusal: { code: string; unitId: string | null; message: string } | null,
  fill: string,
): string | undefined {
  if (!refusal) return undefined;
  if (refusal.unitId === unit.id) return refusal.message;
  if (!unit.fillAria) return undefined;
  if ((refusal.code === "fill-missing" || refusal.code === "fill-invalid") && !fill) {
    return refusal.message;
  }
  if (refusal.code === "no-nitrox-card" && Number(fill) > 21) return refusal.message;
  return undefined;
}
