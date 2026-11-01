import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { InviteSuggestions } from "@/db/invite-suggestions";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { formatPastMonth } from "@/lib/format";
import { RosterGroupBand } from "./RosterGroupBand";

/**
 * **Who to ask, under the guests** (fifth-loop ideas, item 44; H-20261014-one-to-one-invite): the
 * past divers of this departure's site, each with an "Invite" that emails
 * them one invitation for this departure. The list already leaves out anyone
 * aboard, invited here, or contacted inside the 30-day cooldown; the send
 * holds the line again. Drawn only while the departure has a seat to offer.
 */
export function InviteSuggestionsGroup({
  suggestions,
  action,
  locale,
  timeZone,
}: {
  suggestions: InviteSuggestions;
  action: (formData: FormData) => void;
  locale: string;
  timeZone: string;
}) {
  const t = staffTranslator(locale);
  const now = nowDate();
  const more = suggestions.total - suggestions.shown.length;
  return (
    <>
      <RosterGroupBand
        id="invite-suggestions"
        className="print:hidden"
        label={t("trips.inviteSuggestions.heading", { site: suggestions.siteName })}
      >
        <p className="text-xs text-muted">{t("trips.inviteSuggestions.description")}</p>
      </RosterGroupBand>
      <ul className="divide-y divide-border print:hidden" data-testid="invite-suggestions">
        {suggestions.shown.map((person) => (
          <li
            key={person.personId}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 text-sm sm:px-5"
          >
            <p className="min-w-0">
              <span className="font-medium text-base">{person.fullName}</span>{" "}
              <span className="text-muted">
                {formatPastMonth(person.lastDivedAt, locale, timeZone, now)}
              </span>
            </p>
            <form action={action}>
              <input type="hidden" name="personId" value={person.personId} />
              <SubmitButton
                pendingLabel={t("trips.addDiver.offerSeating")}
                ariaLabel={t("trips.addDiver.offerSeatAria", { name: person.fullName })}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {t("trips.addDiver.offerSeat")}
              </SubmitButton>
            </form>
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <p className="px-4 pb-2 text-sm text-muted sm:px-5 print:hidden">
          {t("trips.inviteSuggestions.more", { count: more })}
        </p>
      ) : null}
    </>
  );
}
