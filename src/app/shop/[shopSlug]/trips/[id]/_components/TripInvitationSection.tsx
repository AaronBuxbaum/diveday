import type { listTripInvitations } from "@/db/trip-invitations";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import { publicTripPath } from "@/lib/public-routes";
import { RosterGroupBand } from "./RosterGroupBand";
import { WaitlistInvite, type WaitlistInviteCopy } from "./WaitlistInvite";

type TripInvitation = Awaited<ReturnType<typeof listTripInvitations>>[number];

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
  inviteAction,
  locale,
}: {
  invitations: TripInvitation[];
  shopSlug: string;
  tripId: string;
  shopName: string;
  tripTitle: string;
  tripStartsAt: Date;
  timezone: string;
  inviteAction: (invitationId: string) => Promise<"sent" | "fallback">;
  locale: string;
}) {
  const t = staffTranslator(locale);
  const bookingPath = publicTripPath(shopSlug, tripId);
  const inviteCopy: WaitlistInviteCopy = {
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
        {invitations.map(({ invitation, person, request }) => {
          const name = person?.fullName ?? request?.name ?? t("trips.invitations.anonymous");
          const email = person?.email ?? request?.email ?? null;
          return (
            <li
              key={invitation.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 text-sm sm:px-5"
            >
              <div className="min-w-0">
                <p className="font-medium text-base">{name}</p>
                <p className="text-muted">
                  {email ?? t("trips.invitations.noEmailOnFile")}
                  {request ? ` · ${t("trips.invitations.fromRequest")}` : ""}
                </p>
              </div>
              <WaitlistInvite
                entryId={invitation.id}
                personName={name}
                personEmail={email}
                invitedAt={invitation.invitedAt}
                bookingPath={bookingPath}
                shopName={shopName}
                tripTitle={tripTitle}
                tripWhen={tripWhen}
                invite={inviteAction}
                copy={inviteCopy}
              />
            </li>
          );
        })}
      </ul>
    </>
  );
}
