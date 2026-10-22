import { sendHoldCopy } from "@/components/send-hold-copy";
import type { DepartureLeadRow } from "@/db/leads";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import { publicTripPath } from "@/lib/public-routes";
import { RosterGroupBand } from "./RosterGroupBand";
import { WaitlistInvite, type WaitlistInviteCopy } from "./WaitlistInvite";

/**
 * **The "Invited" group of the guests ledger** — ADR
 * 20260827-the-departure-is-two-working-surfaces, slice 5d: staff outreach
 * recorded against this departure files into the one ledger with everyone
 * else, instead of a fourth sibling card. Only rendered when an invitation
 * exists.
 */
export function TripInvitationGroup({
  invitations,
  shopSlug,
  tripId,
  shopName,
  tripTitle,
  tripStartsAt,
  timezone,
  locale,
  canInvite = true,
}: {
  invitations: DepartureLeadRow[];
  shopSlug: string;
  tripId: string;
  shopName: string;
  tripTitle: string;
  tripStartsAt: Date;
  timezone: string;
  locale: string;
  /** False once the departure can take nobody (`acceptsNewDivers`). */
  canInvite?: boolean;
}) {
  const t = staffTranslator(locale);
  const bookingPath = publicTripPath(shopSlug, tripId);
  const inviteCopy: WaitlistInviteCopy = {
    hold: sendHoldCopy(t),
    invitedRelative: t.raw("trips.invitations.invitedRelative"),
    inviteEmailed: t("trips.invitations.inviteEmailed"),
    reSendInvite: t("trips.invitations.reSendInvite"),
    emailAnInvite: t.raw("trips.invitations.emailAnInvite"),
    copied: t("trips.invitations.copied"),
    copyInviteMessage: t("trips.invitations.copyInviteMessage"),
    copyFailed: t("trips.invitations.copyFailed"),
    justNow: t("trips.invitations.justNow"),
    minutesAgo: t.raw("trips.invitations.minutesAgo"),
    hoursAgo: t.raw("trips.invitations.hoursAgo"),
    daysAgo: t.raw("trips.invitations.daysAgo"),
    emailSubject: t.raw("trips.invitations.emailSubject"),
    emailBody: t.raw("trips.invitations.emailBody"),
  };
  const tripWhen = formatShortDate(tripStartsAt, locale, timezone);

  return (
    <>
      <RosterGroupBand
        id="invitations"
        label={`${t("trips.roster.groupInvited")} · ${invitations.length}`}
      >
        {/* The consequence the group has to carry: an invitation reserves
            nothing and manifests nobody. */}
        <p className="text-xs text-muted">{t("trips.invitations.description")}</p>
      </RosterGroupBand>
      <ul className="divide-y divide-border">
        {invitations.map(({ lead, person }) => {
          const name = person?.fullName ?? lead.name ?? t("trips.invitations.anonymous");
          const email = person?.email ?? lead.email ?? null;
          return (
            <li
              key={lead.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 text-sm sm:px-5"
            >
              <div className="min-w-0">
                <p className="font-medium text-base">{name}</p>
                <p className="text-muted wrap-anywhere">
                  {email ?? t("trips.invitations.noEmailOnFile")}
                  {lead.parentLeadId ? ` · ${t("trips.invitations.fromRequest")}` : ""}
                </p>
              </div>
              {canInvite ? (
                <WaitlistInvite
                  leadId={lead.id}
                  personName={name}
                  personEmail={email}
                  invitedAt={lead.offeredAt}
                  bookingPath={bookingPath}
                  shopName={shopName}
                  tripTitle={tripTitle}
                  tripWhen={tripWhen}
                  tripId={tripId}
                  copy={inviteCopy}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}
