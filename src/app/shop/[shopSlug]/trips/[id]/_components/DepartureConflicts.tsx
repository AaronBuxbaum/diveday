import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass, proseLinkClass } from "@/components/ui/button";
import { TONE_PANEL_CLASS } from "@/components/ui/card";
import type { OpenBoardingObservation } from "@/db/boarding-observations";
import type { PersonClash } from "@/db/person-clashes";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { shopPath } from "@/lib/staff-notices";
import {
  dismissDockObservationAction,
  retryDockObservationsAction,
} from "./departure-conflict-actions";

/**
 * **What this departure is standing in that a person has to sort out** (issue
 * #4474): a diver the desk saw at the dock whose seat has not come back, and a
 * person here who is also on an overlapping departure with a seat on either
 * side. Both are read from committed rows on every render, so a move or a
 * schedule change can never leave this saying "all clear" when it is not.
 *
 * Information, never a gate: the overlap is a warning, as the boat-resource
 * ADR keeps every overlap, and the dock observation already holds its seat.
 * Renders nothing when there is nothing.
 */
export function DepartureConflicts({
  shopSlug,
  tripId,
  dock,
  clashes,
  t,
}: {
  shopSlug: string;
  tripId: string;
  dock: readonly OpenBoardingObservation[];
  clashes: readonly PersonClash[];
  t: StaffTranslator;
}) {
  if (dock.length === 0 && clashes.length === 0) return null;
  const retry = retryDockObservationsAction.bind(null, shopSlug, tripId);
  return (
    <div className="space-y-4">
      {dock.length > 0 ? (
        <section
          id="dock"
          className={`${TONE_PANEL_CLASS} scroll-mt-24 border-warning/40 bg-warning/10`}
          aria-labelledby="dock-heading"
        >
          <h2 id="dock-heading" className="font-semibold">
            {t("trips.conflicts.dockHeading")}
          </h2>
          <ul className="mt-3 space-y-3">
            {dock.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="basis-full sm:basis-auto">
                  <span className="font-medium">{row.personName}</span>
                  {". "}
                  {row.state === "conflict" && row.conflict
                    ? t(`trips.conflicts.conflict.${row.conflict}`)
                    : t("trips.conflicts.pending")}
                </span>
                <form action={retry}>
                  <SubmitButton
                    pendingLabel={t("words.busy.saving")}
                    className={buttonClass({ variant: "secondary", size: "sm" })}
                    ariaLabel={t("trips.conflicts.retryFor", { name: row.personName })}
                  >
                    {t("trips.conflicts.retry")}
                  </SubmitButton>
                </form>
                <form action={dismissDockObservationAction.bind(null, shopSlug, tripId, row.id)}>
                  <SubmitButton
                    pendingLabel={t("words.busy.saving")}
                    className={buttonClass({ variant: "ghost", size: "sm" })}
                    ariaLabel={t("trips.conflicts.dismissFor", { name: row.personName })}
                  >
                    {t("trips.conflicts.dismiss")}
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {clashes.length > 0 ? (
        <section
          id="clashes"
          className={`${TONE_PANEL_CLASS} scroll-mt-24 border-warning/40 bg-warning/10`}
          aria-labelledby="clashes-heading"
        >
          <h2 id="clashes-heading" className="font-semibold">
            {t("trips.conflicts.clashHeading")}
          </h2>
          <ul className="mt-3 space-y-2">
            {clashes.map((clash) => (
              <li key={`${clash.personId}:${clash.here}:${clash.otherTripId}:${clash.there}`}>
                {t("trips.conflicts.clash", { name: clash.fullName, there: clash.there })}{" "}
                <Link
                  className={proseLinkClass}
                  href={shopPath(shopSlug, "trips", clash.otherTripId)}
                >
                  {clash.otherTitle}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
