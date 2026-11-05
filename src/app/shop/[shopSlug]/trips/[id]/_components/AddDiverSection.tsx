import Link from "next/link";
import { HandEntryPrompt } from "@/components/seat-diver/HandEntryPrompt";
import { NameMatchPrompt } from "@/components/seat-diver/NameMatchPrompt";
import { PersonCandidateList } from "@/components/seat-diver/PersonCandidateList";
import { PersonSearchForm } from "@/components/seat-diver/PersonSearchForm";
import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";
import type { BookableDiver, SimilarDiver } from "@/db/divers";
import { rentalFitLineText } from "@/i18n/rental-labels";
import { staffTranslator } from "@/i18n/staff-messages";
import { DAY_MS, nowDate } from "@/lib/clock";
import { rentalFitLine } from "@/lib/dive-prep";
import { newDiverHref } from "@/lib/person-fields";
import type { FormNotice } from "@/lib/staff-notices";
import type { AddBandMode } from "./add-band-mode";

/** The date request a band was opened from, reduced to what the forms carry. */
export type SeatRequestContext = {
  id: string;
  prefill?: { fullName?: string; email?: string; phone?: string };
};

/** What the add-diver band reads, built once by `TripRosterContent`. */
export type AddDiverContext = {
  shopSlug: string;
  tripId: string;
  full: boolean;
  query: string;
  candidates: BookableDiver[];
  recentInviteDates?: ReadonlyMap<string, Date>;
  addBookingAction: (formData: FormData) => void;
  addToWaitlistAction: (formData: FormData) => void;
  /** Puts a diver already on file on the full boat's wait list, by `personId`. */
  addKnownToWaitlistAction: (formData: FormData) => void;
  addExistingDiverAction: (formData: FormData) => void;
  offerAction?: (formData: FormData) => void;
  /**
   * What the last seating attempt did — sat them, wait-listed them, or refused
   * on a cert gate. Section-level rather than on one of the three forms below,
   * because any of them could have been the one submitted; it renders under the
   * heading the refusal's own `#add-diver` landing scrolls to.
   */
  status?: FormNotice;
  locale: string;
  /** The shop's own zone, so a candidate's last dive day is dated in it. */
  timeZone: string;
  confirmName?: string;
  confirmEmail?: string;
  confirmPhone?: string;
  confirmMatches?: SimilarDiver[];
  /**
   * The shop's rental catalog, so "same as last time" cannot offer back a
   * piece the shop stopped renting as an ordinary one to hand over. Optional
   * for the same reason it is optional on `rentalFitLine`: a caller with none
   * to hand shows every piece the fit asks for, which over-includes rather
   * than hides.
   */
  shopRentalItems?: readonly string[];
  /**
   * `"counter"` while the departure's arrivals are open, it has not sailed and
   * the band is not answering a date request (`addBandMode`): the band is one
   * search field, its picks are walk-ins and its door for someone new is "Add
   * as a walk-in", which asks for a name alone. The desk chooses nothing.
   * Unset, the band books: a returning diver or a hand-entered one with an email.
   */
  mode?: AddBandMode;
  /**
   * The shop keeps a wait list (the Features page). Off, a full boat says it
   * is full and offers no one a place on a list.
   */
  waitlistOn?: boolean;
  /**
   * The date request the band was opened from (`?request=`). Each booking seat
   * it makes posts the id and says so on its button, so the seat closes the
   * request; a search keeps it; a request from somebody not on file prefills
   * the new diver. The counter never carries it: a band answering a request
   * books.
   */
  request?: SeatRequestContext;
  className?: string;
};

/**
 * Adding a diver leads with the shop's existing people so a returning diver is
 * *picked*, never re-typed — the "enter once, reuse everywhere" path that keeps
 * the roster from spawning a second person row and orphaning the first diver's
 * certs, waivers, and rental fit.
 *
 * Typing a query presents both the matching candidate divers and a one-tap
 * "Add diver" path prefilled with their name or email.
 *
 * **One column at one gap, and no part brings a margin of its own.** Each
 * part carried its own top margin (the status `mt-2`, the search row `mt-4`,
 * the full boat's line `mt-1`), so the space under the roster's band was
 * whatever the first part to render happened to carry: 28px above the search
 * row against the 20px below it (pixel probe, trip-guests). The roster's
 * wrapper owns the inset on both sides; `className` is a caller's placement.
 */
export function AddDiverSection({
  context,
  className = "",
}: {
  context: AddDiverContext;
  className?: string;
}) {
  const {
    shopSlug,
    tripId,
    full,
    query,
    candidates,
    recentInviteDates,
    addBookingAction,
    addToWaitlistAction,
    addKnownToWaitlistAction,
    addExistingDiverAction,
    offerAction,
    status,
    locale,
    timeZone,
    confirmName,
    confirmEmail,
    confirmPhone,
    confirmMatches,
    shopRentalItems,
    mode,
    waitlistOn = true,
    request,
  } = context;
  const t = staffTranslator(locale);
  const searched = query.length > 0;
  const walkInOpen = mode === "counter";
  // What every door for someone new carries from the request: its id, and the
  // name, email and phone they asked with when they are not on file.
  const fromRequest = request
    ? {
        request: request.id,
        name: request.prefill?.fullName,
        email: request.prefill?.email,
        phone: request.prefill?.phone,
      }
    : {};
  // What a search must carry so the next render is the same band: the
  // request (`add` is a flash param and does not survive). A band with a
  // request never counters, so the two never meet.
  const requestFields = request ? { request: request.id } : undefined;
  const searchFields = requestFields;
  const bookNewDiver = newDiverHref(shopSlug, {
    query,
    surface: "departure",
    tripId,
    ...fromRequest,
  });
  // Someone at the counter is not the request's party (dock review F2).
  const walkInNewDiver = newDiverHref(shopSlug, {
    query,
    surface: "departure",
    walkIn: true,
    tripId,
  });
  const waitNewDiver = newDiverHref(shopSlug, {
    query,
    surface: "departure",
    tripId,
    waitlist: true,
    ...fromRequest,
  });
  // A door for someone new that carries the request says so, as a pick does:
  // its label and its payload agree (round-2 domain review, finding 1).
  const forRequest = Boolean(request);
  const bookLabel = forRequest
    ? t("trips.addDiver.addForRequest")
    : t("trips.addDiver.addNewDiverAction", { query });
  const walkInLabel = t("trips.addDiver.addAsWalkIn");
  // An empty result carries the doors for someone new itself, so the search
  // draws none beside it then: one "Add diver" on the band at a time.
  const noMatch = searched && candidates.length === 0;
  return (
    <div className={`flex flex-col gap-4 ${className}`.trim()}>
      <FormStatus tone={status?.tone}>{status?.text}</FormStatus>

      {waitlistOn || !full ? (
        <NameMatchPrompt
          matches={confirmMatches ?? []}
          tripId={tripId}
          confirmName={confirmName}
          confirmEmail={confirmEmail}
          confirmPhone={confirmPhone}
          // On a full boat the match joins who's waiting: a seat would only be
          // refused.
          seatKnownAction={full ? addKnownToWaitlistAction : addExistingDiverAction}
          seatNewAction={full ? addToWaitlistAction : addBookingAction}
          hiddenFields={requestFields}
          t={t}
          locale={locale}
          timeZone={timeZone}
        />
      ) : null}

      {full && !waitlistOn ? (
        <p className="text-sm text-muted">{t("trips.addDiver.fullDescription")}</p>
      ) : full ? (
        <>
          <p className="text-sm text-muted">{t("trips.addDiver.fullDescription")}</p>
          {request ? (
            <p className="text-sm text-muted">{t("trips.addDiver.fullRequestStaysOpen")}</p>
          ) : null}
          {/* A full boat leads with the shop's people too (Aaron, 2026-10-23):
              a returning diver is picked onto who's waiting, never typed
              again, and "Add diver" stays the door for someone new. */}
          <PersonSearchForm
            query={query}
            hiddenFields={searchFields}
            label={t("trips.addDiver.findLabel")}
            placeholder={t("trips.addDiver.findPlaceholder")}
            addDiverHref={noMatch ? undefined : waitNewDiver}
            addDiverLabel={t("trips.addDiver.addDiver")}
          />
          {searched ? (
            candidates.length > 0 ? (
              <PersonCandidateList
                context={{
                  candidates,
                  tripId,
                  seatAction: addKnownToWaitlistAction,
                  requestId: request?.id,
                  personHref: (personId) => `/shop/${shopSlug}/divers/${personId}`,
                  addLabel: t("trips.addDiver.addToWaitlist"),
                  pendingLabel: t("words.busy.adding"),
                  addPersonAriaLabel: (name) => t("trips.addDiver.addPersonToWaitlist", { name }),
                  noEmailOnFile: t("trips.addDiver.noEmailOnFile"),
                }}
                rowClassName="bg-surface"
              />
            ) : (
              <HandEntryPrompt
                heading={t("trips.addDiver.noMatchesHeading")}
                body={t("trips.addDiver.noMatches", { query })}
                actionLabel={t("trips.addDiver.addToWaitlist")}
                href={waitNewDiver}
              />
            )
          ) : null}
        </>
      ) : (
        <>
          <PersonSearchForm
            query={query}
            hiddenFields={searchFields}
            label={t("trips.addDiver.findLabel")}
            placeholder={t("trips.addDiver.findPlaceholder")}
            // At the counter the band is one field: someone new is offered by
            // the search's own result, never a second door beside it.
            addDiverHref={walkInOpen || noMatch ? undefined : bookNewDiver}
            addDiverLabel={
              walkInOpen
                ? undefined
                : forRequest
                  ? t("trips.addDiver.addForRequest")
                  : t("trips.addDiver.addDiver")
            }
          />

          {searched ? (
            candidates.length > 0 ? (
              <>
                <PersonCandidateList
                  context={{
                    candidates,
                    tripId,
                    seatAction: addExistingDiverAction,
                    requestId: request?.id,
                    invite: offerAction
                      ? {
                          action: offerAction,
                          label: t("trips.addDiver.offerSeat"),
                          pendingLabel: t("trips.addDiver.offerSeating"),
                          personAriaLabel: (name) => t("trips.addDiver.offerSeatAria", { name }),
                        }
                      : undefined,
                    personHref: (personId) => `/shop/${shopSlug}/divers/${personId}`,
                    // "Same as last time": the fit already on file carries onto the
                    // trip, so staff confirm rather than re-enter.
                    extraLine: ({ person, rentalFit }) => {
                      const invitedAt = offerAction ? recentInviteDates?.get(person.id) : undefined;
                      const days = invitedAt
                        ? Math.max(
                            0,
                            Math.floor((nowDate().getTime() - invitedAt.getTime()) / DAY_MS),
                          )
                        : null;
                      return (
                        <>
                          <p className="mt-0.5 text-xs text-muted">
                            {rentalFit
                              ? t("trips.addDiver.rentalFitOnFile", {
                                  fit: rentalFitLineText(
                                    t,
                                    locale,
                                    rentalFitLine(rentalFit, shopRentalItems),
                                  ),
                                })
                              : t("trips.addDiver.noRentalFitYet")}
                          </p>
                          {days === null ? null : (
                            <p className="mt-0.5 text-xs text-muted">
                              {days === 0
                                ? t("trips.addDiver.invitedToday")
                                : t("trips.addDiver.invitedDaysAgo", { days })}
                            </p>
                          )}
                        </>
                      );
                    },
                    // A pick that answers the request says so, seat by seat:
                    // the search also finds people who are not the party.
                    addLabel: t(
                      request ? "trips.addDiver.addForRequest" : "trips.addDiver.addToTrip",
                    ),
                    pendingLabel: t("words.busy.adding"),
                    addPersonAriaLabel: (name) =>
                      t(
                        request
                          ? "trips.addDiver.addPersonForRequestAria"
                          : "trips.addDiver.addPersonAriaLabel",
                        { name },
                      ),
                    noEmailOnFile: t("trips.addDiver.noEmailOnFile"),
                  }}
                  rowClassName="bg-surface"
                />
                {/* The match list can miss the person at the desk (another Sam);
                    the door for someone new stays one tap away under it. */}
                {walkInOpen ? (
                  <div className="flex flex-wrap gap-x-4">
                    <Link
                      href={walkInNewDiver}
                      className={buttonClass({ variant: "ghost", size: "sm", flush: true })}
                    >
                      {walkInLabel}
                    </Link>
                  </div>
                ) : null}
              </>
            ) : (
              <HandEntryPrompt
                heading={t("trips.addDiver.noMatchesHeading")}
                body={t("trips.addDiver.noMatches", { query })}
                actionLabel={walkInOpen ? walkInLabel : bookLabel}
                href={walkInOpen ? walkInNewDiver : bookNewDiver}
              />
            )
          ) : null}
        </>
      )}
    </div>
  );
}
