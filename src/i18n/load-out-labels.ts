import type { DayLoadOut } from "@/lib/closeout";
import type { StaffTranslator } from "./staff-messages";

/**
 * **A day's load-out in one line** (fifth-loop ideas, item 2): "42 tanks to
 * fill (36 air, 6 nitrox) · 29 rental pieces to pick · 3 departures". The
 * evening close and the printed day say the same words. The nitrox split only
 * when there is nitrox to fill, and the pieces only when there are any.
 */
export function dayLoadOutLine(t: StaffTranslator, loadOut: DayLoadOut): string {
  const { tanks, rentalPieces, departures } = loadOut;
  return [
    tanks.nitrox > 0
      ? t("closeout.loadOut.tanks", { total: tanks.total, air: tanks.air, nitrox: tanks.nitrox })
      : t("closeout.loadOut.tanksAir", { total: tanks.total }),
    rentalPieces > 0 ? t("closeout.loadOut.pieces", { count: rentalPieces }) : null,
    t("closeout.loadOut.departures", { count: departures }),
  ]
    .filter((part) => part !== null)
    .join(" · ");
}
