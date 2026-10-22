import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";
import type { CounterRentalUnit } from "@/db/gear-counter-rentals";
import { tankFillLabel, tankFillOptions } from "@/i18n/gear-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { correctCounterTankFillAction } from "../../actions";

/**
 * **What the ticket says about its tanks' gas** (domain reviews A3/F6, security
 * review X5). Printed: each tank's gas with who recorded it, then the line that
 * it was recorded at the counter and not analyzed. On screen only: a
 * correction per tank still held or out, through the same card gate as renting
 * it. Nothing when the rental holds no tank.
 */
export function TankGas({
  t,
  ticketId,
  units,
}: {
  t: StaffTranslator;
  ticketId: string;
  units: readonly CounterRentalUnit[];
}) {
  const tanks = units.filter((unit) => unit.kind === "tank" && unit.fillO2Percent !== null);
  if (tanks.length === 0) return null;
  const options = tankFillOptions(t, t("counterRentals.new.fillChoose"));
  return (
    <section className="mt-4 flex flex-col gap-3" data-tank-gas>
      <ul className="flex flex-col gap-2 text-sm">
        {tanks.map((tank) => (
          <li key={tank.reservationId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono font-medium">{tank.label}</span>
            <span>{tankFillLabel(t, tank.fillO2Percent ?? 21)}</span>
            {tank.fillRecordedByName ? (
              <span className="text-muted">
                {t("counterRentals.ticket.fillRecordedBy", { name: tank.fillRecordedByName })}
              </span>
            ) : null}
            {tank.returnedAt ? null : (
              <form
                action={correctCounterTankFillAction}
                className="flex items-center gap-2 print:hidden"
              >
                <input type="hidden" name="ticketId" value={ticketId} />
                <input type="hidden" name="reservationId" value={tank.reservationId} />
                <select
                  name="fill"
                  required
                  defaultValue={String(tank.fillO2Percent)}
                  aria-label={t("counterRentals.ticket.fillCorrectAria", { label: tank.label })}
                  className={`${controlClass.replace("w-full", "")} w-40`}
                >
                  {options.map((option) => (
                    <option key={option.value} value={option.value} disabled={option.value === ""}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <SubmitButton
                  pendingLabel={t("counterRentals.ticket.fillCorrecting")}
                  className={buttonClass({ variant: "secondary" })}
                >
                  {t("counterRentals.ticket.fillCorrect")}
                </SubmitButton>
              </form>
            )}
          </li>
        ))}
      </ul>
      <p className="text-sm font-medium text-warning-strong">
        {t("counterRentals.ticket.fillNotAnalyzed")}
      </p>
    </section>
  );
}
