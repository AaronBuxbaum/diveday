import { SEAT_SURFACES } from "@/app/actions/seat-diver-surfaces";
import { SubmitButton } from "@/components/SubmitButton";
import { HandEntryPrompt } from "@/components/seat-diver/HandEntryPrompt";
import { PersonCandidateList } from "@/components/seat-diver/PersonCandidateList";
import { PersonFieldTrio } from "@/components/seat-diver/PersonFieldTrio";
import { PersonSearchForm } from "@/components/seat-diver/PersonSearchForm";
import { buttonClass } from "@/components/ui/button";
import { FieldActions, FormStatus } from "@/components/ui/form";
import type { BookableDiver } from "@/db/divers";
import { rentalFitLineText } from "@/i18n/rental-labels";
import { staffTranslator } from "@/i18n/staff-messages";
import { rentalFitLine } from "@/lib/dive-prep";
import type { FormNotice } from "@/lib/staff-notices";

/**
 * Adding a diver leads with the shop's existing people so a returning diver is
 * *picked*, never re-typed — the "enter once, reuse everywhere" path that keeps
 * the roster from spawning a second person row and orphaning the first diver's
 * certs, waivers, and rental fit. The hand-entry form stays for a genuine
 * first-timer (and for wait-listing once a trip is full).
 *
 * The search box, the candidate rows, the "nobody by that name" box, and the
 * three-field form are the shared seat-a-diver pieces
 * (src/components/seat-diver/), the same ones the counter walk-in and the
 * global Add-booking door wear. What is genuinely this door's own stays here:
 * the rental-fit line under each candidate ("same as last time"), the
 * full-boat branch that sends a hand-entered diver to the wait list instead of
 * the manifest, and the collapsed `<details>` this page opens the form inside.
 */
export function AddDiverSection({
  shopSlug,
  tripId,
  full,
  query,
  candidates,
  addBookingAction,
  addToWaitlistAction,
  addExistingDiverAction,
  status,
  locale,
}: {
  shopSlug: string;
  /**
   * Submitted as a hidden field rather than bound into the action: seating a
   * diver goes through the shared `seatNewDiverAction`/`seatExistingDiverAction`
   * (src/app/actions/seat-diver.ts), and every door hands them the same
   * `tripId` + diver shape — including the trip-first ones (the counter
   * walk-in, the global Add-booking door) where the boat is chosen in the form.
   */
  tripId: string;
  full: boolean;
  query: string;
  candidates: BookableDiver[];
  addBookingAction: (formData: FormData) => void;
  addToWaitlistAction: (formData: FormData) => void;
  addExistingDiverAction: (formData: FormData) => void;
  /**
   * What the last seating attempt did — sat them, wait-listed them, or refused
   * on a cert gate. Section-level rather than on one of the three forms below,
   * because any of them could have been the one submitted; it renders under the
   * heading the refusal's own `#add-diver` landing scrolls to.
   */
  status?: FormNotice;
  locale: string;
}) {
  const t = staffTranslator(locale);
  const searched = query.length > 0;
  return (
    <section id="add-diver" className="mt-10 scroll-mt-24">
      <h2 className="text-lg font-semibold">{t("trips.addDiver.heading")}</h2>
      <FormStatus tone={status?.tone} className="mt-2">
        {status?.text}
      </FormStatus>

      {full ? (
        <p className="mt-1 text-sm text-muted">{t("trips.addDiver.fullDescription")}</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted">{t("trips.addDiver.searchDescription")}</p>

          <PersonSearchForm
            className="mt-4"
            query={query}
            label={t("trips.addDiver.findLabel")}
            placeholder={t("trips.addDiver.findPlaceholder")}
            submitLabel={t("seatDiver.search")}
            pendingLabel={t("seatDiver.searching")}
          />

          {searched ? (
            candidates.length > 0 ? (
              <PersonCandidateList
                className="mt-4"
                candidates={candidates}
                tripId={tripId}
                seatAction={addExistingDiverAction}
                personHref={(personId) => `/shop/${shopSlug}/divers/${personId}`}
                rowClassName="bg-surface shadow-sm"
                // "Same as last time": the fit already on file carries onto the
                // trip, so staff confirm rather than re-enter.
                extraLine={({ rentalFit }) => (
                  <p className="mt-0.5 text-xs text-muted">
                    {rentalFit
                      ? t("trips.addDiver.rentalFitOnFile", {
                          fit: rentalFitLineText(t, locale, rentalFitLine(rentalFit)),
                        })
                      : t("trips.addDiver.noRentalFitYet")}
                  </p>
                )}
                addLabel={t("trips.addDiver.addToTrip")}
                pendingLabel={t("seatDiver.adding")}
                addPersonAriaLabel={(name) => t("trips.addDiver.addPersonAriaLabel", { name })}
                noEmailOnFile={t("trips.addDiver.noEmailOnFile")}
              />
            ) : (
              // The shared empty state, and the sentence's "below" made into a
              // real door: the hand-entry form is also force-opened for this
              // case (see `open=` on the <details> below), so the anchor always
              // lands on a form a staffer can type into.
              <HandEntryPrompt
                className="mt-4"
                heading={t("trips.addDiver.noMatchesHeading")}
                body={t("trips.addDiver.noMatches", { query })}
                actionLabel={t("seatDiver.noMatchesAction")}
              />
            )
          ) : null}
        </>
      )}

      {/* Open when there is nothing else to act on: no search yet, a full boat
          (wait-listing is the only path), or a search that found nobody — the
          case the empty state above sends a staffer straight here for. */}
      <details
        id="hand-entry"
        className="group mt-4 scroll-mt-24"
        open={full || !searched || candidates.length === 0}
      >
        {!full ? (
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-sm font-medium text-primary hover:underline [&::-webkit-details-marker]:hidden">
            {t("trips.addDiver.handEntrySummary")}
          </summary>
        ) : null}
        <p className="mt-1 text-sm text-muted">
          {full
            ? t("trips.addDiver.handEntryDescriptionWaitlist")
            : t("trips.addDiver.handEntryDescriptionManifest")}
        </p>
        <form action={full ? addToWaitlistAction : addBookingAction} className="mt-4">
          {/* Ignored by the wait-list action, which is bound to its trip. */}
          <input type="hidden" name="tripId" value={tripId} />
          <PersonFieldTrio
            as="div"
            // The roster keeps asking for an email — a diver added here is
            // usually being set up for a waiver and a confirmation. Read from
            // the surface table rather than restated, so this form and the
            // action validating it cannot disagree.
            email={SEAT_SURFACES["trip-guests"].email}
            nameLabel={t("trips.addDiver.nameLabel")}
            emailLabel={t("seatDiver.emailLabel")}
            phoneLabel={t("seatDiver.phoneLabel")}
            optionalHint={t("seatDiver.optionalHint")}
          />
          <FieldActions className="mt-4">
            <SubmitButton pendingLabel={t("seatDiver.adding")} className={buttonClass()}>
              {full ? t("trips.addDiver.addToWaitlist") : t("trips.addDiver.addToTrip")}
            </SubmitButton>
          </FieldActions>
        </form>
      </details>
    </section>
  );
}
