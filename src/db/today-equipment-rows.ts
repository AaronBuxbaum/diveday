import { boatSafetyNoticeText } from "@/i18n/boat-safety-labels";
import { gearServiceKindLabel } from "@/i18n/gear-labels";
import {
  gearDueBackDetailText,
  gearDueBackSubjectText,
  gearNeverPickedUpDetailText,
  gearOverdueDetailText,
  gearOverdueGroupText,
  gearServiceDueDetailText,
  openBoatCheckActionText,
  openBoatsActionText,
  openDiverActionText,
  openGearUnitActionText,
  openRentalsActionText,
  openStaffingActionText,
  openWorkOrderActionText,
  rentalFitConfirmDetailText,
  staffCredentialDueDetailText,
  workOrderLateDetailText,
  workOrderUncollectedDetailText,
} from "@/i18n/today-labels";
import {
  calendarDateToUtcMidnight,
  formatCalendarDate,
  isCalendarDateExpired,
  isValidCalendarDate,
} from "@/lib/calendar-date";
import { HOUR_MS } from "@/lib/clock";
import { cachedListFormat } from "@/lib/intl-cache";
import { type TodayAction, urgencyFor } from "@/lib/today";
import { wallTimeToUtc } from "@/lib/zoned";
import type { TodayRowsContext } from "./today-rows-context";
import { at } from "./today-shared";

/**
 * The rows about the shop's kit and crew paperwork: gear that never came home or is due back, service clocks, boat safety, work orders, rental fits to confirm, and staff credentials about to lapse.
 */
export function pushEquipmentRows(actions: TodayAction[], ctx: TodayRowsContext): void {
  const { todayTrips, todayLocal, shopSlug, timeZone, locale, t, now } = ctx;
  const {
    credentialRows,
    overdueGear,
    dueBackGear,
    gearServiceDueRows,
    fitAdjustedReturns,
    boatSafety,
    workOrdersNeedingAttention,
  } = ctx.wave;
  // The gear register's chase list (ADR 20260815-minimal-gear-register): what
  // never came home, what is due back before tonight, and which bench clock
  // runs out this week. Mirrored here, not owned here — the register readers
  // are the owning surface's own, so the queue and the register can never
  // disagree — and self-gating: a shop with no fleet produces no rows.
  // A calendar date's instant on the shop's own clock — midnight opening the
  // day (a service deadline), or midnight closing it (a return due by tonight).
  const localMidnight = (day: string, plusDays = 0) => {
    const [year, month, dayOfMonth] = day.split("-").map(Number);
    return wallTimeToUtc(
      { year: year ?? 0, month: month ?? 1, day: (dayOfMonth ?? 1) + plusDays, hour: 0, minute: 0 },
      timeZone,
    );
  };
  // Several people share one count leading to Rentals; for one person the
  // detail still names each unit and distinguishes the two kinds of chase.
  const overduePeople = groupByPerson(overdueGear);
  if (overduePeople.length > 1 && overdueGear[0]) {
    const words = gearOverdueGroupText(t, overdueGear.length, overduePeople.length);
    actions.push({
      id: "gear-overdue",
      kind: "gear_overdue",
      urgency: "now",
      subject: words.subject,
      context: null,
      detail: words.detail,
      actionLabel: openRentalsActionText(t),
      href: `/shop/${shopSlug}/gear?view=rentals`,
      dueAt: localMidnight(overdueGear[0].reservedUntil, 1),
    });
  }
  for (const rows of overduePeople.length === 1 ? overduePeople : []) {
    const first = rows[0];
    if (!first) continue;
    // Two different chases wearing one kind: a checked-out unit is out with a
    // diver (a phone call), a never-collected one hangs on the wall and wants
    // its stale claim released — saying "out with" about the second would
    // teach staff to skim the rows that matter. Each day and each chase keeps
    // its own sentence, so no date is averaged into one it never had.
    const sentences = new Map<string, { out: boolean; dueOn: string; unitLabels: string[] }>();
    for (const row of rows) {
      const out = row.checkedOutAt !== null;
      const key = `${out}:${row.reservedUntil}`;
      const sentence = sentences.get(key) ?? { out, dueOn: row.reservedUntil, unitLabels: [] };
      sentence.unitLabels.push(row.label);
      sentences.set(key, sentence);
    }
    actions.push({
      id: `gear-overdue:${first.personId}`,
      kind: "gear_overdue",
      // Forced: the window already closed, so there is no future instant to
      // derive urgency from — this is today's work however old the date is.
      urgency: "now",
      subject: first.personName,
      context: tripTitlesContext(rows, locale),
      detail: [...sentences.values()]
        .map(({ out, dueOn, unitLabels }) =>
          (out ? gearOverdueDetailText : gearNeverPickedUpDetailText)(t, locale, {
            unitLabels,
            dueOn: formatCalendarDate(dueOn, locale),
          }),
        )
        .join(" "),
      actionLabel: openRentalsActionText(t),
      href: `/shop/${shopSlug}/gear?view=rentals`,
      // The earliest closed window's end, in the past — the longest-out diver
      // leads. The reader orders by `reservedUntil`, so the first row is it.
      dueAt: localMidnight(first.reservedUntil, 1),
    });
  }
  // **One row for every return due today** (Aaron, 2026-10-09): a return is
  // not a chase, so the people bringing gear back share a line, and the unit
  // tags stay on the Rentals list the row opens. Overdue gear keeps a row per
  // person above when there is only one person to chase.
  const dueBackPeople = groupByPerson(dueBackGear).flatMap((rows) => rows.slice(0, 1));
  const [firstDueBack] = dueBackPeople;
  if (firstDueBack) {
    // Due by the end of the shop's own day: "now" all day, sharpening to
    // "imminent" as the evening runs out.
    const dueAt = localMidnight(firstDueBack.reservedUntil, 1);
    actions.push({
      id: "gear-due-back",
      kind: "gear_due_back",
      urgency: urgencyFor(dueAt, now),
      subject: gearDueBackSubjectText(
        t,
        locale,
        dueBackPeople.map((row) => row.personName),
      ),
      context: null,
      detail: gearDueBackDetailText(t),
      actionLabel: openRentalsActionText(t),
      href: `/shop/${shopSlug}/gear?view=rentals`,
      dueAt,
    });
  }
  for (const row of gearServiceDueRows) {
    if (row.state.state !== "overdue" && row.state.state !== "due_soon") continue;
    const dueAt = localMidnight(row.state.nextDueOn);
    actions.push({
      id: `gear-service:${row.gearItemId}`,
      kind: "gear_service_due",
      // An expired clock has no future instant to derive urgency from; it is
      // counter work today, never "imminent" — that band means boats and people.
      urgency: row.state.state === "overdue" ? "now" : urgencyFor(dueAt, now),
      subject: row.label,
      context: null,
      detail: gearServiceDueDetailText(t, {
        clockLabel: gearServiceKindLabel(t, row.state.kind),
        overdue: row.state.state === "overdue",
        dueOn: formatCalendarDate(row.state.nextDueOn, locale),
      }),
      actionLabel: openGearUnitActionText(t),
      href: `/shop/${shopSlug}/gear/${row.gearItemId}`,
      dueAt,
    });
  }
  // **The boat and its emergency kit** (roadmap N-08, N-10; dive-domain review
  // 2026-10-09). Two kinds of row from one read:
  //
  // - On each departure sailing today, the life-safety kit: no O2 kit or AED
  //   aboard, or oxygen, AED or flares run out or about to. Danger, every
  //   role, under that departure's header and pointing at its Boat tab — the
  //   crew loading the boat are who can fix it before it leaves. It gates
  //   nothing: roll call and boarding go on.
  // - The owner's errands: a paper inside its window (escalating once it
  //   lapses), and kit that ran out ashore or on a boat not sailing today.
  //
  // The sentences are the pre-departure check's own, so the owner, the crew
  // and the manifest read the same words. Self-gating like the register.
  const todayTripsById = new Map(todayTrips.map((trip) => [trip.id, trip]));
  for (const row of boatSafety.departures) {
    const trip = todayTripsById.get(row.tripId);
    if (!trip) continue;
    const when = at(trip.startsAt, timeZone, locale);
    actions.push({
      id: `boat-safety-kit:${row.tripId}`,
      kind: "boat_safety_kit",
      urgency: urgencyFor(trip.startsAt, now),
      subject: row.boatName,
      context: when,
      departure: { tripId: trip.id, label: `${trip.title} · ${when}` },
      detail: row.notices.map((notice) => boatSafetyNoticeText(t, locale, notice)).join(" · "),
      actionLabel: openBoatCheckActionText(t),
      href: `/shop/${shopSlug}/trips/${trip.id}/manifest`,
      dueAt: trip.startsAt,
    });
  }
  for (const row of boatSafety.errands) {
    const detail = row.notices.map((notice) => boatSafetyNoticeText(t, locale, notice)).join(" · ");
    actions.push(
      row.subject === "boat"
        ? {
            id: `boat-safety:boat:${row.boatId}`,
            // A lapsed paper is danger ink (H-136): loud, and still nothing
            // refuses a departure for it.
            kind: row.expired ? "boat_papers_lapsed" : "boat_papers_due",
            urgency: row.expired ? "now" : "later",
            subject: row.name,
            context: null,
            detail,
            actionLabel: openBoatsActionText(t),
            href: `/shop/${shopSlug}/boats`,
            dueAt: null,
          }
        : {
            id: `boat-safety:kit:${row.gearItemId}`,
            kind: "boat_safety_expired",
            urgency: "now",
            subject: row.label,
            context: null,
            detail,
            actionLabel: openGearUnitActionText(t),
            href: `/shop/${shopSlug}/gear/${row.gearItemId}`,
            dueAt: null,
          },
    );
  }
  // The bench (ADR 20261008-work-order-follow-up): a ticket still being
  // worked after the day the shop promised it, and one ready for a week that
  // nobody has collected. A different question from the register's service
  // clocks above — those are the shop's own units coming due, these are
  // promises made at the counter — so a unit on the bench can carry both.
  for (const row of workOrdersNeedingAttention) {
    const late = row.reason === "past_promise";
    actions.push({
      id: `work-order-${late ? "late" : "uncollected"}:${row.workOrderId}`,
      kind: late ? "work_order_late" : "work_order_uncollected",
      // Both dates are already behind the shop: today's counter work, never
      // "imminent" — that band means boats and people.
      urgency: late ? "now" : "later",
      subject: row.subject,
      context: null,
      detail: late
        ? workOrderLateDetailText(t, { promisedOn: formatCalendarDate(row.since, locale) })
        : workOrderUncollectedDetailText(t, { readyOn: formatCalendarDate(row.since, locale) }),
      actionLabel: openWorkOrderActionText(t),
      href:
        row.benchClosed && row.fleetUnitId
          ? `/shop/${shopSlug}/gear/${row.fleetUnitId}`
          : `/shop/${shopSlug}/gear/work-orders/${row.workOrderId}`,
      dueAt: localMidnight(row.since, late ? 1 : 0),
    });
  }
  // **What the day taught the shop about a diver's size** (issue #1174, D14).
  // A question, not a problem: the desk already confirmed the swap at the
  // counter, and this asks once whether to keep it. `href` is the diver's own
  // record, where the same edit can be made by hand.
  for (const row of fitAdjustedReturns) {
    actions.push({
      id: `rental-fit:${row.reservationId}`,
      kind: "rental_fit_confirm",
      urgency: "later",
      subject: row.personName,
      context: row.tripTitle,
      detail: rentalFitConfirmDetailText(t, {
        personName: row.personName,
        unitLabel: row.unitLabel,
        size: row.size,
      }),
      actionLabel: openDiverActionText(t),
      href: `/shop/${shopSlug}/divers/${row.personId}`,
      rentalFit: { reservationId: row.reservationId },
      dueAt: row.tripEndsAt,
    });
  }

  const credentialHorizon = now.getTime() + 30 * 24 * HOUR_MS;
  // One row per staffer, the same reasoning as the gear rows above: a
  // divemaster whose first aid and insurance both lapse this month is one
  // conversation, and each credential keeps its own sentence and date.
  const credentialsByPerson = new Map<
    string,
    { name: string; dueAt: Date; overdue: boolean; sentences: string[] }
  >();
  for (const row of credentialRows) {
    const renewsAt = row.credential.renewsAt;
    if (!renewsAt || !isValidCalendarDate(renewsAt)) continue;
    const dueAt = calendarDateToUtcMidnight(renewsAt);
    if (dueAt.getTime() > credentialHorizon) continue;
    // A renewal date is a calendar date, not an instant. Comparing its UTC
    // midnight against `now` marked a credential overdue for the whole of the
    // day it actually renews in every shop west of Greenwich -- in Cancun, from
    // 19:00 the evening before. CR-009: a date-only expiry is good through the
    // end of its own local day.
    const overdue = isCalendarDateExpired(renewsAt, todayLocal);
    const sentence = staffCredentialDueDetailText(t, {
      credential: row.credential.name,
      dueOn: formatCalendarDate(renewsAt, locale),
      overdue,
    });
    const entry = credentialsByPerson.get(row.person.id);
    if (!entry) {
      credentialsByPerson.set(row.person.id, {
        name: row.person.fullName,
        dueAt,
        overdue,
        sentences: [sentence],
      });
      continue;
    }
    entry.sentences.push(sentence);
    entry.overdue ||= overdue;
    if (dueAt < entry.dueAt) entry.dueAt = dueAt;
  }
  for (const [personId, entry] of credentialsByPerson) {
    actions.push({
      id: `staff-credential:${personId}`,
      kind: "staff_credential_due",
      staffPersonId: personId,
      urgency: entry.overdue ? "now" : urgencyFor(entry.dueAt, now),
      subject: entry.name,
      context: null,
      detail: entry.sentences.join(" "),
      actionLabel: openStaffingActionText(t),
      href: `/shop/${shopSlug}/settings/team#credentials`,
      dueAt: entry.dueAt,
    });
  }
}

/** Rows grouped by diver, each group in the reader's own order. */
function groupByPerson<T extends { personId: string }>(rows: readonly T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(row.personId);
    if (group) group.push(row);
    else groups.set(row.personId, [row]);
  }
  return [...groups.values()];
}

/** The departures a diver's units went out on, each named once. */
function tripTitlesContext(
  rows: readonly { tripTitle: string | null }[],
  locale: string,
): string | null {
  const titles = [...new Set(rows.flatMap((row) => (row.tripTitle ? [row.tripTitle] : [])))];
  return titles.length > 0
    ? cachedListFormat(locale, { type: "conjunction" }).format(titles)
    : null;
}
