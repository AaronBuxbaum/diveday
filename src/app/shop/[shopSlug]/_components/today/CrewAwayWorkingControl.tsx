import { acknowledgeCrewAwayAction } from "@/app/shop/[shopSlug]/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { TodayAction } from "@/lib/today";

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

/**
 * The control on a `crew_away` row of Today: one tap per person it names,
 * the reader left out (security review of #2678: the row warns the shop about
 * them, and the write refuses it too). Null when nobody is left to tap for;
 * the row keeps its door to the crew editor either way.
 */
export function crewAwayRowControl(
  action: TodayAction,
  t: StaffTranslator,
  readerPersonId: string | undefined,
) {
  const people = (action.crewAway?.people ?? []).filter(
    (person) => person.personId !== readerPersonId,
  );
  if (!action.departure || people.length === 0) return null;
  return (
    <CrewAwayWorkingControl
      tripId={action.departure.tripId}
      people={people.map((person) => ({
        personId: person.personId,
        label: t("today.crewAway.working", { name: person.fullName }),
      }))}
      pendingLabel={t("today.crewAway.saving")}
    />
  );
}
