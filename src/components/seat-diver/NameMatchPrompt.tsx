import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { noDiveDayNeedsSaying } from "@/lib/name-match-evidence";
import type { SimilarDiver } from "../../lib/diver-choice-types";
import { NameMatchCandidateFacts } from "./NameMatchCandidateFacts";

/**
 * The "is this the same person?" prompt the add-a-diver shells show when a
 * typed name sounds like somebody on file (the departure's add band). One
 * component, so the wording, the facts beside each candidate and the two ways
 * out cannot drift between the shells that use it.
 *
 * It holds no action of its own. A shell passes the actions it already binds
 * (the band's `addExistingDiverAction` and `addBookingAction`, or the
 * wait-list pair on a full boat), and the hidden fields that must ride along
 * on every form (the request a seat closes as booked) come in as
 * `hiddenFields`.
 */
export function NameMatchPrompt({
  matches,
  tripId,
  confirmName,
  confirmEmail,
  confirmPhone,
  seatKnownAction,
  seatNewAction,
  hiddenFields,
  t,
  locale,
  timeZone,
}: {
  matches: SimilarDiver[];
  tripId: string;
  confirmName?: string;
  confirmEmail?: string;
  confirmPhone?: string;
  /** Puts the tapped candidate on the departure (or its wait list). */
  seatKnownAction: (formData: FormData) => void;
  /** Creates the typed diver anyway (`force`), seat or wait list. */
  seatNewAction: (formData: FormData) => void;
  /** State every form here carries, e.g. the request being booked. */
  hiddenFields?: { request?: string };
  t: StaffTranslator;
  locale: string;
  /** The shop's own zone, so a candidate's last dive day is dated in it. */
  timeZone: string;
}) {
  if (matches.length === 0) return null;
  // A candidate with no dive day says so only when a sibling has one; the rule
  // and the bias it corrects are in `noDiveDayNeedsSaying`.
  const sayNoDiveDay = noDiveDayNeedsSaying(matches);
  const carried = Object.entries(hiddenFields ?? {}).map(([name, value]) => (
    <input key={name} type="hidden" name={name} value={value} />
  ));
  return (
    <div className="border border-warning/25 bg-warning/10 rounded-inset p-4 text-start">
      <div className="flex flex-col gap-2">
        <h3 className="font-semibold text-sm">
          {t("divers.page.confirmMatchesTitle", { name: confirmName ?? "" })}
        </h3>
        <ul className="list-disc ps-5 space-y-1 text-sm text-muted">
          {matches.map((match) => (
            <li key={match.id}>
              <form action={seatKnownAction} className="inline">
                <input type="hidden" name="tripId" value={tripId} />
                <input type="hidden" name="personId" value={match.id} />
                {/* A tap here came off a name match, so the booking is told the
                    name it matched on: the prompt fires on an exact spelling
                    too, and only the comparison says whether the seat is
                    identity-unconfirmed (issue #1556). The "create a new diver
                    anyway" form below carries no such field: it invents
                    nobody's history. */}
                <input type="hidden" name="fromNameMatch" value="true" />
                <input type="hidden" name="nameMatchQuery" value={confirmName ?? ""} />
                {carried}
                <SubmitButton
                  pendingLabel={t("words.busy.adding")}
                  className="underline font-medium text-start"
                >
                  {match.fullName}
                </SubmitButton>
              </form>
              <NameMatchCandidateFacts
                match={match}
                sayNoDiveDay={sayNoDiveDay}
                t={t}
                locale={locale}
                timeZone={timeZone}
                size="xs"
              />
            </li>
          ))}
        </ul>
        <form action={seatNewAction} className="mt-2">
          <input type="hidden" name="tripId" value={tripId} />
          <input type="hidden" name="fullName" value={confirmName} />
          <input type="hidden" name="email" value={confirmEmail} />
          <input type="hidden" name="phone" value={confirmPhone} />
          <input type="hidden" name="force" value="true" />
          {carried}
          <SubmitButton
            pendingLabel={t("words.busy.adding")}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {t("divers.page.confirmMatchesSubmit")}
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
