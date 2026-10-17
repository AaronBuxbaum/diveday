import { GroupLabel } from "@/components/ui/group-label";
import { LedgerRow } from "@/components/ui/ledger";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { type DayKind, moneyByBoat, moneyByKind } from "@/lib/departure-money";
import { joinFacts } from "@/lib/format";
import type { ReportTrip } from "@/lib/reporting";

/**
 * **Which boats and which trips made the month's money** (fifth loop, item
 * 26): one ledger row per hull ("Mantis I · 14 days out · 71% full · $4,920")
 * and one line by kind of trip, above the departures that make them up.
 *
 * What a departure *took*, never what it made: wages stay out, as the ledger
 * below already decides. A month whose departures named no hull and no kind
 * renders nothing here, since a single line would restate the figure above.
 */
export function DepartureMoney({
  trips,
  timeZone,
  t,
  money,
}: {
  trips: readonly ReportTrip[];
  timeZone: string;
  t: StaffTranslator;
  money: (cents: number) => string;
}) {
  const boats = moneyByBoat(trips, timeZone);
  const kinds = moneyByKind(trips);
  if (boats.length === 0 && kinds.length === 0) return null;
  const kindName = (kind: DayKind) =>
    kind.kind === "lens"
      ? kind.name
      : kind.kind === "course"
        ? t("reports.byKind.course")
        : t("reports.byKind.other");
  return (
    <div className="mt-10 space-y-6">
      {boats.length > 0 ? (
        <section aria-labelledby="reports-by-boat">
          <GroupLabel as="h2" id="reports-by-boat">
            {t("reports.byBoat.heading")}
          </GroupLabel>
          <ul className="mt-2">
            {boats.map((boat) => (
              <LedgerRow
                key={boat.name}
                trailing={<span className="font-medium tabular-nums">{money(boat.netCents)}</span>}
              >
                <span className="font-medium">{boat.name}</span>
                <span className="text-sm text-muted tabular-nums">
                  {" · "}
                  {t("reports.byBoat.facts", {
                    days: boat.days,
                    percent: boat.seats > 0 ? Math.round((boat.booked / boat.seats) * 100) : 0,
                  })}
                </span>
              </LedgerRow>
            ))}
          </ul>
        </section>
      ) : null}
      {kinds.length > 0 ? (
        <section aria-labelledby="reports-by-kind">
          <GroupLabel as="h2" id="reports-by-kind">
            {t("reports.byKind.heading")}
          </GroupLabel>
          <p className="mt-2 text-sm tabular-nums">
            {joinFacts(kinds.map((line) => `${kindName(line.kind)} ${money(line.netCents)}`))}
          </p>
        </section>
      ) : null}
    </div>
  );
}
