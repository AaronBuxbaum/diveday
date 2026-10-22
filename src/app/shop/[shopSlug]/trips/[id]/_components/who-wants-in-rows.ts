import type { CertificationSummary } from "@/db/self-declared-cards";
import {
  certificationSummaryBelowRequirementText,
  certificationSummaryText,
  certificationSummaryUnchecked,
} from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import { type LastMinuteDepartureBar, leadContact, ranksBelow } from "@/lib/leads";
import type { Waitlist } from "./types";

/**
 * One row of **Who wants in**, in the words the panel prints. Every group
 * (this departure, this date, around these dates) is turned into this shape by
 * its own builder, so the panel draws one row grammar and a later group is a
 * new builder, not a new component.
 */
export type WhoWantsInRow = {
  leadId: string;
  name: string;
  email: string | null;
  /** The quiet line: address, when they asked, party, where the ask came from. */
  facts: string;
  /** What the diver can dive, when this lead is a known person. */
  certification: { text: string; unchecked: boolean } | null;
  /** Below this departure's bar. Informs the staffer; never filters, orders or disables. */
  belowBar: boolean;
  /** When a seat on this departure was last offered to them. */
  offeredAt: Date | null;
};

/**
 * **The "Asked for this departure" rows**: the departure-scope leads, a diver's
 * own ask and the shop's own invitation alike, in the order people asked. Never
 * ranked or filtered by fit (ADR 20260813-wait-list-is-a-lead-list): the
 * below-the-bar mark is a fact printed on the row, the same predicate the deal
 * list uses.
 */
export function departureLeadRows(input: {
  leads: Waitlist;
  /** What each known person can dive, by person id (`listCertificationSummaries`). */
  certificationSummaries: Map<string, CertificationSummary>;
  /** The folded departure bar. */
  departureRequirement: LastMinuteDepartureBar | null;
  t: StaffTranslator;
  locale: string;
  timezone: string;
}): WhoWantsInRow[] {
  const { t, locale, timezone } = input;
  return input.leads.map((row) => {
    const { lead } = row;
    const contact = leadContact(row);
    const summary =
      (lead.personId ? input.certificationSummaries.get(lead.personId) : null) ?? null;
    const belowBar = ranksBelow({ certification: summary }, input.departureRequirement);
    const parts = [
      contact.email ?? t("trips.whoWantsIn.noEmail"),
      t(lead.askedBy === "shop" ? "trips.whoWantsIn.invited" : "trips.whoWantsIn.asked", {
        date: formatShortDate(lead.askedAt, locale, timezone),
      }),
    ];
    if ((lead.partySize ?? 1) > 1) {
      parts.push(t("trips.whoWantsIn.party", { count: lead.partySize ?? 1 }));
    }
    if (lead.parentLeadId) parts.push(t("trips.whoWantsIn.fromRequest"));
    return {
      leadId: lead.id,
      name: contact.name ?? t("trips.whoWantsIn.noName"),
      email: contact.email,
      facts: parts.join(" · "),
      certification: lead.personId
        ? {
            text: belowBar
              ? certificationSummaryBelowRequirementText(t, summary, locale)
              : certificationSummaryText(t, summary, locale),
            unchecked: certificationSummaryUnchecked(summary),
          }
        : null,
      belowBar,
      offeredAt: lead.offeredAt,
    };
  });
}
