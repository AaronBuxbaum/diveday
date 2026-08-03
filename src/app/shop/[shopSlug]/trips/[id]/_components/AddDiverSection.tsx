import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import type { BookableDiver } from "@/db/divers";
import { rentalFitLineText } from "@/i18n/rental-labels";
import { staffTranslator } from "@/i18n/staff-messages";
import { rentalFitLine } from "@/lib/dive-prep";

/**
 * Adding a diver leads with the shop's existing people so a returning diver is
 * *picked*, never re-typed — the "enter once, reuse everywhere" path that keeps
 * the roster from spawning a second person row and orphaning the first diver's
 * certs, waivers, and rental fit. The hand-entry form stays for a genuine
 * first-timer (and for wait-listing once a trip is full).
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
  locale: string;
}) {
  const t = staffTranslator(locale);
  const searched = query.length > 0;
  return (
    <section id="add-diver" className="mt-10 scroll-mt-24">
      <h2 className="text-lg font-semibold">{t("trips.addDiver.heading")}</h2>

      {full ? (
        <p className="mt-1 text-sm text-muted">{t("trips.addDiver.fullDescription")}</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted">{t("trips.addDiver.searchDescription")}</p>

          {/* Server-fed search, same shape as the diver roster: a GET reload
              carries `diverq` and the section re-renders with matches. No client
              state, so the picker stays pixel-stable for visual regression. */}
          <form method="get" className="mt-4 flex flex-wrap items-end gap-2">
            <Field label={t("trips.addDiver.findLabel")} className="min-w-0 flex-1">
              <input
                type="search"
                name="diverq"
                defaultValue={query}
                placeholder={t("trips.addDiver.findPlaceholder")}
                maxLength={120}
                autoComplete="off"
                className={controlClass}
              />
            </Field>
            <SubmitButton
              pendingLabel={t("trips.addDiver.searching")}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("trips.addDiver.search")}
            </SubmitButton>
          </form>

          {searched ? (
            candidates.length > 0 ? (
              <ul className="mt-4 grid gap-2">
                {candidates.map(({ person, rentalFit }) => {
                  const fit = rentalFitLine(rentalFit);
                  return (
                    <li
                      key={person.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-sm"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/shop/${shopSlug}/divers/${person.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {person.fullName}
                        </Link>
                        <p className="text-sm text-muted">
                          {person.email ?? t("trips.addDiver.noEmailOnFile")}
                        </p>
                        {/* "Same as last time": the fit already on file carries
                            onto the trip, so staff confirm rather than re-enter. */}
                        <p className="mt-0.5 text-xs text-muted">
                          {rentalFit
                            ? t("trips.addDiver.rentalFitOnFile", {
                                fit: rentalFitLineText(t, locale, fit),
                              })
                            : t("trips.addDiver.noRentalFitYet")}
                        </p>
                      </div>
                      <form action={addExistingDiverAction}>
                        <input type="hidden" name="tripId" value={tripId} />
                        <input type="hidden" name="personId" value={person.id} />
                        <SubmitButton
                          pendingLabel={t("trips.addDiver.adding")}
                          ariaLabel={t("trips.addDiver.addPersonAriaLabel", {
                            name: person.fullName,
                          })}
                          className={buttonClass({ size: "sm" })}
                        >
                          {t("trips.addDiver.addToTrip")}
                        </SubmitButton>
                      </form>
                    </li>
                  );
                })}
              </ul>
            ) : (
              // The shared empty state, and the sentence's "below" made into a
              // real door: the hand-entry form is also force-opened for this
              // case (see `open=` on the <details> below), so the anchor always
              // lands on a form a staffer can type into.
              <EmptyState className="mt-4">
                <h3 className="font-medium">{t("trips.addDiver.noMatchesHeading")}</h3>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted">
                  {t("trips.addDiver.noMatches", { query })}
                </p>
                <a
                  href="#hand-entry"
                  className={buttonClass({ variant: "secondary", size: "sm", className: "mt-4" })}
                >
                  {t("trips.addDiver.noMatchesAction")}
                </a>
              </EmptyState>
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
          <FieldGrid columns={3}>
            <Field label={t("trips.addDiver.nameLabel")}>
              <input name="fullName" required maxLength={120} className={controlClass} />
            </Field>
            <Field label={t("trips.addDiver.emailLabel")}>
              <input name="email" type="email" required maxLength={200} className={controlClass} />
            </Field>
            <Field label={t("trips.addDiver.phoneLabel")} hint={t("trips.addDiver.optionalHint")}>
              <input name="phone" type="tel" maxLength={30} className={controlClass} />
            </Field>
          </FieldGrid>
          <FieldActions className="mt-4">
            <SubmitButton pendingLabel={t("trips.addDiver.adding")} className={buttonClass()}>
              {full ? t("trips.addDiver.addToWaitlist") : t("trips.addDiver.addToTrip")}
            </SubmitButton>
          </FieldActions>
        </form>
      </details>
    </section>
  );
}
