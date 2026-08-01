import { EmptyState } from "@/components/EmptyState";
import { staffTranslator } from "@/i18n/staff-messages";
import type { Waitlist } from "./types";
import { WaitlistInvite, type WaitlistInviteCopy } from "./WaitlistInvite";

export function WaitlistSection({
  waitlist,
  shopSlug,
  tripId,
  shopName,
  tripTitle,
  tripWhen,
  inviteAction,
  locale,
}: {
  waitlist: Waitlist;
  shopSlug: string;
  tripId: string;
  shopName: string;
  tripTitle: string;
  tripWhen: string;
  inviteAction: (entryId: string) => Promise<"sent" | "fallback">;
  locale: string;
}) {
  const t = staffTranslator(locale);
  const bookingPath = `/shop/${shopSlug}/schedule/${tripId}`;
  // Every word `WaitlistInvite` (a Client Component) renders, resolved here on
  // the server — see the note in src/i18n/staff-messages.ts. Its own relative-
  // time and email-draft text is genuinely client-derived (the current instant,
  // `window.location.origin`), so it gets templates plus a local `fill` helper
  // rather than fully composed strings.
  const inviteCopy: WaitlistInviteCopy = {
    invitedRelative: t("trips.waitlist.invitedRelative"),
    inviteEmailed: t("trips.waitlist.inviteEmailed"),
    reSendInvite: t("trips.waitlist.reSendInvite"),
    emailAnInvite: t("trips.waitlist.emailAnInvite"),
    copied: t("trips.waitlist.copied"),
    copyInviteMessage: t("trips.waitlist.copyInviteMessage"),
    copyFailed: t("trips.waitlist.copyFailed"),
    justNow: t("trips.waitlist.justNow"),
    minutesAgo: t("trips.waitlist.minutesAgo"),
    hoursAgo: t("trips.waitlist.hoursAgo"),
    daysAgo: t("trips.waitlist.daysAgo"),
    emailSubject: t("trips.waitlist.emailSubject"),
    emailBody: t("trips.waitlist.emailBody"),
  };
  return (
    <section id="waitlist" className="mt-10 scroll-mt-6">
      <h2 className="text-lg font-semibold">
        {t("trips.waitlist.heading")}{" "}
        <span className="font-normal text-muted tabular-nums">{waitlist.length}</span>
      </h2>
      <p className="mt-1 text-sm text-muted">{t("trips.waitlist.description")}</p>
      {waitlist.length === 0 ? (
        <EmptyState className="mt-4">
          <p className="text-sm text-muted">{t("trips.waitlist.empty")}</p>
        </EmptyState>
      ) : (
        <ol className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
          {waitlist.map(({ entry, person }, index) => (
            <li key={entry.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 font-medium text-primary tabular-nums">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="font-medium">{person.fullName}</p>
                  <p className="text-muted">{person.email ?? t("trips.waitlist.noEmailOnFile")}</p>
                </div>
              </div>
              <WaitlistInvite
                entryId={entry.id}
                personName={person.fullName}
                personEmail={person.email}
                invitedAt={entry.invitedAt}
                bookingPath={bookingPath}
                shopName={shopName}
                tripTitle={tripTitle}
                tripWhen={tripWhen}
                invite={inviteAction}
                copy={inviteCopy}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
