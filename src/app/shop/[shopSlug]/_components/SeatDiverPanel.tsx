import { seatExistingDiverAction, seatNewDiverAction } from "@/app/actions/seat-diver";
import { SEAT_SURFACES, type SeatSurfaceId } from "@/app/actions/seat-diver-surfaces";
import { SubmitButton } from "@/components/SubmitButton";
import { HandEntryPrompt } from "@/components/seat-diver/HandEntryPrompt";
import { PersonCandidateList } from "@/components/seat-diver/PersonCandidateList";
import { PersonFieldTrio } from "@/components/seat-diver/PersonFieldTrio";
import { PersonSearchForm } from "@/components/seat-diver/PersonSearchForm";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { FieldActions } from "@/components/ui/form";
import type { BookableDiver } from "@/db/divers";

/** Every word this panel says, resolved by the page from the staff bundle. */
export type SeatDiverPanelCopy = {
  findHeading: string;
  findLabel: string;
  findPlaceholder: string;
  search: string;
  searching: string;
  noEmailOnFile: string;
  adding: string;
  addLabel: string;
  addPersonAriaLabel: (name: string) => string;
  noMatchesHeading: string;
  noMatches: string;
  noMatchesAction: string;
  handEntryHeading: string;
  handEntryDescription: string;
  nameLabel: string;
  emailLabel: string;
  phoneLabel: string;
  optionalHint: string;
};

/**
 * The two-card "who is taking this seat?" panel: find a returning diver, or
 * hand-enter a fresh one.
 *
 * The counter walk-in and the global Add-booking door were ~85% the same page —
 * the same search form, the same candidate rows, the same empty box, the same
 * three-field form — kept in two files under two message namespaces, so the one
 * thing that genuinely differs between them (whether the email is required) had
 * been hand-copied into JSX even though `SEAT_SURFACES` already declares it.
 * This reads that declaration instead: pass the surface id and the panel binds
 * the shared seat-a-diver actions to it and takes its email rule from the same
 * row a reviewer reads for the refusal vocabulary and the landing paths.
 *
 * It lives under `src/app` rather than `src/components` deliberately — it
 * imports the server actions and the surface table, and shared UI may not reach
 * up into `src/app` (`pnpm check:architecture`). The pieces it composes are the
 * genuinely presentational ones and do live in `src/components/seat-diver/`.
 *
 * Words arrive as props: staff copy is resolved server-side by the page
 * (AGENTS.md — `staffTranslator` is server-side only).
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
}) {
  return (
    <div className="mt-6 space-y-6">
      <SectionCard title={copy.findHeading} padding="lg">
        <PersonSearchForm
          query={query}
          hiddenFields={searchHiddenFields}
          label={copy.findLabel}
          placeholder={copy.findPlaceholder}
          submitLabel={copy.search}
          pendingLabel={copy.searching}
        />

        {query ? (
          candidates.length > 0 ? (
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
          ) : (
            <HandEntryPrompt
              className="mt-4"
              heading={copy.noMatchesHeading}
              body={copy.noMatches}
              actionLabel={copy.noMatchesAction}
            />
          )
        ) : null}
      </SectionCard>

      <SectionCard
        id="hand-entry"
        className="scroll-mt-24"
        padding="lg"
        title={copy.handEntryHeading}
        description={copy.handEntryDescription}
      >
        <form action={seatNewDiverAction.bind(null, surface, shopSlug)}>
          <input type="hidden" name="tripId" value={tripId} />
          <PersonFieldTrio
            as="div"
            email={SEAT_SURFACES[surface].email}
            nameLabel={copy.nameLabel}
            emailLabel={copy.emailLabel}
            phoneLabel={copy.phoneLabel}
            optionalHint={copy.optionalHint}
            defaultValues={newDiverDefaults}
          />
          <FieldActions className="mt-4">
            <SubmitButton pendingLabel={copy.adding} className={buttonClass()}>
              {copy.addLabel}
            </SubmitButton>
          </FieldActions>
        </form>
      </SectionCard>
    </div>
  );
}
