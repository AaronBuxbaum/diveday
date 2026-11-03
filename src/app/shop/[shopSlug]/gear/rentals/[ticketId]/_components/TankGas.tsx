import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";
import type { CounterRentalUnit } from "@/db/gear-counter-rentals";
import { tankFillLabel, tankFillOptions } from "@/i18n/gear-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { correctCounterTankFillAction } from "../../actions";

/** The tanks the ticket says a gas for. */
function filledTanks(units: readonly CounterRentalUnit[]): CounterRentalUnit[] {
  return units.filter((unit) => unit.kind === "tank" && unit.fillO2Percent !== null);
}

/**
 * **What the ticket says about its tanks' gas** (domain reviews A3/F6, security
 * review X5), on the slip: each tank's gas, whether EANx went in without a
 * current O2-clean record (issue #3005; printed on purpose: the paper ticket is
 * what goes with the tank to whoever fills it next), who recorded it, then the
 * line that it was recorded at the counter and not analyzed. Nothing when the
 * rental holds no tank. The correction is the screen's (`TankGasCorrections`).
 */
export function TankGas({ t, units }: { t: StaffTranslator; units: readonly CounterRentalUnit[] }) {
  const tanks = filledTanks(units);
  if (tanks.length === 0) return null;
  return (
    <section className="mt-4 flex flex-col gap-3" data-tank-gas>
      <ul className="flex flex-col gap-2 text-sm">
        {tanks.map((tank) => (
          <li key={tank.reservationId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono font-medium">{tank.label}</span>
            <span>{tankFillLabel(t, tank.fillO2Percent ?? 21)}</span>
            {tank.fillO2CleanGap ? (
              <span className="font-medium text-warning-strong" data-o2-clean-gap>
                {t(
                  tank.fillO2CleanGap === "lapsed"
                    ? "counterRentals.ticket.fillO2CleanLapsed"
                    : "counterRentals.ticket.fillO2CleanNever",
                )}
              </span>
            ) : null}
            {tank.fillRecordedByName ? (
              <span className="text-muted">
                {t("counterRentals.ticket.fillRecordedBy", { name: tank.fillRecordedByName })}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="text-sm font-medium text-warning-strong">
        {t("counterRentals.ticket.fillNotAnalyzed")}
      </p>
    </section>
  );
}

/**
 * **A correction per tank still held or out**, on the counter's screen above
 * the slip, through the same card gate as renting it. Nothing once every tank
 * is home, or with no tank.
 */
export function TankGasCorrections({
  t,
  ticketId,
  units,
}: {
  t: StaffTranslator;
  ticketId: string;
  units: readonly CounterRentalUnit[];
}) {
  const tanks = filledTanks(units).filter((tank) => !tank.returnedAt);
  if (tanks.length === 0) return null;
  const options = tankFillOptions(t, t("counterRentals.new.fillChoose"));
  return (
    <ul className="flex flex-col gap-2 text-sm" data-tank-gas-corrections>
      {tanks.map((tank) => (
        <li key={tank.reservationId}>
          <form action={correctCounterTankFillAction} className="flex items-center gap-3">
            <input type="hidden" name="ticketId" value={ticketId} />
            <input type="hidden" name="reservationId" value={tank.reservationId} />
            <span className="font-mono font-medium">{tank.label}</span>
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
        </li>
      ))}
    </ul>
  );
}
