import type { DateLeadInReach } from "@/db/lead-dates";
import type { AnytimeRecipient } from "@/db/leads";
import type { CertificationSummary } from "@/db/self-declared-cards";
import type { TripGuests } from "@/db/trips";
import {
  certificationSummaryBelowRequirementText,
  certificationSummaryText,
  certificationSummaryUnchecked,
} from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate } from "@/lib/calendar-date";
import { formatCalendarDateRange, formatShortDate } from "@/lib/format";
import {
  LAST_MINUTE_RECIPIENT_PREVIEW_LIMIT,
  type LastMinuteDepartureBar,
  leadContact,
  ranksBelow,
  reviewLastMinuteRecipients,
} from "@/lib/leads";
import type { Waitlist } from "./types";
import type { WhoWantsInGroup } from "./WhoWantsInPanel";

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

/**
 * **One person, one row.** Offering a seat to a date or anytime lead writes a
 * departure row for it (`parent_lead_id`), so the same ask can be read from two
 * groups. This decides which group draws it:
 *
 * - **Not offered yet**: the ask stays in its own group (a date or anytime row),
 *   and an attached-but-unoffered child stays in "Asked for this departure"
 *   reading "from a request"; the date group leaves that lead out.
 * - **Offered**: the ask stays in its own group and reads "offered", and the
 *   child row leaves "Asked for this departure".
 */
export function whoWantsInSources(input: {
  departureLeads: Waitlist;
  dateLeads: readonly DateLeadInReach[];
  anytimeRecipients: readonly AnytimeRecipient[];
}): {
  departureLeads: Waitlist;
  dateLeads: DateLeadInReach[];
  anytimeRecipients: AnytimeRecipient[];
  /** When the offer on an anytime lead went, by person. */
  offeredAtByPerson: Map<string, Date | null>;
} {
  const offeredChildren = new Set<string>();
  const dateLeads = input.dateLeads.filter((row) => {
    if (!row.departureLeadId) return true;
    if (!row.offeredAt) return false;
    offeredChildren.add(row.departureLeadId);
    return true;
  });
  const byPerson = new Map(
    input.departureLeads.flatMap((row) => (row.lead.personId ? [[row.lead.personId, row]] : [])),
  );
  const offeredAtByPerson = new Map<string, Date | null>();
  const anytimeRecipients = input.anytimeRecipients.filter(({ lead, person }) => {
    const child = byPerson.get(person.id)?.lead;
    if (!child) return true;
    if (!child.offeredAt || child.parentLeadId !== lead.id) return false;
    offeredChildren.add(child.id);
    offeredAtByPerson.set(person.id, child.offeredAt);
    return true;
  });
  return {
    departureLeads: input.departureLeads.filter((row) => !offeredChildren.has(row.lead.id)),
    dateLeads,
    anytimeRecipients,
    offeredAtByPerson,
  };
}

/** How much of a diver's own message the quiet line quotes. */
const MESSAGE_QUOTE_LIMIT = 60;

/**
 * **The "Asked for this date" rows**: open date requests that could make this
 * departure's day (`listDateLeadsInReach`), in the order people asked. A lead
 * already copied to this departure (attached from the schedule builder, or
 * offered a seat) is its child row's business: that row is in the first group,
 * reading "from a request", so it is left out here rather than drawn twice. A
 * request with no person keeps the name and address it was made with and has no
 * card to weigh; one that matched a diver carries their card.
 */
export function dateLeadRows(input: {
  leads: readonly DateLeadInReach[];
  certificationSummaries: Map<string, CertificationSummary>;
  departureRequirement: LastMinuteDepartureBar | null;
  t: StaffTranslator;
  locale: string;
}): WhoWantsInRow[] {
  const { t, locale } = input;
  return input.leads.map((row) => {
    const summary = (row.personId ? input.certificationSummaries.get(row.personId) : null) ?? null;
    const belowBar = ranksBelow({ certification: summary }, input.departureRequirement);
    const dates = [row.preferredDate, row.alternateDate]
      .flatMap((date) => (date ? [formatCalendarDate(date, locale)] : []))
      .join(t("trips.whoWantsIn.dateOr"));
    const parts = [
      row.email ?? t("trips.whoWantsIn.noEmail"),
      dates,
      row.dateFlexible ? t("trips.whoWantsIn.flexible") : null,
      (row.partySize ?? 1) > 1 ? t("trips.whoWantsIn.party", { count: row.partySize ?? 1 }) : null,
      row.courseTitle ?? row.interest,
      row.message
        ? t("trips.whoWantsIn.quote", {
            text:
              row.message.length > MESSAGE_QUOTE_LIMIT
                ? `${row.message.slice(0, MESSAGE_QUOTE_LIMIT).trimEnd()}…`
                : row.message,
          })
        : null,
    ].filter((part): part is string => Boolean(part));
    return {
      leadId: row.id,
      name: row.name ?? t("trips.whoWantsIn.noName"),
      email: row.email,
      facts: parts.join(" · "),
      certification: row.personId
        ? {
            text: belowBar
              ? certificationSummaryBelowRequirementText(t, summary, locale)
              : certificationSummaryText(t, summary, locale),
            unchecked: certificationSummaryUnchecked(summary),
          }
        : null,
      belowBar,
      offeredAt: row.offeredAt,
    };
  });
}

/**
 * **The "Around these dates" rows**: the last-minute list divers whose window
 * covers this day, risky names first (`reviewLastMinuteRecipients`), the first
 * `limit` as `shown` and the rest as `more` behind "Show N more". The list is
 * already the deal's audience (nobody below the bar reaches it), so `belowBar`
 * marks only a self-declared level that still ranks under it. Without a
 * `limit` every row is shown.
 */
export function anytimeLeadRows(input: {
  recipients: readonly AnytimeRecipient[];
  /** People who already have a row on this departure (offered, or waiting). */
  offeredAtByPerson: ReadonlyMap<string, Date | null>;
  departureRequirement: LastMinuteDepartureBar | null;
  limit: number;
  t: StaffTranslator;
  locale: string;
}): { shown: WhoWantsInRow[]; more: WhoWantsInRow[] } {
  const { t, locale } = input;
  const review = reviewLastMinuteRecipients(
    input.recipients,
    input.departureRequirement,
    input.recipients.length,
  );
  const rows = review.shown.map(({ recipient, belowRequirement }): WhoWantsInRow => {
    const { lead, person } = recipient;
    const window =
      lead.availableFrom && lead.availableUntil
        ? formatCalendarDateRange(lead.availableFrom, lead.availableUntil, locale)
        : lead.availableFrom
          ? t("trips.whoWantsIn.windowFrom", {
              date: formatCalendarDate(lead.availableFrom, locale),
            })
          : lead.availableUntil
            ? t("trips.whoWantsIn.windowUntil", {
                date: formatCalendarDate(lead.availableUntil, locale),
              })
            : t("trips.whoWantsIn.anyDay");
    return {
      leadId: lead.id,
      name: person.fullName,
      email: person.email,
      facts: [person.email ?? t("trips.whoWantsIn.noEmail"), window].join(" · "),
      certification: {
        text: belowRequirement
          ? certificationSummaryBelowRequirementText(t, recipient.certification, locale)
          : certificationSummaryText(t, recipient.certification, locale),
        unchecked: certificationSummaryUnchecked(recipient.certification),
      },
      belowBar: belowRequirement,
      offeredAt: input.offeredAtByPerson.get(person.id) ?? null,
    };
  });
  return { shown: rows.slice(0, input.limit), more: rows.slice(input.limit) };
}

/**
 * **The panel's three groups for one departure**, from what `getTripGuests`
 * read: "Asked for this departure", "Asked for this date" and "Around these
 * dates" (the last-minute list, which is empty while the shop has it off).
 * `whoWantsInSources` decides which group draws an ask that is in two.
 */
export function whoWantsInGroupsOf(input: {
  guests: Pick<
    TripGuests,
    "leads" | "dateLeads" | "lastMinute" | "certificationSummaries" | "dealRequirement"
  >;
  t: StaffTranslator;
  locale: string;
  timezone: string;
}): WhoWantsInGroup[] {
  const { guests, t, locale, timezone } = input;
  const { certificationSummaries } = guests;
  const sources = whoWantsInSources({
    departureLeads: guests.leads,
    dateLeads: guests.dateLeads,
    anytimeRecipients: guests.lastMinute.recipients,
  });
  const shared = {
    certificationSummaries,
    departureRequirement: guests.dealRequirement,
    t,
    locale,
  };
  const anytime = anytimeLeadRows({
    recipients: sources.anytimeRecipients,
    offeredAtByPerson: sources.offeredAtByPerson,
    limit: LAST_MINUTE_RECIPIENT_PREVIEW_LIMIT,
    ...shared,
  });
  return [
    {
      id: "departure",
      heading: t("trips.whoWantsIn.groupDeparture"),
      rows: departureLeadRows({ leads: sources.departureLeads, timezone, ...shared }),
    },
    {
      id: "date",
      heading: t("trips.whoWantsIn.groupDate"),
      rows: dateLeadRows({ leads: sources.dateLeads, ...shared }),
    },
    {
      id: "anytime",
      heading: t("trips.whoWantsIn.groupAnytime"),
      rows: anytime.shown,
      more: anytime.more,
    },
  ];
}
