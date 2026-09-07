import { readinessBlockerText, readinessStatusText } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { type BlockerFix, blockerFixFor } from "./blockers";
import type { CalendarDate } from "./calendar-date";
import { formatTypedDate, readTypedDate } from "./forgiving-fields";
import { formatShortDate, formatTime } from "./format";
import { cachedListFormat } from "./intl-cache";
import type { ReadinessBlocker, ReadinessStatus } from "./readiness";

/**
 * Ask it, and it answers (ADR 20260906-before-you-ask, decision 3).
 *
 * When a palette query names **one** thing DiveDay can say something about —
 * a diver, a day, a departure — the first row is an answer card: the fact,
 * and the primary act read from the same fix table the home's ledger rows
 * read (`blockerFixFor`). A query that names nothing gets the doors alone.
 * The palette never mutates: every act is a door onto the page whose form
 * does the work, so a waiver send lands on the roster rather than sending.
 *
 * Two halves. `paletteQueryNames` decides *what* the query names from the
 * search results and the query itself (pure); `paletteAnswerView` words the
 * facts a reader gathered (`src/db/palette-answer.ts`) into the card.
 */

export type PaletteNaming =
  | { kind: "diver"; personId: string; fullName: string }
  | { kind: "day"; date: CalendarDate }
  | { kind: "departure"; tripId: string }
  | null;

/**
 * Which one thing a query names, or null. A day is read first, because "sat"
 * is a day before it is the start of a surname; after that, exactly one diver
 * and no departure, or exactly one departure and no diver.
 */
export function paletteQueryNames(input: {
  query: string;
  today: CalendarDate;
  locale: string;
  divers: readonly { id: string; fullName: string }[];
  trips: readonly { id: string }[];
}): PaletteNaming {
  const query = input.query.trim();
  if (query.length < 2) return null;
  const day = readTypedDate(query, input.today, input.locale);
  if (day) return { kind: "day", date: day.canonical };
  const [diver] = input.divers;
  if (diver && input.divers.length === 1 && input.trips.length === 0) {
    return { kind: "diver", personId: diver.id, fullName: diver.fullName };
  }
  const [trip] = input.trips;
  if (trip && input.trips.length === 1 && input.divers.length === 0) {
    return { kind: "departure", tripId: trip.id };
  }
  return null;
}

export type PaletteAnswerFacts =
  | {
      kind: "diver";
      personId: string;
      fullName: string;
      /** The departure this diver is next on, or null. */
      next: {
        bookingId: string;
        tripId: string;
        tripTitle: string;
        startsAt: Date;
        status: ReadinessStatus;
        blockers: readonly ReadinessBlocker[];
      } | null;
    }
  | {
      kind: "day";
      date: CalendarDate;
      departures: number;
      divers: number;
      crew: readonly string[];
    }
  | {
      kind: "departure";
      tripId: string;
      title: string;
      startsAt: Date;
      booked: number;
      capacity: number;
      blocked: number;
    };

export type PaletteAct = { label: string; href: string };

/** The card as the palette renders it: one title, a few lines, one act, one more door. */
export type PaletteAnswerView = {
  kind: PaletteAnswerFacts["kind"];
  title: string;
  lines: string[];
  act: PaletteAct;
  more: PaletteAct | null;
};

export function paletteAnswerView(
  facts: PaletteAnswerFacts,
  ctx: { shopSlug: string; locale: string; timeZone: string; t: StaffTranslator },
): PaletteAnswerView {
  const { shopSlug, locale, timeZone, t } = ctx;
  const root = `/shop/${shopSlug}`;
  switch (facts.kind) {
    case "diver": {
      const record = {
        label: t("shared.commandPalette.answer.openRecord", { name: facts.fullName }),
        href: `${root}/divers/${facts.personId}`,
      };
      if (!facts.next) {
        return {
          kind: "diver",
          title: facts.fullName,
          lines: [t("shared.commandPalette.answer.noDeparture")],
          act: record,
          more: null,
        };
      }
      const fix: BlockerFix | null = blockerFixFor(
        facts.next.blockers,
        {
          shopSlug,
          tripId: facts.next.tripId,
          personId: facts.personId,
          bookingId: facts.next.bookingId,
          fullName: facts.fullName,
        },
        t,
      );
      const primary = facts.next.blockers[0];
      // The palette never sends: a waiver fix lands on the roster row that
      // does, worded as the door it is rather than the verb the row keeps.
      const act: PaletteAct = fix
        ? fix.sendsWaiver
          ? { label: t("shared.commandPalette.answer.openRoster"), href: fix.href }
          : { label: fix.label, href: fix.href }
        : record;
      return {
        kind: "diver",
        title: t("shared.commandPalette.answer.diverOn", {
          name: facts.fullName,
          time: formatTime(facts.next.startsAt, locale, timeZone),
          day: formatShortDate(facts.next.startsAt, locale, timeZone),
          trip: facts.next.tripTitle,
        }),
        lines: [
          primary
            ? `${readinessStatusText(t, facts.next.status)} · ${readinessBlockerText(t, primary)}`
            : readinessStatusText(t, facts.next.status),
        ],
        act,
        more: act.href === record.href ? null : record,
      };
    }
    case "day": {
      const day = formatTypedDate(facts.date, locale);
      const board = `${root}/schedule/board?date=${facts.date}`;
      return {
        kind: "day",
        title: day,
        lines: [
          facts.departures === 0
            ? t("shared.commandPalette.answer.dayNothing")
            : t("shared.commandPalette.answer.dayCounts", {
                departures: facts.departures,
                divers: facts.divers,
              }),
          ...(facts.crew.length > 0
            ? [cachedListFormat(locale, { style: "long", type: "conjunction" }).format(facts.crew)]
            : []),
        ],
        act: { label: t("shared.commandPalette.answer.openDay", { day }), href: board },
        more: {
          label: t("shared.commandPalette.answer.addDeparture"),
          href: `${board}&add=1`,
        },
      };
    }
    case "departure":
      return {
        kind: "departure",
        title: `${formatTime(facts.startsAt, locale, timeZone)} ${facts.title}`,
        lines: [
          `${formatShortDate(facts.startsAt, locale, timeZone)} · ${t(
            "shared.commandPalette.answer.departureSeats",
            { booked: facts.booked, capacity: facts.capacity, blocked: facts.blocked },
          )}`,
        ],
        act: {
          label: t("shared.commandPalette.answer.openRoster"),
          href: `${root}/trips/${facts.tripId}`,
        },
        more: {
          label: t("shared.commandPalette.answer.openManifest"),
          href: `${root}/trips/${facts.tripId}/manifest`,
        },
      };
  }
}
