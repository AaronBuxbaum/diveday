import {
  type CalendarDate,
  calendarDateInTimezone,
  isCalendarDateExpired,
  isValidCalendarDate,
} from "./calendar-date";
import type { CrewCredentialSnapshot } from "./crew-credential-snapshot";
import {
  isCredentialedRole,
  lastDayOfDeparture,
  rolesMissingCredential,
  type TripCrewRole,
} from "./crew-roles";
import { rollCallCheckpoints } from "./roll-call";
import {
  inAfterDivePopulation,
  isAccountedForAfterDive,
  type RollCallState,
} from "./roll-call-population";

/**
 * **The month's safety, read from what the shop already records** (the
 * Reports Safety tab, ADR 20261012-incident-reports). Framework-free: the
 * loader in `src/db/safety-report.ts` hands this the rows and this decides
 * nothing it could not decide on paper.
 *
 * It reports, never judges a person and never gates anything. Every figure is
 * a count of recorded facts over the departures that came home in the period.
 */

/** How one departure's head count ended. */
export type RollCallClosure = "closed" | "open" | "none";

export type SafetyDepartureInput = {
  tripId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  plannedDives: number;
  /** Only a boat sails: a shore or pool day is never "sailed with no crew" (review F1). */
  diveMode: "boat" | "shore" | "pool";
  /** Every booking not cancelled: the manifest's own roster. */
  bookingIds: readonly string[];
  /**
   * The crew list, each with the job they were rostered to on this departure
   * (null for "not specified") and the standing roles they hold in the shop.
   */
  crew: readonly SafetyCrewMember[];
};

export type SafetyCrewMember = {
  personId: string;
  tripRole: TripCrewRole | null;
  shopRoles: readonly string[];
};

export type SafetyRollCallEvent = {
  tripId: string;
  /** A booking for a diver's event, a person for a crew member's. */
  subjectId: string;
  checkpoint: string;
  status: "boarded" | "not_boarded" | "cleared";
  credentialSnapshot?: CrewCredentialSnapshot[] | null;
  credentialSnapshotStartedAt?: Date | null;
  credentialSnapshotCapturedAt?: Date | null;
};

export type SafetyCredential = {
  personId: string;
  kind: string;
  /**
   * When it was issued; absent or null says nothing. A credential issued
   * after a sailing never answers for it (dive-domain review F3), so a
   * renewal added as a new record leaves an earlier lapsed sailing lapsed.
   */
  issuedAt?: CalendarDate | null;
  renewsAt: string | null;
  credentialId?: string;
  recordedAt?: Date;
  event?: "created" | "baseline" | "renewed" | "corrected" | "deleted";
  historyUnavailable?: boolean;
};

export type SafetyMonthInput = {
  timeZone: string;
  departures: readonly SafetyDepartureInput[];
  /** Every roll-call event on those departures, divers and crew, oldest first. */
  diverEvents: readonly SafetyRollCallEvent[];
  crewEvents: readonly SafetyRollCallEvent[];
  /** Live credentials of everybody on those crews. */
  credentials: readonly SafetyCredential[];
  /** Credential history that cannot be proven at departure. */
  unavailableCredentialPeople?: ReadonlySet<string>;
  personNames: ReadonlyMap<string, string>;
  /** Card checks written past (`participant_type_changed`, `certCheck` overridden). */
  certOverrides: number;
};

export type SafetyMonth = {
  departuresBack: number;
  rollCallsClosed: number;
  /** Departures whose head count never closed, or was never taken. */
  openRollCalls: { tripId: string; title: string; startsAt: Date; closure: RollCallClosure }[];
  /**
   * Seats boarded at the dock, every participant type: the rail records nobody
   * as boarded while readiness blocks them, but readiness that changed after
   * boarding is not read here (dive-domain review F4).
   */
  boardedAtDock: number;
  /** Seats with no dock mark at all — never boarded, never marked ashore. */
  unmarkedAtDock: number;
  certOverrides: number;
  /** One crew member on one departure. */
  crewSailings: number;
  /** Live boarding observations with a credential lapsed on the departure's local sailing day. */
  lapsedSailings: {
    tripId: string;
    title: string;
    startsAt: Date;
    personId: string;
    name: string;
    kinds: string[];
    observationStartedAt?: Date;
    observationCapturedAt?: Date;
  }[];
  /** Live observations with no credentials on file. A role is not captured, so
   * the report cannot determine whether the cards answered the job at the mark.
   * Nonhistorical callers can still compare a supplied role to supplied cards.
   */
  unrecordedSailings: number;
  /** The people behind `unrecordedSailings`, once each, in the order they first sailed. */
  unrecordedCrew: { personId: string; name: string; sailings: number }[];
  /**
   * Sailings the lapsed check judged: `crewSailings` less those with nothing
   * on file at all. The lapsed count's denominator, so a skipped sailing never
   * reads as clean.
   */
  checkedSailings: number;
  /** Sailings whose credential history cannot be reconstructed. */
  unknownCredentialSailings: number;
  /**
   * **Departures that sailed with no crew on record** (fourth review, item
   * 13): nobody on the crew list, or every one of them recorded ashore at the
   * dock. Such a departure adds nothing to `crewSailings`, so the lapsed count
   * above read "0 of 0" for a month of boats nobody was recorded driving: the
   * emptiest record reading cleanest. Listed, in the order they sailed, so the
   * owner can open each one.
   *
   * Boats only (review F1): "sailed" is a boat's word, and a shore day or a
   * pool session with nobody on its crew list is not this finding.
   */
  noCrewDepartures: { tripId: string; title: string; startsAt: Date }[];
  /**
   * **No crew recorded on any departure that came back this month** (review
   * F1): no departure has a single crew row. The crew schedule is off for a
   * new shop and the crew list optional, so a shop that never rosters crew was
   * never asked; the report says so in one quiet line and `noCrewDepartures`
   * is left empty rather than listing every boat it ran. A month whose
   * rostered crew were all recorded ashore did record crew, so its boats are
   * listed (review N7).
   */
  noCrewOnRecord: boolean;
  /**
   * Boat departures back: the no-crew figure's denominator, since that figure
   * counts boats only (dive-domain review N5). On the year, only the boats of
   * months that had crew on record, the months the figure judged (chain-r5
   * review F1).
   */
  boatsBack: number;
};

/**
 * **The Safety year**: the year's figures as the sum of its months, each read
 * by its own rules (dive-domain review F1). A month with no crew rostered
 * anywhere is one quiet line in its own view and adds no boats to the year's
 * no-crew figure here, so the year never prints hundreds of "unmanned" boats
 * from the months before a shop rostered crew.
 */
export type SafetyYear = SafetyMonth & {
  /** Months with at least one departure back. */
  monthsBack: number;
  /** …of which had no crew recorded on any departure. */
  monthsWithoutCrew: number;
};

/** The newest standing result per subject and checkpoint; a `cleared` undo leaves none. */
function standing(events: readonly SafetyRollCallEvent[]) {
  const results = new Map<string, "boarded" | "not_boarded">();
  for (const event of events) {
    const key = `${event.tripId}\0${event.subjectId}\0${event.checkpoint}`;
    if (event.status === "cleared") results.delete(key);
    else results.set(key, event.status);
  }
  return (tripId: string, subjectId: string, checkpoint: string) =>
    results.get(`${tripId}\0${subjectId}\0${checkpoint}`);
}

/**
 * Whether a departure's head count closed, by the rules the manifest and the
 * Today queue use (glossary, "Unaccounted for"):
 *
 * - **the dock count** closes when every seat on the roster has a result at
 *   departure, boarded or not;
 * - **each after-dive count** closes when everybody in the after-dive count —
 *   divers and crew by one rule, `inAfterDivePopulation`: boarded at the dock,
 *   or given any result at a later checkpoint — is recorded back aboard.
 *   Nothing but "boarded" closes it, and an undone mark is no mark.
 *
 * A departure with no roll-call event of either kind is `none`, never closed.
 */
export function rollCallClosure(
  departure: SafetyDepartureInput,
  diverResult: (subjectId: string, checkpoint: string) => RollCallState,
  crewResult: (subjectId: string, checkpoint: string) => RollCallState,
  hasAnyEvent: boolean,
): RollCallClosure {
  if (!hasAnyEvent) return "none";
  const checkpoints = rollCallCheckpoints(departure.plannedDives);
  const [dock, ...afterDives] = checkpoints;
  if (!dock) return "open";
  for (const bookingId of departure.bookingIds) {
    if (diverResult(bookingId, dock) === undefined) return "open";
  }
  const counted = (ids: readonly string[], result: typeof diverResult) =>
    ids
      .map((id) => checkpoints.map((checkpoint) => result(id, checkpoint)))
      .filter((states) => inAfterDivePopulation(states));
  const everyone = [
    ...counted(departure.bookingIds, diverResult),
    ...counted(
      departure.crew.map((member) => member.personId),
      crewResult,
    ),
  ];
  for (let dive = 1; dive <= afterDives.length; dive++) {
    if (everyone.some((states) => !isAccountedForAfterDive(states[dive]))) return "open";
  }
  return "closed";
}

/**
 * The credential kinds a person had lapsed on `divesOn`: every record of the
 * kind carries a real renewal date before that day. One current record of a
 * kind is enough, and a record with no date says nothing — the same reading
 * `lapsedRungs` makes for the supervision ratio (src/lib/crew-roles.ts).
 */
export function lapsedCredentialKinds(
  credentials: readonly SafetyCredential[],
  divesOn: CalendarDate,
): string[] {
  const byKind = new Map<string, SafetyCredential[]>();
  for (const credential of credentials) {
    const list = byKind.get(credential.kind) ?? [];
    list.push(credential);
    byKind.set(credential.kind, list);
  }
  return [...byKind.entries()]
    .filter(([, records]) =>
      records.every(
        ({ renewsAt }) =>
          renewsAt !== null &&
          isValidCalendarDate(renewsAt) &&
          isCalendarDateExpired(renewsAt, divesOn),
      ),
    )
    .map(([kind]) => kind)
    .sort();
}

/**
 * Whether a crew member's recorded credentials answer the job they sailed as
 * (issue #2548). The job is the per-trip role when the roster names one, else
 * the standing roles they hold in the shop; a person with several standing
 * roles and no named job is answered when any one of them is. A job no
 * credential can answer (a deckhand, an owner aboard) is answered by anything
 * at all, so an empty file still reads as unrecorded and nothing else does.
 */
function answersTheirJob(
  tripRole: TripCrewRole | null,
  shopRoles: readonly string[],
  onFile: readonly SafetyCredential[],
): boolean {
  const jobs = (tripRole ? [tripRole] : shopRoles).filter(isCredentialedRole);
  if (jobs.length === 0) return onFile.length > 0;
  const missing = rolesMissingCredential(
    jobs,
    onFile.map((credential) => credential.kind),
  );
  return missing.length < jobs.length;
}

export function summarizeSafetyMonth(input: SafetyMonthInput): SafetyMonth {
  const diverResult = standing(input.diverEvents);
  const crewResult = standing(input.crewEvents);
  const crewObservations = new Map<string, SafetyRollCallEvent>();
  for (const event of input.crewEvents) {
    if (event.checkpoint !== "departure") continue;
    const key = `${event.tripId}\0${event.subjectId}`;
    if (event.status === "cleared") crewObservations.delete(key);
    else crewObservations.set(key, event);
  }
  const tripsWithEvents = new Set([
    ...input.diverEvents.map((event) => event.tripId),
    ...input.crewEvents.map((event) => event.tripId),
  ]);
  const credentialsByPerson = new Map<string, SafetyCredential[]>();
  for (const credential of input.credentials) {
    const list = credentialsByPerson.get(credential.personId) ?? [];
    list.push(credential);
    credentialsByPerson.set(credential.personId, list);
  }

  let rollCallsClosed = 0;
  let boardedAtDock = 0;
  let unmarkedAtDock = 0;
  let crewSailings = 0;
  const openRollCalls: SafetyMonth["openRollCalls"] = [];
  const lapsedSailings: SafetyMonth["lapsedSailings"] = [];
  const unrecorded = new Map<string, SafetyMonth["unrecordedCrew"][number]>();
  const noCrewDepartures: SafetyMonth["noCrewDepartures"] = [];
  let unrecordedSailings = 0;
  let nothingOnFileSailings = 0;
  let unknownCredentialSailings = 0;

  // An occurrence nobody booked and nobody counted is a date on the board,
  // not a departure that sailed — the same skip the Today queue makes.
  const departures = input.departures.filter(
    (departure) => departure.bookingIds.length > 0 || tripsWithEvents.has(departure.tripId),
  );
  for (const departure of departures) {
    const dock = rollCallCheckpoints(departure.plannedDives)[0] ?? "departure";
    const closure = rollCallClosure(
      departure,
      (id, checkpoint) => diverResult(departure.tripId, id, checkpoint),
      (id, checkpoint) => crewResult(departure.tripId, id, checkpoint),
      tripsWithEvents.has(departure.tripId),
    );
    if (closure === "closed") rollCallsClosed += 1;
    else {
      openRollCalls.push({
        tripId: departure.tripId,
        title: departure.title,
        startsAt: departure.startsAt,
        closure,
      });
    }
    for (const bookingId of departure.bookingIds) {
      const result = diverResult(departure.tripId, bookingId, dock);
      if (result === "boarded") boardedAtDock += 1;
      else if (result === undefined) unmarkedAtDock += 1;
    }

    const divesOn = lastDayOfDeparture(departure.endsAt, input.timeZone);
    const crewSailingsBefore = crewSailings;
    for (const { personId, tripRole, shopRoles } of departure.crew) {
      // A crew member recorded ashore at the dock did not sail.
      if (crewResult(departure.tripId, personId, dock) === "not_boarded") continue;
      crewSailings += 1;
      // A live mark observes a committed state that may differ from actual sailing.
      const recorded = credentialsByPerson.get(personId) ?? [];
      const observation = crewObservations.get(`${departure.tripId}\0${personId}`);
      const started = observation?.credentialSnapshotStartedAt;
      const completed = observation?.credentialSnapshotCapturedAt;
      const snapshot = observation?.status === "boarded" ? observation.credentialSnapshot : null;
      const validSnapshot =
        Array.isArray(snapshot) &&
        snapshot.every(
          (card) =>
            card &&
            typeof card.kind === "string" &&
            (card.issuedAt === null ||
              (typeof card.issuedAt === "string" && isValidCalendarDate(card.issuedAt))) &&
            (card.renewsAt === null ||
              (typeof card.renewsAt === "string" && isValidCalendarDate(card.renewsAt))),
        );
      const observationDay =
        started &&
        completed &&
        started <= completed &&
        calendarDateInTimezone(started, input.timeZone) ===
          calendarDateInTimezone(completed, input.timeZone)
          ? calendarDateInTimezone(started, input.timeZone)
          : null;
      const sailingDay = calendarDateInTimezone(departure.startsAt, input.timeZone);
      let onFile: readonly SafetyCredential[];
      let checkedDay = sailingDay;
      // A board mark only establishes this sailing's date-level credential state
      // when its complete observation interval falls on the scheduled local
      // sailing day. An adjacent-day mark cannot stand in for the card at sail.
      const hasObservedState = validSnapshot && observationDay === sailingDay && snapshot;
      if (hasObservedState) {
        checkedDay = observationDay;
        // A future-issued legacy card may have replaced an older one, so it
        // cannot establish either the prior lapse or an empty file.
        if (snapshot.some((card) => card.issuedAt && card.issuedAt > checkedDay)) {
          unknownCredentialSailings += 1;
          continue;
        }
        onFile = snapshot.map((card) => ({ ...card, personId }));
      } else {
        // A transaction timestamp cannot prove what was committed at sailing.
        if (
          input.unavailableCredentialPeople?.has(personId) ||
          recorded.some((card) => card.credentialId)
        ) {
          unknownCredentialSailings += 1;
          continue;
        }
        onFile = recorded.filter(({ issuedAt }) => !issuedAt || issuedAt <= divesOn);
      }
      if (onFile.length === 0) nothingOnFileSailings += 1;
      // Only cards were captured, not the crew role at the mark. A later
      // assignment cannot establish what credential answered the role then.
      if (hasObservedState ? onFile.length === 0 : !answersTheirJob(tripRole, shopRoles, onFile)) {
        unrecordedSailings += 1;
        const entry = unrecorded.get(personId) ?? {
          personId,
          name: input.personNames.get(personId) ?? "",
          sailings: 0,
        };
        entry.sailings += 1;
        unrecorded.set(personId, entry);
      }
      if (onFile.length === 0) continue;
      const kinds = lapsedCredentialKinds(onFile, checkedDay);
      if (kinds.length > 0) {
        lapsedSailings.push({
          tripId: departure.tripId,
          title: departure.title,
          startsAt: departure.startsAt,
          personId,
          name: input.personNames.get(personId) ?? "",
          kinds,
          ...(validSnapshot && observationDay && started && completed
            ? { observationStartedAt: started, observationCapturedAt: completed }
            : {}),
        });
      }
    }
    if (crewSailings === crewSailingsBefore && departure.diveMode === "boat") {
      noCrewDepartures.push({
        tripId: departure.tripId,
        title: departure.title,
        startsAt: departure.startsAt,
      });
    }
  }

  const noCrewOnRecord =
    departures.length > 0 && departures.every((departure) => departure.crew.length === 0);
  return {
    departuresBack: departures.length,
    rollCallsClosed,
    openRollCalls,
    boardedAtDock,
    unmarkedAtDock,
    certOverrides: input.certOverrides,
    crewSailings,
    lapsedSailings,
    unrecordedSailings,
    unrecordedCrew: [...unrecorded.values()],
    checkedSailings: crewSailings - nothingOnFileSailings - unknownCredentialSailings,
    unknownCredentialSailings,
    noCrewDepartures: noCrewOnRecord ? [] : noCrewDepartures,
    noCrewOnRecord,
    boatsBack: departures.filter((departure) => departure.diveMode === "boat").length,
  };
}

/** Folds the year's months, in order, into one {@link SafetyYear}. */
export function summarizeSafetyYear(months: readonly SafetyMonth[]): SafetyYear {
  const sum = (pick: (month: SafetyMonth) => number) =>
    months.reduce((total, month) => total + pick(month), 0);
  const unrecorded = new Map<string, SafetyMonth["unrecordedCrew"][number]>();
  for (const row of months.flatMap((month) => month.unrecordedCrew)) {
    const entry = unrecorded.get(row.personId) ?? { ...row, sailings: 0 };
    entry.sailings += row.sailings;
    unrecorded.set(row.personId, entry);
  }
  const monthsBack = months.filter((month) => month.departuresBack > 0).length;
  const monthsWithoutCrew = months.filter((month) => month.noCrewOnRecord).length;
  return {
    departuresBack: sum((month) => month.departuresBack),
    rollCallsClosed: sum((month) => month.rollCallsClosed),
    openRollCalls: months.flatMap((month) => month.openRollCalls),
    boardedAtDock: sum((month) => month.boardedAtDock),
    unmarkedAtDock: sum((month) => month.unmarkedAtDock),
    certOverrides: sum((month) => month.certOverrides),
    crewSailings: sum((month) => month.crewSailings),
    lapsedSailings: months.flatMap((month) => month.lapsedSailings),
    unknownCredentialSailings: sum((month) => month.unknownCredentialSailings),
    unrecordedSailings: sum((month) => month.unrecordedSailings),
    unrecordedCrew: [...unrecorded.values()],
    checkedSailings: sum((month) => month.checkedSailings),
    noCrewDepartures: months.flatMap((month) => month.noCrewDepartures),
    noCrewOnRecord: monthsBack > 0 && monthsWithoutCrew === monthsBack,
    // A month with no crew on record judged none of its boats (review F1).
    boatsBack: sum((month) => (month.noCrewOnRecord ? 0 : month.boatsBack)),
    monthsBack,
    monthsWithoutCrew,
  };
}
