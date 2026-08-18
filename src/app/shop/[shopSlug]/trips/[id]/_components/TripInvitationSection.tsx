import { sectionCardClass } from "@/components/ui/card";
import type { listTripInvitations } from "@/db/trip-invitations";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import { publicTripPath } from "@/lib/public-routes";
import { WaitlistInvite, type WaitlistInviteCopy } from "./WaitlistInvite";

type TripInvitation = Awaited<ReturnType<typeof listTripInvitations>>[number];

export function TripInvitationSection({
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
    <section id="invitations" className="mt-10 scroll-mt-6">
      <h2 className="text-lg font-semibold">
        {t("trips.invitations.heading")}{" "}
        <span className="font-normal text-muted tabular-nums">{invitations.length}</span>
      </h2>
      <p className="mt-1 text-sm text-muted">{t("trips.invitations.description")}</p>
      <ul
        className={sectionCardClass({
          padding: "none",
          className: "mt-4 divide-y divide-border",
        })}
      >
        {invitations.map(({ invitation, person, request }) => {
          const name = person?.fullName ?? request?.name ?? t("trips.invitations.anonymous");
          const email = person?.email ?? request?.email ?? null;
          return (
            <li
              key={invitation.id}
              className="flex items-start justify-between gap-3 px-4 py-3 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium">{name}</p>
                <p className="text-muted">{email ?? t("trips.invitations.noEmailOnFile")}</p>
                {request ? (
                  <p className="text-muted">{t("trips.invitations.fromRequest")}</p>
                ) : null}
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
    </section>
  );
}
