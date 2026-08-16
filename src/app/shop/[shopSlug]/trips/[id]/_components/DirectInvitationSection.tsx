import { PersonCandidateList } from "@/components/seat-diver/PersonCandidateList";
import { PersonSearchForm } from "@/components/seat-diver/PersonSearchForm";
import type { BookableDiver } from "@/db/divers";
import { staffTranslator } from "@/i18n/staff-messages";

/**
 * The direct-invite door for an existing diver. It deliberately reuses the
 * returning-diver picker but sends a different action: invite means outreach,
 * while the Add Diver section means a booking or wait-list entry.
 */
export function DirectInvitationSection({
  shopSlug,
  tripId,
  query,
  candidates,
  inviteAction,
  locale,
}: {
  shopSlug: string;
  tripId: string;
  query: string;
  candidates: BookableDiver[];
  inviteAction: (formData: FormData) => void;
  locale: string;
}) {
  const t = staffTranslator(locale);
  const searched = query.length > 0;
  return (
    <section id="invite-person" className="mt-10 scroll-mt-6">
      <h2 className="text-lg font-semibold">{t("trips.invitations.directHeading")}</h2>
      <p className="mt-1 text-sm text-muted">{t("trips.invitations.directDescription")}</p>
      <PersonSearchForm
        className="mt-4"
        query={query}
        queryName="inviteq"
        label={t("trips.invitations.directFindLabel")}
        placeholder={t("trips.invitations.directFindPlaceholder")}
        submitLabel={t("seatDiver.search")}
        pendingLabel={t("seatDiver.searching")}
      />
      {searched ? (
        candidates.length > 0 ? (
          <PersonCandidateList
            className="mt-4"
            candidates={candidates}
            tripId={tripId}
            seatAction={inviteAction}
            personHref={(personId) => `/shop/${shopSlug}/divers/${personId}`}
            rowClassName="bg-surface shadow-sm"
            addLabel={t("trips.invitations.directInvite")}
            pendingLabel={t("trips.invitations.directInviting")}
            addPersonAriaLabel={(name) => t("trips.invitations.directInviteAria", { name })}
            noEmailOnFile={t("trips.invitations.noEmailOnFile")}
          />
        ) : (
          <p className="mt-4 text-sm text-muted">
            {t("trips.invitations.directNoMatches", { query })}
          </p>
        )
      ) : null}
    </section>
  );
}
