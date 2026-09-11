import Link from "next/link";
import { seatExistingDiverAction, seatNewDiverAction } from "@/app/actions/seat-diver";
import type { SeatSurfaceId } from "@/app/actions/seat-diver-surfaces";
import { SubmitButton } from "@/components/SubmitButton";
import { HandEntryPrompt } from "@/components/seat-diver/HandEntryPrompt";
import { PersonCandidateList } from "@/components/seat-diver/PersonCandidateList";
import { PersonSearchForm } from "@/components/seat-diver/PersonSearchForm";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import type { BookableDiver, SimilarDiver } from "@/db/divers";
import { fill } from "@/i18n/fill";
import { newDiverHref } from "@/lib/person-fields";

/** Every word this panel says, resolved by the page from the staff bundle. */
export type SeatDiverPanelCopy = {
  findHeading: string;
  findLabel: string;
  findPlaceholder: string;
  noEmailOnFile: string;
  adding: string;
  addLabel: string;
  addPersonAriaLabel: (name: string) => string;
  noMatchesHeading: string;
  noMatches: string;
  noMatchesAction: string;
  addDiver?: string;
  addDiverAction?: string;
  addDiverPrompt?: string;
  addNewDiverAction?: string;
  handEntryHeading?: string;
  handEntryDescription?: string;
  nameLabel?: string;
  emailLabel?: string;
  phoneLabel?: string;
  optionalHint?: string;
  /**
   * Required, unlike its neighbours: the prompt it heads is the one place a
   * staffer is told what picking a candidate costs, and a panel that rendered
   * the list under an empty heading would drop exactly that sentence.
   */
  confirmMatchesTitle: string;
  /**
   * A candidate's last dive day, already dated in the shop's zone by the page.
   * A function rather than a string because the date differs per candidate,
   * and `addPersonAriaLabel` above sets the precedent: the panel holds no
   * translator and no timezone.
   */
  confirmMatchesLastDive?: (at: Date) => string;
  confirmMatchesSubmit?: string;
};

/**
 * The single unified "who is taking this seat?" panel: find a returning diver, or
 * jump to the dedicated create-diver page with the query prefilled.
 */
export function SeatDiverPanel({
  surface,
  shopSlug,
  tripId,
  query,
  candidates,
  personHref,
  searchHiddenFields,
  copy,
  newDiverDefaults,
  confirmName,
  confirmEmail,
  confirmPhone,
  confirmMatches,
}: {
  surface: SeatSurfaceId;
  shopSlug: string;
  tripId: string;
  query: string;
  candidates: BookableDiver[];
  /** Link a candidate's name at their record, or `null` for plain text. */
  personHref?: ((personId: string) => string) | null;
  /** State a GET search must carry, e.g. the walk-in's `?tripId=`. */
  searchHiddenFields?: Record<string, string>;
  /** Request details can prefill a new diver without changing the shared action. */
  newDiverDefaults?: {
    fullName?: string;
    email?: string;
    phone?: string;
  };
  copy: SeatDiverPanelCopy;
  confirmName?: string;
  confirmEmail?: string;
  confirmPhone?: string;
  confirmMatches?: SimilarDiver[];
}) {
  const addHref = newDiverHref(shopSlug, {
    query,
    surface,
    tripId,
    name: newDiverDefaults?.fullName,
    email: newDiverDefaults?.email,
    phone: newDiverDefaults?.phone,
    request: searchHiddenFields?.request,
  });

  return (
    <div className="mt-6 space-y-6">
      {confirmMatches && confirmMatches.length > 0 ? (
        <div className="border border-warning/25 bg-warning/10 rounded-inset p-4 text-left">
          <div className="flex flex-col gap-2">
            <h3 className="font-semibold text-sm">{copy.confirmMatchesTitle}</h3>
            <ul className="list-disc pl-5 space-y-1 text-sm text-muted">
              {confirmMatches.map((match) => (
                <li key={match.id}>
                  <form
                    action={seatExistingDiverAction.bind(null, surface, shopSlug)}
                    className="inline"
                  >
                    <input type="hidden" name="tripId" value={tripId} />
                    <input type="hidden" name="personId" value={match.id} />
                    {/* A tap here is a guess off a trigram name match, so the
                        seat it takes is identity-unconfirmed until a staffer
                        confirms it (issue #1556). The picker below, where a
                        staffer went looking for a diver by name, carries no
                        such field. */}
                    <input type="hidden" name="fromNameMatch" value="true" />
                    <button type="submit" className="underline font-medium text-left">
                      {match.fullName}
                    </button>
                  </form>
                  {match.email || match.phone ? (
                    <span className="text-muted text-xs ml-1">
                      ({[match.email, match.phone].filter(Boolean).join(", ")})
                    </span>
                  ) : null}
                  {match.lastDiveDayAt && copy.confirmMatchesLastDive ? (
                    <span className="text-muted text-xs ml-1">
                      {copy.confirmMatchesLastDive(match.lastDiveDayAt)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            <form action={seatNewDiverAction.bind(null, surface, shopSlug)} className="mt-2">
              <input type="hidden" name="tripId" value={tripId} />
              <input type="hidden" name="fullName" value={confirmName} />
              <input type="hidden" name="email" value={confirmEmail} />
              <input type="hidden" name="phone" value={confirmPhone} />
              <input type="hidden" name="force" value="true" />
              <SubmitButton
                pendingLabel={copy.adding}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {copy.confirmMatchesSubmit || "Create new diver anyway"}
              </SubmitButton>
            </form>
          </div>
        </div>
      ) : null}

      <SectionCard title={copy.findHeading} padding="lg">
        <PersonSearchForm
          query={query}
          hiddenFields={searchHiddenFields}
          label={copy.findLabel}
          placeholder={copy.findPlaceholder}
          addDiverHref={!query ? addHref : undefined}
          addDiverLabel={!query ? copy.addDiver || "Add diver" : undefined}
        />

        {query ? (
          candidates.length > 0 ? (
            <>
              <PersonCandidateList
                className="mt-4"
                candidates={candidates}
                tripId={tripId}
                seatAction={seatExistingDiverAction.bind(null, surface, shopSlug)}
                personHref={personHref}
                addLabel={copy.addLabel}
                pendingLabel={copy.adding}
                addPersonAriaLabel={copy.addPersonAriaLabel}
                noEmailOnFile={copy.noEmailOnFile}
              />
              <p className="rise-in mt-3 text-sm text-muted">
                {copy.addDiverPrompt ? fill(copy.addDiverPrompt, { query }) : "Not listed?"}{" "}
                <Link href={addHref} className="font-medium text-primary hover:underline">
                  {copy.addDiverAction || "Add diver"}
                </Link>
              </p>
            </>
          ) : (
            <HandEntryPrompt
              className="mt-4"
              heading={copy.noMatchesHeading}
              body={copy.noMatches}
              actionLabel={
                copy.addNewDiverAction
                  ? fill(copy.addNewDiverAction, { query })
                  : copy.noMatchesAction
              }
              href={addHref}
            />
          )
        ) : null}
      </SectionCard>
    </div>
  );
}
