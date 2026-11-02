import Link from "next/link";
import { seatExistingDiverAction, seatNewDiverAction } from "@/app/actions/seat-diver";
import type { SeatSurfaceId } from "@/app/actions/seat-diver-surfaces";
import { HandEntryPrompt } from "@/components/seat-diver/HandEntryPrompt";
import { NameMatchPrompt } from "@/components/seat-diver/NameMatchPrompt";
import { PersonCandidateList } from "@/components/seat-diver/PersonCandidateList";
import { PersonSearchForm } from "@/components/seat-diver/PersonSearchForm";
import { SectionCard } from "@/components/ui/card";
import type { BookableDiver, SimilarDiver } from "@/db/divers";
import { fill } from "@/i18n/fill";
import type { StaffTranslator } from "@/i18n/staff-messages";
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
  addDiver: string;
  addDiverAction: string;
  addDiverPrompt: string;
  addNewDiverAction?: string;
  handEntryHeading?: string;
  handEntryDescription?: string;
  nameLabel?: string;
  emailLabel?: string;
  phoneLabel?: string;
  optionalHint?: string;
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
  t,
  locale,
  timeZone,
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
  /** The staff translator, for the name-match prompt both shells share. */
  t: StaffTranslator;
  locale: string;
  /** The shop's own zone, so a candidate's last dive day is dated in it. */
  timeZone: string;
  confirmName?: string;
  confirmEmail?: string;
  confirmPhone?: string;
  confirmMatches?: SimilarDiver[];
}) {
  // The request this door was opened from closes as booked when a seat is made
  // (third UX review, item 13); every seat form below posts it.
  const requestId = searchHiddenFields?.request;
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
      <NameMatchPrompt
        matches={confirmMatches ?? []}
        tripId={tripId}
        confirmName={confirmName}
        confirmEmail={confirmEmail}
        confirmPhone={confirmPhone}
        seatKnownAction={seatExistingDiverAction.bind(null, surface, shopSlug)}
        seatNewAction={seatNewDiverAction.bind(null, surface, shopSlug)}
        hiddenFields={requestId ? { request: requestId } : undefined}
        t={t}
        locale={locale}
        timeZone={timeZone}
      />

      <SectionCard title={copy.findHeading} padding="lg">
        <PersonSearchForm
          query={query}
          hiddenFields={searchHiddenFields}
          label={copy.findLabel}
          placeholder={copy.findPlaceholder}
          addDiverHref={!query ? addHref : undefined}
          addDiverLabel={!query ? copy.addDiver : undefined}
        />

        {query ? (
          candidates.length > 0 ? (
            <>
              <PersonCandidateList
                context={{
                  candidates,
                  tripId,
                  seatAction: seatExistingDiverAction.bind(null, surface, shopSlug),
                  requestId,
                  personHref,
                  addLabel: copy.addLabel,
                  pendingLabel: copy.adding,
                  addPersonAriaLabel: copy.addPersonAriaLabel,
                  noEmailOnFile: copy.noEmailOnFile,
                }}
                className="mt-4"
              />
              <p className="rise-in mt-3 text-sm text-muted">
                {fill(copy.addDiverPrompt, { query })}{" "}
                <Link href={addHref} className="font-medium text-primary hover:underline">
                  {copy.addDiverAction}
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
