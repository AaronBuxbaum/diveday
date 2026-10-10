import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { HandEntryPrompt } from "@/components/seat-diver/HandEntryPrompt";
import { NameMatchCandidateFacts } from "@/components/seat-diver/NameMatchCandidateFacts";
import { PersonCandidateList } from "@/components/seat-diver/PersonCandidateList";
import { PersonSearchForm } from "@/components/seat-diver/PersonSearchForm";
import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";
import type { BookableDiver, SimilarDiver } from "@/db/divers";
import { rentalFitLineText } from "@/i18n/rental-labels";
import { staffTranslator } from "@/i18n/staff-messages";
import { rentalFitLine } from "@/lib/dive-prep";
import { noDiveDayNeedsSaying } from "@/lib/name-match-evidence";
import { newDiverHref } from "@/lib/person-fields";
import type { FormNotice } from "@/lib/staff-notices";

/** What the add-diver band reads, built once by `TripRosterContent`. */
export type AddDiverContext = {
  shopSlug: string;
  tripId: string;
  full: boolean;
  query: string;
  candidates: BookableDiver[];
  addBookingAction: (formData: FormData) => void;
  addToWaitlistAction: (formData: FormData) => void;
  addExistingDiverAction: (formData: FormData) => void;
  inviteAction?: (formData: FormData) => void;
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
   * The departure's arrivals are open and it has not sailed: the band is one
   * search field, and its door for someone new is "Add as a walk-in" (UX audit
   * 2026-10-07, item 24), with "Add diver" beside it for the seat booked by
   * phone: the arrivals window reaches a day and a half ahead, and a booking
   * for tomorrow is not a walk-in.
   */
  walkInOpen?: boolean;
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
    addBookingAction,
    addToWaitlistAction,
    addExistingDiverAction,
    inviteAction,
    status,
    locale,
    timeZone,
    confirmName,
    confirmEmail,
    confirmPhone,
    confirmMatches,
    shopRentalItems,
    walkInOpen = false,
  } = context;
  const t = staffTranslator(locale);
  const searched = query.length > 0;
  // A candidate with no dive day says so only when a sibling has one; the rule
  // and the bias it corrects are in `noDiveDayNeedsSaying`.
  const sayNoDiveDay = noDiveDayNeedsSaying(confirmMatches ?? []);
  const bookNewDiver = newDiverHref(shopSlug, { query, surface: "trip-guests", tripId });
  const walkInNewDiver = newDiverHref(shopSlug, { query, surface: "walk-in", tripId });
  const bookLabel = t("trips.addDiver.addNewDiverAction", { query });
  const walkInLabel = t("trips.addDiver.addAsWalkIn");
  return (
    <div className={`flex flex-col gap-4 ${className}`.trim()}>
      <FormStatus tone={status?.tone}>{status?.text}</FormStatus>

      {confirmMatches && confirmMatches.length > 0 ? (
        <div className="border border-warning/25 bg-warning/10 rounded-inset p-4 text-left">
          <div className="flex flex-col gap-2">
            <h3 className="font-semibold text-sm">
              {t("divers.page.confirmMatchesTitle", { name: confirmName ?? "" })}
            </h3>
            <ul className="list-disc pl-5 space-y-1 text-sm text-muted">
              {confirmMatches.map((match) => (
                <li key={match.id}>
                  <form action={addExistingDiverAction} className="inline">
                    <input type="hidden" name="tripId" value={tripId} />
                    <input type="hidden" name="personId" value={match.id} />
                    {/* A tap here came off a name match, so the booking is
                        told the name it matched on: the prompt fires on an
                        exact spelling too, and only the comparison says whether
                        the seat is identity-unconfirmed (issue #1556). The
                        "create a new diver anyway" form below carries no such
                        field: it invents nobody's history. */}
                    <input type="hidden" name="fromNameMatch" value="true" />
                    <input type="hidden" name="nameMatchQuery" value={confirmName ?? ""} />
                    <button type="submit" className="underline font-medium text-left">
                      {match.fullName}
                    </button>
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
            <form action={full ? addToWaitlistAction : addBookingAction} className="mt-2">
              <input type="hidden" name="tripId" value={tripId} />
              <input type="hidden" name="fullName" value={confirmName} />
              <input type="hidden" name="email" value={confirmEmail} />
              <input type="hidden" name="phone" value={confirmPhone} />
              <input type="hidden" name="force" value="true" />
              <SubmitButton
                pendingLabel={t("seatDiver.adding")}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {t("divers.page.confirmMatchesSubmit")}
              </SubmitButton>
            </form>
          </div>
        </div>
      ) : null}

      {full ? (
        <>
          <p className="text-sm text-muted">{t("trips.addDiver.fullDescription")}</p>
          {/* A block of its own, so the column does not stretch the button. */}
          <div>
            <Link
              href={newDiverHref(shopSlug, {
                surface: "trip-guests",
                tripId,
                waitlist: true,
              })}
              className={buttonClass({ variant: "primary" })}
            >
              {t("trips.addDiver.addToWaitlist")}
            </Link>
          </div>
        </>
      ) : (
        <>
          <PersonSearchForm
            query={query}
            label={t("trips.addDiver.findLabel")}
            placeholder={t("trips.addDiver.findPlaceholder")}
            // At the counter the band is one field: someone new is offered by
            // the search's own result, never a second door beside it.
            addDiverHref={walkInOpen ? undefined : bookNewDiver}
            addDiverLabel={walkInOpen ? undefined : t("trips.addDiver.addDiver")}
          />

          {searched ? (
            candidates.length > 0 ? (
              <>
                <PersonCandidateList
                  context={{
                    candidates,
                    tripId,
                    seatAction: addExistingDiverAction,
                    inviteAction,
                    personHref: (personId) => `/shop/${shopSlug}/divers/${personId}`,
                    // "Same as last time": the fit already on file carries onto the
                    // trip, so staff confirm rather than re-enter.
                    extraLine: ({ rentalFit }) => (
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
                    ),
                    inviteLabel: t("trips.invitations.directInvite"),
                    invitePendingLabel: t("trips.invitations.directInviting"),
                    invitePersonAriaLabel: (name) =>
                      t("trips.invitations.directInviteAria", { name }),
                    addLabel: t("trips.addDiver.addToTrip"),
                    pendingLabel: t("seatDiver.adding"),
                    addPersonAriaLabel: (name) => t("trips.addDiver.addPersonAriaLabel", { name }),
                    noEmailOnFile: t("trips.addDiver.noEmailOnFile"),
                  }}
                  rowClassName="bg-surface"
                />
                {/* The match list can miss the person at the desk (another Sam);
                  the doors for someone new stay one tap away under it. */}
                {walkInOpen ? (
                  <div className="flex flex-wrap gap-x-4">
                    <Link
                      href={walkInNewDiver}
                      className={buttonClass({ variant: "ghost", size: "sm", flush: true })}
                    >
                      {walkInLabel}
                    </Link>
                    <Link
                      href={bookNewDiver}
                      className={buttonClass({ variant: "ghost", size: "sm", flush: true })}
                    >
                      {bookLabel}
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
                secondary={walkInOpen ? { label: bookLabel, href: bookNewDiver } : undefined}
              />
            )
          ) : null}
        </>
      )}
    </div>
  );
}
