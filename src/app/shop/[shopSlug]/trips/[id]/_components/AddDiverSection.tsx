import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { HandEntryPrompt } from "@/components/seat-diver/HandEntryPrompt";
import { PersonCandidateList } from "@/components/seat-diver/PersonCandidateList";
import { PersonSearchForm } from "@/components/seat-diver/PersonSearchForm";
import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";
import type { BookableDiver } from "@/db/divers";
import { rentalFitLineText } from "@/i18n/rental-labels";
import { staffTranslator } from "@/i18n/staff-messages";
import { rentalFitLine } from "@/lib/dive-prep";
import { newDiverHref } from "@/lib/person-fields";
import type { FormNotice } from "@/lib/staff-notices";

/**
 * Adding a diver leads with the shop's existing people so a returning diver is
 * *picked*, never re-typed — the "enter once, reuse everywhere" path that keeps
 * the roster from spawning a second person row and orphaning the first diver's
 * certs, waivers, and rental fit.
 *
 * Typing a query presents both the matching candidate divers and a one-tap
 * "Add diver" path prefilled with their name or email.
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
  inviteAction,
  status,
  locale,
  confirmName,
  confirmEmail,
  confirmPhone,
  confirmMatches,
}: {
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
  confirmName?: string;
  confirmEmail?: string;
  confirmPhone?: string;
  confirmMatches?: Array<{
    id: string;
    fullName: string;
    email: string | null;
    phone: string | null;
  }>;
}) {
  const t = staffTranslator(locale);
  const searched = query.length > 0;
  return (
    <>
      <FormStatus tone={status?.tone} className="mt-2">
        {status?.text}
      </FormStatus>

      {confirmMatches && confirmMatches.length > 0 ? (
        <div className="border border-warning/25 bg-warning/10 rounded-inset p-4 mt-4 text-left">
          <div className="flex flex-col gap-2">
            <h3 className="font-semibold text-sm">{t("divers.page.confirmMatchesTitle")}</h3>
            <ul className="list-disc pl-5 space-y-1 text-sm text-muted">
              {confirmMatches.map((match) => (
                <li key={match.id}>
                  <form action={addExistingDiverAction} className="inline">
                    <input type="hidden" name="tripId" value={tripId} />
                    <input type="hidden" name="personId" value={match.id} />
                    <button type="submit" className="underline font-medium text-left">
                      {match.fullName}
                    </button>
                  </form>
                  {match.email || match.phone ? (
                    <span className="text-muted text-xs ml-1">
                      ({[match.email, match.phone].filter(Boolean).join(", ")})
                    </span>
                  ) : null}
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
          <p className="mt-1 text-sm text-muted">{t("trips.addDiver.fullDescription")}</p>
          <div className="mt-4">
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
            className="mt-4"
            query={query}
            label={t("trips.addDiver.findLabel")}
            placeholder={t("trips.addDiver.findPlaceholder")}
            addDiverHref={newDiverHref(shopSlug, {
              query,
              surface: "trip-guests",
              tripId,
            })}
            addDiverLabel={t("trips.addDiver.addDiver")}
          />

          {searched ? (
            candidates.length > 0 ? (
              <PersonCandidateList
                className="mt-4"
                candidates={candidates}
                tripId={tripId}
                seatAction={addExistingDiverAction}
                inviteAction={inviteAction}
                personHref={(personId) => `/shop/${shopSlug}/divers/${personId}`}
                rowClassName="bg-surface"
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
                inviteLabel={t("trips.invitations.directInvite")}
                invitePendingLabel={t("trips.invitations.directInviting")}
                invitePersonAriaLabel={(name) => t("trips.invitations.directInviteAria", { name })}
                addLabel={t("trips.addDiver.addToTrip")}
                pendingLabel={t("seatDiver.adding")}
                addPersonAriaLabel={(name) => t("trips.addDiver.addPersonAriaLabel", { name })}
                noEmailOnFile={t("trips.addDiver.noEmailOnFile")}
              />
            ) : (
              <HandEntryPrompt
                className="mt-4"
                heading={t("trips.addDiver.noMatchesHeading")}
                body={t("trips.addDiver.noMatches", { query })}
                actionLabel={t("trips.addDiver.addNewDiverAction", { query })}
                href={newDiverHref(shopSlug, {
                  query,
                  surface: "trip-guests",
                  tripId,
                })}
              />
            )
          ) : null}
        </>
      )}
    </>
  );
}
