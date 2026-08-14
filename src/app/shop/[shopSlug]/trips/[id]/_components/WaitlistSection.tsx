import { EmptyState } from "@/components/EmptyState";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import { publicTripPath } from "@/lib/public-routes";
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
  timezone,
}: {
  waitlist: Waitlist;
  shopSlug: string;
  tripId: string;
  shopName: string;
  tripTitle: string;
  tripWhen: string;
  inviteAction: (entryId: string) => Promise<"sent" | "fallback">;
  locale: string;
  timezone: string;
}) {
  const t = staffTranslator(locale);
  const bookingPath = publicTripPath(shopSlug, tripId);
  // Every word `WaitlistInvite` (a Client Component) renders, resolved here on
  // the server — see the note in src/i18n/staff-messages.ts. Its own relative-
  // time and email-draft text is genuinely client-derived (the current instant,
  // `window.location.origin`), so it gets templates plus a local `fill` helper
  // rather than fully composed strings.
  const inviteCopy: WaitlistInviteCopy = {
    invitedRelative: t.raw("trips.waitlist.invitedRelative"),
    inviteEmailed: t("trips.waitlist.inviteEmailed"),
    reSendInvite: t("trips.waitlist.reSendInvite"),
    emailAnInvite: t.raw("trips.waitlist.emailAnInvite"),
    copied: t("trips.waitlist.copied"),
    copyInviteMessage: t("trips.waitlist.copyInviteMessage"),
    copyFailed: t("trips.waitlist.copyFailed"),
    justNow: t("trips.waitlist.justNow"),
    minutesAgo: t.raw("trips.waitlist.minutesAgo"),
    hoursAgo: t.raw("trips.waitlist.hoursAgo"),
    daysAgo: t.raw("trips.waitlist.daysAgo"),
    emailSubject: t.raw("trips.waitlist.emailSubject"),
    emailBody: t.raw("trips.waitlist.emailBody"),
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
        // A plain list, not a numbered one: a rank badge here read as a
        // standing the diver was never promised, and it nudged staff to work
        // the list top-down while the product said nothing of the kind. The
        // date each diver asked is the honest version of the same cue — it
        // still shows who has been waiting longest, without ranking them
        // (ADR 20260813-wait-list-is-a-lead-list).
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
          {waitlist.map(({ entry, person }) => (
            <li key={entry.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{person.fullName}</p>
                <p className="text-muted">
                  {person.email ?? t("trips.waitlist.noEmailOnFile")}
                  {" · "}
                  {t("trips.waitlist.joined", {
                    date: formatShortDate(entry.createdAt, locale, timezone),
                  })}
                </p>
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
        </ul>
      )}
    </section>
  );
}
