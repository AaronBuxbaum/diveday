import type { CertificationSummary } from "@/db/self-declared-cards";
import {
  certificationSummaryBelowRequirementText,
  certificationSummaryText,
  certificationSummaryUnchecked,
} from "@/i18n/readiness-labels";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import { type LastMinuteDepartureBar, ranksBelow } from "@/lib/last-minute-list";
import { publicTripPath } from "@/lib/public-routes";
import { RosterGroupBand } from "./RosterGroupBand";
import type { Waitlist } from "./types";
import { WaitlistInvite, type WaitlistInviteCopy } from "./WaitlistInvite";

/**
 * **The "Waiting for a seat" group of the guests ledger** — ADR
 * 20260827-the-departure-is-two-working-surfaces, slice 5d. The wait list
 * used to be a sibling card below the roster restating the roster's own
 * grammar; everyone a departure is about now files into one ledger, and the
 * people waiting are its third group. Only rendered when someone is actually
 * waiting — an empty wait list is "None" formatted as a section (principle 9).
 *
 * Still a lead list, never a queue: rows keep their asked-on date and are
 * never ranked, filtered, or gated (ADR 20260813-wait-list-is-a-lead-list).
 */
export function WaitlistGroup({
  waitlist,
  shopSlug,
  tripId,
  shopName,
  tripTitle,
  tripWhen,
  inviteAction,
  certificationSummaries,
  departureRequirement,
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
  /**
   * What each waiting diver can dive, by person id
   * (`listCertificationSummaries`). A joiner may name their own level on the
   * public form, and this is where the staffer sees it — marked self-declared —
   * before they pick who to invite onto a gated departure. It informs the
   * choice; it never orders or filters this list.
   */
  certificationSummaries: Map<string, CertificationSummary>;
  /** The same folded departure bar the last-minute deal panel reads. */
  departureRequirement: LastMinuteDepartureBar | null;
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
    <>
      <RosterGroupBand
        id="waitlist"
        label={`${t("trips.roster.groupWaiting")} · ${waitlist.length}`}
      >
        {/* The one sentence that keeps this group honest — nobody here holds
            the seat — carried by the group, not repeated per row. */}
        <p className="text-xs text-muted">{t("trips.waitlist.description")}</p>
      </RosterGroupBand>
      <ul className="divide-y divide-border">
        {waitlist.map(({ entry, person }) => {
          const summary = certificationSummaries.get(person.id) ?? null;
          // The deal panel and this row answer the same question with one
          // predicate. Unlike the capped deal preview, this list keeps its
          // lead order and never filters or gates the invite.
          const belowRequirement = ranksBelow({ certification: summary }, departureRequirement);
          return (
            <li
              key={entry.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 text-sm sm:px-5"
            >
              <div className="min-w-0">
                <p className="font-medium text-base">{person.fullName}</p>
                <p className="text-muted">
                  {person.email ?? t("trips.waitlist.noEmailOnFile")}
                  {" · "}
                  {t("trips.waitlist.joined", {
                    date: formatShortDate(entry.createdAt, locale, timezone),
                  })}
                </p>
                {/* On its own line rather than appended to the contact line:
                    this is the fact that decides whether the invite is a good
                    idea. Warning-toned when any part of it is unverified (ADR
                    20260814-self-declared-cards decision 4). */}
                <p
                  className={
                    certificationSummaryUnchecked(summary) ? "text-warning-strong" : "text-muted"
                  }
                >
                  {belowRequirement
                    ? certificationSummaryBelowRequirementText(t, summary, locale)
                    : certificationSummaryText(t, summary, locale)}
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
          );
        })}
      </ul>
    </>
  );
}
