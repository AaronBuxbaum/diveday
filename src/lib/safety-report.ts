import { type CalendarDate, isCalendarDateExpired, isValidCalendarDate } from "./calendar-date";
import { lastDayOfDeparture } from "./crew-roles";
import { rollCallCheckpoints } from "./roll-call";

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
  /** Every booking not cancelled: the manifest's own roster. */
  bookingIds: readonly string[];
  /** The crew list. */
  crewIds: readonly string[];
};

export type SafetyRollCallEvent = {
  tripId: string;
  /** A booking for a diver's event, a person for a crew member's. */
  subjectId: string;
  checkpoint: string;
  status: "boarded" | "not_boarded" | "cleared";
};

export type SafetyCredential = {
  personId: string;
  kind: string;
  renewsAt: string | null;
};

export type SafetyMonthInput = {
  timeZone: string;
  departures: readonly SafetyDepartureInput[];
  /** Every roll-call event on those departures, divers and crew, oldest first. */
  diverEvents: readonly SafetyRollCallEvent[];
  crewEvents: readonly SafetyRollCallEvent[];
  /** Live credentials of everybody on those crews. */
  credentials: readonly SafetyCredential[];
  personNames: ReadonlyMap<string, string>;
  /** Card checks written past (`participant_type_changed`, `certCheck` overridden). */
  certOverrides: number;
};

export type SafetyMonth = {
  departuresBack: number;
  rollCallsClosed: number;
  /** Departures whose head count never closed, or was never taken. */
  openRollCalls: { tripId: string; title: string; startsAt: Date; closure: RollCallClosure }[];
  /** Divers boarded at the dock: the rail boards nobody the readiness check refuses. */
  boardedAtDock: number;
  /** Seats with no dock mark at all — never boarded, never marked ashore. */
  unmarkedAtDock: number;
  certOverrides: number;
  /** One crew member on one departure. */
  crewSailings: number;
  /** …of which sailed with a recorded credential lapsed on the day. */
  lapsedSailings: {
    tripId: string;
    title: string;
    startsAt: Date;
    personId: string;
    name: string;
    kinds: string[];
  }[];
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
 * - **each after-dive count** closes when everybody who boarded — at the dock,
 *   or recorded at a later checkpoint — is recorded back aboard. Nothing but
 *   "boarded" closes it;
 * - **crew** are counted the same way once they boarded at the dock. A crew
 *   member never marked at all raises nothing, as on Today.
 *
 * A departure with no roll-call event of either kind is `none`, never closed.
 */
export function rollCallClosure(
  departure: SafetyDepartureInput,
  diverResult: (subjectId: string, checkpoint: string) => "boarded" | "not_boarded" | undefined,
  crewResult: (subjectId: string, checkpoint: string) => "boarded" | "not_boarded" | undefined,
  hasAnyEvent: boolean,
): RollCallClosure {
  if (!hasAnyEvent) return "none";
  const [dock, ...afterDives] = rollCallCheckpoints(departure.plannedDives);
  if (!dock) return "open";
  for (const bookingId of departure.bookingIds) {
    if (diverResult(bookingId, dock) === undefined) return "open";
  }
  const divers = departure.bookingIds.filter(
    (id) =>
      diverResult(id, dock) === "boarded" ||
      afterDives.some((checkpoint) => diverResult(id, checkpoint) !== undefined),
  );
  const crew = departure.crewIds.filter((id) => crewResult(id, dock) === "boarded");
  for (const checkpoint of afterDives) {
    if (divers.some((id) => diverResult(id, checkpoint) !== "boarded")) return "open";
    if (crew.some((id) => crewResult(id, checkpoint) !== "boarded")) return "open";
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

export function summarizeSafetyMonth(input: SafetyMonthInput): SafetyMonth {
  const diverResult = standing(input.diverEvents);
  const crewResult = standing(input.crewEvents);
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

  for (const departure of input.departures) {
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
    for (const personId of departure.crewIds) {
      // A crew member recorded ashore at the dock did not sail.
      if (crewResult(departure.tripId, personId, dock) === "not_boarded") continue;
      crewSailings += 1;
      const kinds = lapsedCredentialKinds(credentialsByPerson.get(personId) ?? [], divesOn);
      if (kinds.length > 0) {
        lapsedSailings.push({
          tripId: departure.tripId,
          title: departure.title,
          startsAt: departure.startsAt,
          personId,
          name: input.personNames.get(personId) ?? "",
          kinds,
        });
      }
    }
  }

  return {
    departuresBack: input.departures.length,
    rollCallsClosed,
    openRollCalls,
    boardedAtDock,
    unmarkedAtDock,
    certOverrides: input.certOverrides,
    crewSailings,
    lapsedSailings,
  };
}
