import { withdrawCrewAwayAcknowledgementAction } from "@/app/shop/[shopSlug]/trips/[id]/crew-actions";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * **Who a staffer said is working it anyway** (issue #2678), under the crew
 * panel, each with **"No longer working it"** (dock review S2): the way back
 * when the plan changes, so Today's row and the diver-side mark return.
 * Nothing renders when nobody was acknowledged. A Server Component, so it
 * words its own lines.
 */
export function CrewAwayWorkingList({
  shopSlug,
  tripId,
  people,
  t,
}: {
  shopSlug: string;
  tripId: string;
  /** Each live acknowledgement (`listCrewAwayAcknowledgements`). */
  people: readonly { personId: string; fullName: string; acknowledgedByName: string | null }[];
  t: StaffTranslator;
}) {
  if (people.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-col gap-2 text-sm">
      {people.map((person) => (
        <li key={person.personId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            {person.acknowledgedByName
              ? t("trips.crew.awayWorking", {
                  name: person.fullName,
                  by: person.acknowledgedByName,
                })
              : t("trips.crew.awayWorkingNoActor", { name: person.fullName })}
          </span>
          <form
            action={withdrawCrewAwayAcknowledgementAction.bind(
              null,
              shopSlug,
              tripId,
              person.personId,
            )}
          >
            <SubmitButton
              pendingLabel={t("trips.crew.awayWithdrawing")}
              className={buttonClass({ variant: "secondary", size: "sm" })}
              observabilityAction="crew-away-withdraw"
            >
              {t("trips.crew.awayWithdraw")}
            </SubmitButton>
          </form>
        </li>
      ))}
    </ul>
  );
}
