import { EmptyState } from "@/components/EmptyState";
import { sectionCardClass } from "@/components/ui/card";
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
   * choice; it never orders or filters this list, which is a set of leads and
   * not a queue (ADR 20260813-wait-list-is-a-lead-list).
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
    <section id="waitlist" className="mt-10 scroll-mt-24">
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
        <ul
          className={sectionCardClass({
            padding: "none",
            className: "mt-4 divide-y divide-border",
          })}
        >
          {waitlist.map(({ entry, person }) => {
            const summary = certificationSummaries.get(person.id) ?? null;
            // The deal panel and this row answer the same question with one
            // predicate. Unlike the capped deal preview, this list keeps its
            // lead order and never filters or gates the invite.
            const belowRequirement = ranksBelow({ certification: summary }, departureRequirement);
            return (
              <li
                key={entry.id}
                className="flex items-start justify-between gap-3 px-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">{person.fullName}</p>
                  <p className="text-muted">
                    {person.email ?? t("trips.waitlist.noEmailOnFile")}
                    {" · "}
                    {t("trips.waitlist.joined", {
                      date: formatShortDate(entry.createdAt, locale, timezone),
                    })}
                  </p>
                  {/* On its own line rather than appended to the contact line:
                      this is the fact that decides whether the invite is a good
                      idea, and it must not be the thing that scrolls off a
                      phone-width row behind an email address. */}
                  {/* Warning-toned when any part of it is only the diver's word,
                      matching the imported specialty card's "on file, gate still
                      shut" treatment. A muted parenthetical was the only thing
                      separating a claim from a card the shop holds, and it is
                      exactly what truncates on a phone.

                      Under the departure's bar is a *word* on this line and
                      never a second reason to warm the row: the tone answers
                      "has anybody seen this card?" and only that, and the whole
                      argument for it collapses the moment it answers two
                      questions at once (ADR 20260814-self-declared-cards
                      decision 4, docs/design/principles.md #6). So a verified
                      Open Water diver on an Advanced departure stays calm and
                      muted — and says he is under the bar. */}
                  <p
                    className={
                      certificationSummaryUnchecked(summary) ? "text-warning" : "text-muted"
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
      )}
    </section>
  );
}
