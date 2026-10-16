import { NameMatchCandidateFacts } from "@/components/seat-diver/NameMatchCandidateFacts";
import { legendClass, radioClass, radioRingClass } from "@/components/ui/form";
import type { SimilarDiver } from "@/db/divers";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { noDiveDayNeedsSaying } from "@/lib/name-match-evidence";
import { WALK_IN_NEW_PERSON, walkInMemberField } from "@/lib/walk-in-party";

/** One party row the on-file check stopped on: the name typed, and who it reads like. */
export type PartyOnFileRow = { row: number; typedName: string; matches: SimilarDiver[] };

/**
 * **Which record is each of these people?** (review fixes, dive-domain FIX
 * 4). The party's on-file check names every row whose name reads like
 * somebody already on file, and each gets its own choice here, inside the
 * form: the record on file (with the same facts the single walk-in's prompt
 * prints, so a namesake can be told apart) or a new person. Nothing is
 * settled for the whole party at once, so a regular's card, date of birth and
 * history stay on their own record.
 */
export function PartyOnFileChoices({
  rows,
  t,
  locale,
  timeZone,
}: {
  rows: PartyOnFileRow[];
  t: StaffTranslator;
  locale: string;
  timeZone: string;
}) {
  return (
    <div className="col-span-full grid gap-4 rounded-lg border border-warning/25 bg-warning/10 p-4">
      {rows.map(({ row, typedName, matches }) => {
        const name = walkInMemberField(row, "match");
        const sayNoDiveDay = noDiveDayNeedsSaying(matches);
        return (
          <fieldset key={row} className="grid gap-2">
            <legend className={`${legendClass} text-sm font-semibold`}>{typedName}</legend>
            {matches.map((match) => (
              <label
                key={match.id}
                className={`flex min-h-11 items-start gap-2 rounded-lg text-sm ${radioRingClass}`}
              >
                <input
                  type="radio"
                  name={name}
                  value={match.id}
                  required
                  className={`${radioClass} mt-1`}
                />
                <span>
                  <span className="font-medium">
                    {matches.length === 1 ? t("divers.page.party.useOnFile") : match.fullName}
                  </span>
                  <NameMatchCandidateFacts
                    match={match}
                    sayNoDiveDay={sayNoDiveDay}
                    t={t}
                    locale={locale}
                    timeZone={timeZone}
                    size="sm"
                  />
                </span>
              </label>
            ))}
            <label
              className={`flex min-h-11 items-center gap-2 rounded-lg text-sm ${radioRingClass}`}
            >
              <input
                type="radio"
                name={name}
                value={WALK_IN_NEW_PERSON}
                required
                className={radioClass}
              />
              <span className="font-medium">{t("divers.page.party.newPerson")}</span>
            </label>
          </fieldset>
        );
      })}
    </div>
  );
}
