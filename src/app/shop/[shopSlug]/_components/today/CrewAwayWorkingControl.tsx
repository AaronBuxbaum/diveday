import { acknowledgeCrewAwayAction } from "@/app/shop/[shopSlug]/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";

/**
 * **"Working it anyway"** on Today's `crew_away` row (issue #2678, decided by
 * Aaron 2026-10-17): the desk asked Marcus, and he is teaching Sunday all the
 * same. One tap per person the row names; it posts in place, the shape
 * `RentalFitKeepControl` set. The action re-proves that the person is on this
 * departure's crew, so the two ids are a request and never an authority.
 *
 * Every word arrives as a prop: staff copy is resolved server-side.
 */
export function CrewAwayWorkingControl({
  tripId,
  people,
  pendingLabel,
}: {
  tripId: string;
  /** Each person the row names, with the button's own words for them. */
  people: readonly { personId: string; label: string }[];
  pendingLabel: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {people.map((person) => (
        <form
          key={person.personId}
          action={acknowledgeCrewAwayAction.bind(null, tripId, person.personId)}
        >
          <SubmitButton
            pendingLabel={pendingLabel}
            className={buttonClass({ variant: "secondary", size: "sm" })}
            observabilityAction="crew-away-working"
          >
            {person.label}
          </SubmitButton>
        </form>
      ))}
    </div>
  );
}
