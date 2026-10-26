import Link from "next/link";
import { awayDatesText } from "@/i18n/away-labels";
import { fill } from "@/i18n/fill";
import type { StaffingWeekWords } from "./StaffingWeek";
import type { mobileDepartureGroups } from "./staffing-mobile-groups";
import { WarningLine } from "./staffing-warning-line";

/** Every person keeps their own warning facts under the departure they crew. */
export function StaffingDepartureCrew({
  crew,
  href,
  words,
  locale,
}: {
  crew: ReturnType<typeof mobileDepartureGroups>[number]["crew"];
  href: string;
  words: StaffingWeekWords;
  locale: string;
}) {
  return crew.length > 0 ? (
    <ul className="mt-1">
      {crew.map(({ person, trip: ownTrip }) => (
        <li key={person.personId}>
          <Link
            href={href}
            className="flex min-h-11 flex-col justify-center py-1 text-sm hover:underline"
          >
            <span className="font-medium">{person.name}</span>
            {ownTrip.clashes.map((clash) => (
              <WarningLine key={clash.tripId} size="sm">
                {fill(words.crewClash, { departure: clash.title })}
              </WarningLine>
            ))}
            {ownTrip.awayBlocks.length > 0 ? (
              <WarningLine size="sm">
                {fill(words.awayConflict, {
                  dates: awayDatesText(ownTrip.awayBlocks, locale),
                })}
              </WarningLine>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  ) : null;
}
