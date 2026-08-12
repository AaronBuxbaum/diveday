import type { BirthdayCallout } from "./age";
import type { DepthCeilingCheck } from "./depth-ceiling";
import type { RentalFitLine } from "./dive-prep";
import type { ReadinessResult } from "./readiness";
import { unavailableReadiness } from "./readiness";
import type { MedicalWaiverMark } from "./waivers";

export type RollCallState = "awaiting" | "boarded" | "not_boarded";

export type RollCallCheckpoint = "departure" | `after_dive_${number}`;

export function rollCallCheckpoints(plannedDives: number): RollCallCheckpoint[] {
  const safeCount = Math.max(1, Math.min(4, Math.trunc(plannedDives)));
  return [
    "departure",
    ...Array.from({ length: safeCount }, (_, index) => `after_dive_${index + 1}` as const),
  ];
}

export function isRollCallCheckpoint(
  value: string,
  plannedDives: number,
): value is RollCallCheckpoint {
  return rollCallCheckpoints(plannedDives).some((checkpoint) => checkpoint === value);
}

/**
 * The highest dive number any *currently live* recorded roll-call checkpoint
 * for a trip refers to — 0 when history only ever touched "departure" or
 * there is no history at all. Used to stop a planned-dive-count edit from
 * silently orphaning operational history that already happened (CR-006): a
 * trip cannot be edited down to fewer dives than staff have already recorded
 * a roll call against.
 *
 * A `cleared` event is an explicit undo — "the diver returns to awaiting"
 * (`RollCallState`, this file). Roll-call events are append-only (a clear
 * inserts a new row, it never replaces the boarded/not_boarded row it
 * undoes — `recordRollCall`, src/db/manifests.ts), so "does history include
 * a cleared event" is the wrong question; the right one, mirroring
 * `listLatestRollCallByBooking`'s own "clear undoes to awaiting" semantics,
 * is "for this diver at this checkpoint, does their *latest* event still
 * stand." Without reducing to latest-per-booking-per-checkpoint first, a
 * crew member's mis-tap-then-clear (wet hands, glare — the exact failure
 * mode this app's manifest is built to tolerate) would permanently block a
 * legitimate later correction, e.g. shrinking a weather-cancelled trip's
 * dive count, even though no diver's *current* roll-call state was ever
 * actually recorded there (dive-domain-expert review finding).
 */
export function maxRecordedDiveNumber(
  events: readonly {
    bookingId: string;
    checkpoint: string;
    status: string;
    occurredAt: Date;
    createdAt: Date;
  }[],
): number {
  const latestByKey = new Map<string, (typeof events)[number]>();
  for (const event of events) {
    const key = `${event.bookingId}\u0000${event.checkpoint}`;
    const current = latestByKey.get(key);
    if (
      !current ||
      event.occurredAt > current.occurredAt ||
      (event.occurredAt.getTime() === current.occurredAt.getTime() &&
        event.createdAt > current.createdAt)
    ) {
      latestByKey.set(key, event);
    }
  }

  let max = 0;
  for (const event of latestByKey.values()) {
    if (event.status === "cleared") continue;
    const match = /^after_dive_(\d+)$/.exec(event.checkpoint);
    if (!match) continue;
    const diveNumber = Number(match[1]);
    if (diveNumber > max) max = diveNumber;
  }
  return max;
}

export type ManifestDiverInput = {
  bookingId: string;
  fullName: string;
  email: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  readiness?: ReadinessResult;
  /** Rental kit line, including whether a fit was ever recorded at all. */
  rentalFit: RentalFitLine;
  /**
   * The diver *asked* for enriched air and holds a verified card. It is not a
   * record of what is in a cylinder: DiveDay logs no gas analysis, so the crew
   * still analyzes and signs for the actual mix before anyone breathes it.
   */
  nitroxRequested: boolean;
  /**
   * Whole years on the trip date, and whether that makes them a minor (H-21).
   * Both null/false when the shop holds no date of birth — the captain reading
   * the boarding list sees nothing rather than an "unknown age" on most of the
   * boat. Not a gate: nothing here blocks boarding, it is a fact the crew is
   * entitled to know before the lines come off.
   */
  age?: number | null;
  minor?: boolean;
  /** The diver has a birthday today or within the callout window (H-21). */
  birthday?: BirthdayCallout | null;
  /**
   * Whether the trip's deepest site goes past this diver's ceiling (H-08).
   * Carried here and not only on the roster because the plan for dive two is
   * made on the boat during the surface interval, from this list — which is
   * exactly when a depth advisory is actionable. Never a gate.
   */
  depthAdvisory?: DepthCeilingCheck;
  /**
   * When and how the diver's medical currency was last established, for spotting
   * a statement going stale. Null unless the governing waiver is a clean
   * completion — digital (questionnaire), a staff-attested paper review, or a
   * contact-imported acceptance DiveDay never itself reviewed (`source:
   * "imported"`, ADR 20260724-import-waiver-acceptance — crew-facing surfaces
   * must render this distinctly from a real review, never folded into the same
   * label). Not carried into the offline snapshot (dock roll call doesn't need
   * it).
   */
  medicalWaiver?: MedicalWaiverMark | null;
  rollCall?: RollCallRecord;
  /**
   * The buddy team staff put this diver on, when they did
   * (ADR 20260804-buddy-teams). Teammates are only ever people who are
   * actually aboard — the db assembly drops a member whose seat was since
   * cancelled, so a cancelled teammate can never raise an alert about someone
   * who is not on the boat. Display and alert input only; never a gate.
   */
  buddyTeam?: ManifestBuddyTeam | null;
  /**
   * The diver was confirmed at the counter (`bookings.status === "checked_in"`).
   * Counter check-in and boat roll call are two different questions — arrived
   * vs. aboard — and `checked_in` used to have exactly one reader in the app
   * (the check-in page itself). Carrying it onto the manifest lets crew see
   * who already showed up even before boarding them (task 149, UX persona
   * lens 17).
   */
  checkedIn: boolean;
};

export type RollCallRecord = {
  state: Exclude<RollCallState, "awaiting">;
  occurredAt: Date;
  recordedByName: string;
  note: string | null;
  /**
   * True when this result was not recorded at this checkpoint but carried
   * forward: a diver left the boat at an earlier checkpoint, so every later
   * checkpoint defaults to not boarded until staff say otherwise.
   */
  implied?: boolean;
};

export type ManifestCrewMember = {
  /**
   * The crew member's `people.id` — the **subject** of their roll-call result
   * (ADR 20260803-per-person-crew-roll-call). Carrying it is what made a
   * per-person crew roll call reachable at all; dropping it is what foreclosed
   * one, since no id ever reached a surface that could name a crew member (ADR
   * 20260802). It is also the stable list key — two crew can share a full name.
   */
  id: string;
  fullName: string;
  /**
   * What this person is doing on **this** trip when the roster says so
   * (`effectiveCrewRoles`, src/lib/crew-roles.ts), otherwise their standing
   * shop-wide roles. Display only — the supervision ratio reads the per-trip
   * role and the shop-wide roles together, never this list.
   */
  roles: string[];
  /**
   * Who to call for **this crew member**, carried for exactly the reason a
   * diver's is: the glossary defines a manifest as every person on the boat
   * with their emergency contacts, and the printed sheet is what a coastguard
   * reads. Before these two fields the paper answered "who do we call?" for
   * nine paying divers and for neither of the two staff most reliably in the
   * water (dive-domain review 20260810).
   *
   * Null is the ordinary state, not an error: nobody is asked for these at
   * hire. The row says so in words on paper rather than leaving a blank, so a
   * gap reads as a gap at the dock instead of at the hospital.
   */
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  /**
   * Their result at this checkpoint, read through the same predicates a diver's
   * is (`isRollCallAccountedFor`, `carryForwardNotBoarded`). Absent means
   * nobody has said, which keeps the checkpoint open.
   */
  rollCall?: RollCallRecord;
  /**
   * The buddy teams this crew member leads or dives on
   * (ADR 20260804-buddy-teams). Crew hold no booking, so before that model a
   * divemaster leading a group was unrecordable and a diver placed with one
   * printed identically to a diver nobody paired. Carried here for the same
   * reason a diver's team is: a crew member who is back while a group they lead
   * is not is exactly the split the deck watches for.
   *
   * **Plural, unlike a diver's.** One divemaster commonly leads several groups
   * on one boat, which is how guided diving runs, so crew carry no "at most one
   * team" constraint — that rule is a statement about divers only, and it is
   * what keeps a diver's row unambiguous.
   */
  buddyTeams?: ManifestBuddyTeam[];
};

/**
 * A staff member's statement of how many crew were aboard at one checkpoint,
 * out of how many the trip had assigned. **Retired** (ADR
 * 20260804-crew-roll-call-is-per-person): nothing asks for one any more, and
 * roll-call completeness reads the named crew list alone
 * (`ManifestCrewMember.rollCall`). A number named nobody, so it could never say
 * that the third body aboard was the deckhand rather than the divemaster who
 * had not surfaced.
 *
 * The shape survives because the rows do: they are statements humans made about
 * departures that sailed, and the incident export and the shop CSV export both
 * still render them.
 */
export type CrewAttestation = {
  /** Bodies counted by a human. Never derived from the assignment list. */
  crewAboard: number;
  /** What the assignment count was when it was attested (evidence, not the gate). */
  crewAssigned: number;
  attestedByName: string;
  occurredAt: Date;
  note: string | null;
};

/**
 * `not_boarded` means two opposite things depending on where it was recorded,
 * and conflating them is what let the manifest print "Roll call complete ✦" on
 * a boat the Today queue was raising a missing-diver alarm about (DOM-H3):
 *
 * - at `departure` it means **never left the dock**. Benign, genuinely
 *   accounted for, and correctly true of every later checkpoint too — which is
 *   what `carryForwardNotBoarded` below fills in (`implied: true`).
 * - explicitly at an `after_dive_n` checkpoint it means **did not return to the
 *   boat**. That *is* the missing-diver event: the crew member who taps the
 *   only control that isn't "Boarded" is saying "not back yet, check again",
 *   and the checkpoint must stay open.
 *
 * This predicate is the single place that split lives on the manifest side.
 * `src/db/today.ts` states the same rule for the work queue (see
 * `isAccountedForAfterDive` there); the two are asserted against each other on
 * one trip in src/db/today.test.ts so they can never drift apart again.
 */
export function isNotBackAboard(
  checkpoint: RollCallCheckpoint,
  rollCall: Pick<RollCallRecord, "state" | "implied"> | undefined,
): boolean {
  if (checkpoint === "departure") return false;
  if (rollCall?.state !== "not_boarded") return false;
  // Carried forward from the dock (see `carryForwardNotBoarded`): a diver who
  // never left is accounted for at every later checkpoint, not missing from it.
  return rollCall.implied !== true;
}

/**
 * Is this diver counted at this checkpoint? The one rule every head count on
 * the manifest asks, so "complete", the summary tiles, and the diver's own pill
 * cannot answer it differently.
 *
 * No result at all is *not* accounted for (nobody has said), and neither is a
 * diver a human recorded as not back aboard after a dive.
 */
export function isRollCallAccountedFor(
  checkpoint: RollCallCheckpoint,
  rollCall: Pick<RollCallRecord, "state" | "implied"> | undefined,
): boolean {
  if (!rollCall) return false;
  return !isNotBackAboard(checkpoint, rollCall);
}

/**
 * The person is recorded as **ashore**: somebody said they are not aboard, and
 * that statement is the benign kind — a dock-side "never left" or the
 * carried-forward default that follows from it (`carryForwardNotBoarded`), not
 * an after-dive "did not come back" (`isNotBackAboard`).
 *
 * For a crew member this is the fact the count-level attestation has to be
 * reconciled against: a rostered hand the per-person half has already recorded
 * as ashore is **not a body the boat can count aboard**, and demanding that the
 * attestation cover them anyway is what made an honest count unclosable (see
 * `crewRollCallCounts`).
 */
export function isRecordedAshore(
  checkpoint: RollCallCheckpoint,
  rollCall: Pick<RollCallRecord, "state" | "implied"> | undefined,
): boolean {
  if (rollCall?.state !== "not_boarded") return false;
  return !isNotBackAboard(checkpoint, rollCall);
}

/** One teammate, as the manifest carries them — a seated diver, or crew. */
export type BuddyTeammate =
  | { kind: "diver"; bookingId: string; fullName: string }
  | { kind: "crew"; personId: string; fullName: string };

/**
 * The buddy team one roster entry belongs to, from that entry's own point of
 * view (ADR 20260804-buddy-teams).
 *
 * `others` is everyone on the team **except** this person, which is what both
 * the chip and the alert read: a team is a fact about a group, but a row on the
 * manifest is a fact about one body, and the question that row answers is "who
 * am I supposed to be with?".
 *
 * Only members who are actually aboard appear. The db assembly drops a diver
 * whose seat was since cancelled, so an alert can never accuse someone who is
 * not on the boat; the teams panel keeps showing them so the team stays
 * dissolvable.
 */
export type ManifestBuddyTeam = {
  teamId: string;
  others: BuddyTeammate[];
};

/**
 * Buddy teams on the roll call (ADR 20260804-buddy-teams). The state a real
 * deck watches for is **at least one member back aboard while at least one is
 * not**. This predicate turns that watch into a first-class, derived attention
 * state on the manifest — quiet when a team's statuses agree, loud when they
 * split.
 *
 * What one member's row should say about their team at one checkpoint — from
 * **that member's own perspective**, which is why it is not symmetric:
 *
 * - `separated_dock` — this person is aboard at departure and a teammate is
 *   not (yet). Ordinary mid-boarding churn, worth a glance, worded and toned
 *   as a heads-up rather than an alarm.
 * - `separated_after_dive` — this person came back from a dive and a teammate
 *   is not recorded back aboard: still awaiting a result, or a human said they
 *   did not come back. This is the signal a deck watches for, and it is the
 *   loud one.
 * - `null` — nothing to say. Covers: no divergence (everyone aboard, everyone
 *   ashore, everyone awaiting), this person not being aboard themselves (their
 *   *own* row already carries whatever state matters — a teammate's row is
 *   where the "back without them" fact renders), and teammates who are
 *   recorded ashore from the dock (`isRecordedAshore`): someone who never left
 *   the dock is accounted for on land, not separated in the water, and alarming
 *   about them would teach the crew to stop reading the panel.
 *
 * **One unaccounted-for teammate is enough.** The reading is fail-closed by
 * design: a team of four with three back and one not is exactly as loud as a
 * pair with one back and one not, because the boat's next move is identical.
 * A team with no teammates left aboard (everyone else's seat was cancelled)
 * has nothing to diverge from and stays quiet.
 *
 * Codes, not sentences: the UI resolves the words through
 * `src/i18n/buddy-labels.ts`, same rule as every other status in the app.
 *
 * A buddy alert **informs and never acts**: it does not block boarding, does
 * not touch `rollCallCompleteness`, does not message anyone, and plays no
 * part in readiness, admission, or capacity. The roll-call events stay the
 * only record of who is aboard. The offline copy displays saved teams but
 * never computes this — a snapshot cannot know who came back
 * (src/lib/offline-manifests.ts).
 */
export type BuddyAlert = "separated_dock" | "separated_after_dive";

export function buddyAlertFor(
  checkpoint: RollCallCheckpoint,
  self: Pick<RollCallRecord, "state" | "implied"> | undefined,
  teammates: ReadonlyArray<Pick<RollCallRecord, "state" | "implied"> | undefined>,
): BuddyAlert | null {
  // Only someone who is themselves aboard can be "back without their team".
  if (self?.state !== "boarded") return null;
  // A teammate who is aboard is settled. After a dive, so is one recorded
  // ashore at the dock (explicitly, or carried forward): they never left, so
  // they are accounted for on land rather than missing from the water. At the
  // dock itself that exemption must not apply — "aboard while my buddy is
  // still ashore" is precisely the heads-up this checkpoint exists to give.
  const unsettled = teammates.some(
    (mate) =>
      mate?.state !== "boarded" &&
      (checkpoint === "departure" || !isRecordedAshore(checkpoint, mate)),
  );
  if (!unsettled) return null;
  return checkpoint === "departure" ? "separated_dock" : "separated_after_dive";
}

/** One crew member, reduced to the only field a head count reads. */
export type CrewRollCallSubject = {
  rollCall?: Pick<RollCallRecord, "state" | "implied">;
};

export type CrewRollCallCounts = {
  /** How many crew the trip names at all. Zero is its own open state. */
  crewAssigned: number;
  /** Assigned crew with no result of their own at this checkpoint. */
  crewAwaiting: number;
  /** Assigned crew a human recorded as not back aboard *after a dive*. */
  crewNotBackAboard: number;
  /** Assigned crew the per-person half already accounts for as ashore. */
  crewAshore: number;
};

/**
 * The crew half of "who is unaccounted for", from the crew list itself. The
 * same predicates a diver's result goes through, so the live manifest, the
 * dock copy, and every test answer this identically — and so a crew member who
 * did not come back can never read as handled (DOM-H3's rule, applied to the
 * people most reliably in the water).
 *
 * Absence is *awaiting*, never accounted for. That is what makes the offline
 * copy fail closed: a snapshot saved before per-person crew results existed
 * carries no results, so every crew member on it reads as awaiting and the
 * checkpoint stays open there exactly as it does online.
 */
export function crewRollCallCounts(
  checkpoint: RollCallCheckpoint,
  crew: readonly CrewRollCallSubject[],
): CrewRollCallCounts {
  // Named `crew*` rather than `awaiting`/`notBackAboard` so a caller reading
  // one of these next to the diver counts cannot confuse the two.
  const crewAshore = crew.filter((member) => isRecordedAshore(checkpoint, member.rollCall)).length;
  return {
    crewAssigned: crew.length,
    crewAwaiting: crew.filter((member) => !member.rollCall).length,
    crewNotBackAboard: crew.filter((member) => isNotBackAboard(checkpoint, member.rollCall)).length,
    crewAshore,
  };
}

/**
 * Why a checkpoint is not closed yet. Codes, not sentences — the UI picks the
 * words from each locale's staff bundle.
 *
 * - `no_divers` — nothing to count; an empty roster never reads complete.
 * - `divers_not_back_aboard` — a human recorded at least one diver as not back
 *   aboard after a dive. Ranked above `divers_awaiting` for the same reason
 *   `listRollCallGaps` ranks `missing_diver` above `after_dive_uncounted`: a
 *   stated "they didn't come back" outranks a clerical gap on the same boat.
 * - `divers_awaiting` — at least one booked diver has no result here.
 * - `crew_not_back_aboard` — a human recorded a *named* crew member as not back
 *   aboard after a dive. The loudest thing on this list: it is a stated
 *   emergency about the people most reliably in the water, so it outranks
 *   every other crew reason.
 * - `crew_none_assigned` — the trip names nobody. An empty crew list is a
 *   scheduling gap, never evidence that nobody else was aboard, so it holds the
 *   checkpoint open exactly as an uncalled crew member does. The way out is to
 *   put the people who sailed on the trip, which is what the manifest's "Add
 *   crew to trip" button is for.
 * - `crew_none_aboard` — the trip names crew, every one of them has a result,
 *   and every one of those results is *ashore*. Nobody rostered is on the boat.
 *   A departure with divers in the water had somebody running it, so this is
 *   stronger evidence of an unrostered body aboard than an empty crew list is —
 *   and the empty list already holds the checkpoint open on exactly that
 *   reasoning (dive-domain review 20260804). Ranked below the two "somebody is
 *   missing" reasons and above `crew_awaiting`: it is a stated, complete set of
 *   results that together say something impossible, not a clerical gap.
 * - `crew_awaiting` — the trip names crew, and at least one of them has no
 *   result of their own at this checkpoint.
 */
export type CrewIncompleteReason =
  | "crew_not_back_aboard"
  | "crew_none_assigned"
  | "crew_none_aboard"
  | "crew_awaiting";

export type RollCallIncompleteReason =
  | "no_divers"
  | "divers_not_back_aboard"
  | "divers_awaiting"
  | CrewIncompleteReason;

export type RollCallCompleteness = {
  complete: boolean;
  diversAccountedFor: boolean;
  crewAccountedFor: boolean;
  /** The single top reason this checkpoint is open — divers outrank crew. */
  reason: RollCallIncompleteReason | null;
  /**
   * The **crew half's own** reason, independent of the divers'. A surface that
   * renders a crew panel has to read this rather than `reason`: with a diver
   * still awaiting, `reason` is `divers_awaiting` and a crew panel keyed off it
   * would quietly show "nobody has attested" on a boat where a named crew
   * member has been recorded as not back aboard.
   */
  crewReason: CrewIncompleteReason | null;
  /** The crew counts this verdict was reached with, so no caller recomputes them. */
  crewCounts: CrewRollCallCounts;
};

/**
 * The single definition of "this checkpoint is closed", shared by the live
 * manifest and the offline copy. It used to be written twice, inline, at the UI
 * layer (`manifest/page.tsx` and `OfflineManifestView.tsx`), as
 * `totalDivers > 0 && awaiting === 0` — divers only. Crew are the people most
 * reliably in the water and were not part of it, so a boat could read "roll call
 * complete" with a divemaster still down.
 *
 * Rules, in order:
 *
 * 1. Divers first: an empty roster is never complete, and every booked diver
 *    must be *accounted for* at this checkpoint — which is not the same as
 *    "has a result". A diver a human recorded as not back aboard after a dive
 *    has a result and is precisely the person who is missing, so `awaiting`
 *    alone can never be the diver half of this (`isNotBackAboard` above;
 *    DOM-H3). That is why this takes both counts rather than one `awaiting`:
 *    the *closing* rule is `unaccountedFor === 0`, and the split only decides
 *    which reason to name.
 * 2. Then crew, which is now **one source**: every crew member the trip names
 *    must be accounted for individually (ADR 20260803-per-person-crew-roll-call,
 *    ADR 20260804-crew-roll-call-is-per-person). The typed "how many crew are
 *    aboard" attestation that used to be the other half is gone — it named
 *    nobody, so it could never tell the boat that the third body was the
 *    deckhand rather than the divemaster who has not surfaced, and the crew
 *    tapping through named results had to re-state the same fact as a number
 *    before a checkpoint would close. What it could catch that the named list
 *    cannot — a hand nobody rostered — it caught by asking for a number, and
 *    the honest fix for an unrostered hand is to roster them.
 *
 * **A crew nobody is aboard from does not auto-complete either.** Two shapes of
 * that, and both hold the checkpoint open. A trip with no crew assigned is a
 * scheduling gap (the app already nags about it as a coverage gap), not
 * evidence that nobody else was aboard — `crew_none_assigned`. And a trip whose
 * whole rostered crew is recorded *ashore* has a complete set of results that
 * together say the boat sailed with nobody running it — `crew_none_aboard`.
 * Treating either as satisfied hands back exactly the silent pass this whole
 * check exists to remove, on precisely the trips whose crew data is worst. The
 * closing rule is therefore "at least one rostered body aboard, and everybody
 * rostered accounted for", not "everybody rostered accounted for".
 *
 * **The crew input is required, and it is the crew list itself.** The crew
 * fields used to be optional counts defaulting to `0`, which made the one
 * function that decides whether everyone is out of the water *fail open by
 * construction*: a caller that forgot the per-person figures got
 * `complete: true` with nobody named, and the compiler said nothing (review
 * 20260803, D7). Taking the list also removes the caller's ability to disagree
 * with `crewRollCallCounts` about what it means.
 */
export function rollCallCompleteness(input: {
  /** Which checkpoint this is — decides what a crew `not_boarded` means. */
  checkpoint: RollCallCheckpoint;
  totalDivers: number;
  /** Booked divers with no result at all at this checkpoint. */
  awaiting: number;
  /**
   * Divers a human explicitly recorded as not back aboard *after a dive*
   * (`isNotBackAboard`). Structurally always 0 at departure — pass it anyway,
   * so no caller can quietly omit the half that means somebody is in the water.
   */
  notBackAboard: number;
  /** The trip's assigned crew *now*, each with their result at this checkpoint. */
  crew: readonly CrewRollCallSubject[];
}): RollCallCompleteness {
  const unaccountedFor = input.awaiting + input.notBackAboard;
  const diversAccountedFor = input.totalDivers > 0 && unaccountedFor === 0;
  const crewCounts = crewRollCallCounts(input.checkpoint, input.crew);
  const { crewAssigned, crewAwaiting, crewNotBackAboard, crewAshore } = crewCounts;
  // Somebody rostered has to actually be on the boat. `crewAssigned > 0` alone
  // was not enough: a crew recorded ashore at the dock is *accounted for* and
  // carries forward, so a trip whose whole crew was marked not-aboard closed
  // every checkpoint with nobody aboard and printed "everyone's accounted for"
  // over a boat that had sailed with divers on it (dive-domain review
  // 20260804). Under the retired attestation this state still cost a human
  // saying "0 aboard" out loud; dropping the count must not make it free.
  const crewAboard = crewAssigned - crewAshore;
  const crewAccountedFor = crewAboard > 0 && crewAwaiting === 0 && crewNotBackAboard === 0;
  const crewReason: CrewIncompleteReason | null =
    crewNotBackAboard > 0
      ? "crew_not_back_aboard"
      : crewAssigned === 0
        ? "crew_none_assigned"
        : crewAwaiting > 0
          ? "crew_awaiting"
          : crewAboard === 0
            ? "crew_none_aboard"
            : null;
  const reason: RollCallIncompleteReason | null =
    input.totalDivers === 0
      ? "no_divers"
      : input.notBackAboard > 0
        ? "divers_not_back_aboard"
        : input.awaiting > 0
          ? "divers_awaiting"
          : crewReason;
  return {
    complete: diversAccountedFor && crewAccountedFor,
    diversAccountedFor,
    crewAccountedFor,
    reason,
    crewReason,
    crewCounts,
  };
}

export type TripManifest = {
  trip: {
    id: string;
    title: string;
    startsAt: Date;
    endsAt: Date;
    plannedDives: number;
  };
  checkpoint: RollCallCheckpoint;
  crew: (ManifestCrewMember & {
    /**
     * This crew member is back and at least one teammate is not — the same
     * derivation a diver's row carries, on the same terms (ADR
     * 20260804-buddy-teams).
     */
    buddyAlert: BuddyAlert | null;
  })[];
  /**
   * Whether this checkpoint is closed — divers *and* crew. Derived here so the
   * live page and the offline copy cannot drift apart; the offline view
   * recomputes it with `rollCallCompleteness` because its `awaiting` count comes
   * from events on the device, not from this snapshot.
   */
  completeness: RollCallCompleteness;
  divers: (ManifestDiverInput & {
    readiness: ReadinessResult;
    rollCall: ManifestDiverInput["rollCall"];
    /**
     * This diver is back and at least one teammate is not (`buddyAlertFor`).
     * Derived here — the one derivation both the screen and the tests read —
     * and deliberately absent from the offline snapshot: a saved copy cannot
     * know who came back, so it displays teams and computes nothing.
     */
    buddyAlert: BuddyAlert | null;
  })[];
  summary: {
    totalDivers: number;
    ready: number;
    blocked: number;
    boarded: number;
    /** Divers deliberately left ashore, including carried-forward defaults. */
    notBoarded: number;
    /**
     * Divers a human recorded as **not back aboard** after a dive — the
     * missing-diver count. Always 0 at `departure`, where `not_boarded` means
     * "never left the dock" instead (`isNotBackAboard`).
     */
    notBackAboard: number;
    awaiting: number;
    /**
     * `awaiting + notBackAboard`. The number that decides whether this
     * checkpoint's diver half is closed — never `awaiting` on its own.
     */
    unaccountedFor: number;
  };
};

type MaybeRollCall = Pick<RollCallRecord, "state" | "implied"> | undefined;

/**
 * Every teammate's roll-call record, across however many teams a row is on.
 *
 * A teammate the caller cannot resolve is **dropped, not counted as
 * unaccounted for** — a stale reference is a bug in the assembly, and a bug
 * must not manufacture an alarm about a person nobody can name.
 */
function teammateRollCallsIn(
  teams: ReadonlyArray<ManifestBuddyTeam | null | undefined>,
  byBooking: ReadonlyMap<string, MaybeRollCall>,
  byCrewId: ReadonlyMap<string, MaybeRollCall>,
): MaybeRollCall[] {
  return teams.flatMap((team) =>
    (team?.others ?? []).flatMap((other) =>
      other.kind === "diver"
        ? byBooking.has(other.bookingId)
          ? [byBooking.get(other.bookingId)]
          : []
        : byCrewId.has(other.personId)
          ? [byCrewId.get(other.personId)]
          : [],
    ),
  );
}

/**
 * The teams that are split at this checkpoint, by team id.
 *
 * A **team** count, not a count of rows wearing an alert: a team of four with
 * three back and one not puts the alert on three rows, and "3 teams are split"
 * would be a lie told by counting. It is also why this cannot be derived from
 * a crew member's `buddyAlert` alone — one divemaster leads several teams and
 * carries one flag between them, so the flag says *a* team of theirs split, not
 * which.
 *
 * Attention state only, like the alert it reads: nothing here gates anything.
 */
export function splitBuddyTeamIds(manifest: TripManifest, alert: BuddyAlert): Set<string> {
  const byBooking = new Map<string, MaybeRollCall>(
    manifest.divers.map((diver) => [diver.bookingId, diver.rollCall]),
  );
  const byCrewId = new Map<string, MaybeRollCall>(
    manifest.crew.map((member) => [member.id, member.rollCall]),
  );
  const split = new Set<string>();
  const consider = (team: ManifestBuddyTeam | null | undefined, self: MaybeRollCall) => {
    if (!team) return;
    const mates = teammateRollCallsIn([team], byBooking, byCrewId);
    if (buddyAlertFor(manifest.checkpoint, self, mates) === alert) split.add(team.teamId);
  };
  for (const diver of manifest.divers) consider(diver.buddyTeam, diver.rollCall);
  for (const member of manifest.crew) {
    for (const team of member.buddyTeams ?? []) consider(team, member.rollCall);
  }
  return split;
}

/**
 * One pure derivation feeds the screen, print view, and future offline
 * snapshot. It preserves every supplied booking and converts missing safety
 * evidence into a blocking result rather than filtering the person away.
 */
export function buildTripManifest(input: {
  trip: TripManifest["trip"];
  checkpoint?: RollCallCheckpoint;
  crew: ManifestCrewMember[];
  divers: ManifestDiverInput[];
}): TripManifest {
  const checkpoint = input.checkpoint ?? "departure";
  // A buddy alert reads every *teammate's* record, so it needs the whole
  // roster — divers and crew — in hand. Defensive on the lookup: a teammate
  // pointing at somebody who is not among the supplied rows (a caller bug, or
  // a roster that changed between reads) is dropped rather than counted as
  // unaccounted for, so a stale reference can never fabricate an alert.
  const rollCallByBooking = new Map(
    input.divers.map((diver) => [diver.bookingId, diver.rollCall] as const),
  );
  const rollCallByCrewId = new Map(
    input.crew.map((member) => [member.id, member.rollCall] as const),
  );
  const teammateRollCalls = (teams: ReadonlyArray<ManifestBuddyTeam | null | undefined>) =>
    teammateRollCallsIn(teams, rollCallByBooking, rollCallByCrewId);
  const divers = input.divers.map((diver) => ({
    ...diver,
    readiness: diver.readiness ?? unavailableReadiness(),
    rollCall: diver.rollCall,
    buddyAlert: buddyAlertFor(checkpoint, diver.rollCall, teammateRollCalls([diver.buddyTeam])),
  }));
  const crew = input.crew.map((member) => ({
    ...member,
    buddyAlert: buddyAlertFor(
      checkpoint,
      member.rollCall,
      teammateRollCalls(member.buddyTeams ?? []),
    ),
  }));
  const awaiting = divers.filter((diver) => !diver.rollCall).length;
  const notBackAboard = divers.filter((diver) =>
    isNotBackAboard(checkpoint, diver.rollCall),
  ).length;
  const summary = {
    totalDivers: divers.length,
    ready: divers.filter((diver) => diver.readiness.status === "ready").length,
    blocked: divers.filter((diver) => diver.readiness.status === "blocked").length,
    boarded: divers.filter((diver) => diver.rollCall?.state === "boarded").length,
    notBoarded: divers.filter((diver) => diver.rollCall?.state === "not_boarded").length,
    notBackAboard,
    awaiting,
    unaccountedFor: awaiting + notBackAboard,
  };
  return {
    trip: input.trip,
    checkpoint,
    crew,
    completeness: rollCallCompleteness({
      checkpoint,
      totalDivers: summary.totalDivers,
      awaiting: summary.awaiting,
      notBackAboard: summary.notBackAboard,
      crew: input.crew,
    }),
    divers,
    summary,
  };
}

/**
 * What a diver's roll-call pill says at this checkpoint — as a **code**, not a
 * sentence: `src/lib` hands back the state and the UI picks the words
 * (`rollCallLabelText`, src/i18n/manifest-labels.ts). This used to return
 * hard-coded English and take no checkpoint at all, which is why an after-dive
 * "did not return to the boat" rendered as "Not boarded" — and, on the button
 * beside it, as a green-checked "Not boarded ✓" — on both the live and the
 * offline manifest.
 */
export type RollCallLabel =
  | "awaiting"
  | "boarded"
  | "not_boarded"
  | "not_boarded_carried"
  | "not_back_aboard";

export function rollCallLabel(
  checkpoint: RollCallCheckpoint,
  // Only the state and the carried-forward flag decide the word, so the offline
  // copy — whose `occurredAt` is an ISO string, not a Date — resolves through
  // this same function rather than keeping a second word list of its own.
  rollCall: Pick<RollCallRecord, "state" | "implied"> | undefined,
): RollCallLabel {
  if (!rollCall) return "awaiting";
  if (rollCall.state === "boarded") return "boarded";
  if (isNotBackAboard(checkpoint, rollCall)) return "not_back_aboard";
  return rollCall.implied ? "not_boarded_carried" : "not_boarded";
}

/**
 * Fills the "never left the dock, so still ashore" default across one diver's
 * ordered checkpoints. A diver marked not boarded **at departure** defaults to
 * not boarded at every later checkpoint with no result of its own (flagged
 * `implied`) until an explicit result breaks the chain. Carry-forward never
 * fabricates a "boarded": the default can only ever read absent.
 *
 * **Only index 0 — `departure` — is ever a source, and this is the whole point
 * (DOM-H3).** A `not_boarded` at an after-dive checkpoint does not mean "left
 * ashore", it means **did not return to the boat** (`isNotBackAboard` above).
 * Carrying that forward as an accounted-for record is what closed every
 * subsequent checkpoint on exactly the boat that had a diver in the water — the
 * manifest printed "Roll call complete ✦" while the Today queue was raising a
 * top-severity missing-diver row about the same trip. A missing diver must
 * never satisfy a later count; the crew have to state, per checkpoint, whether
 * that person came back.
 *
 * A `cleared` undo has already been collapsed to "no result" upstream
 * (listLatestRollCallByBooking), so it is not seen here as a breaker. Clearing
 * the originating departure not-boarded removes the source and the whole chain
 * reverts to awaiting; clearing a later re-board reverts that checkpoint to the
 * carried default. Pure and order-sensitive: pass the checkpoints in
 * departure→last order.
 */
export function carryForwardNotBoarded(
  perCheckpoint: readonly (RollCallRecord | undefined)[],
): (RollCallRecord | undefined)[] {
  let carried: RollCallRecord | undefined;
  return perCheckpoint.map((result, index) => {
    if (result) {
      carried = index === 0 && result.state === "not_boarded" ? result : undefined;
      return result;
    }
    return carried ? { ...carried, implied: true } : undefined;
  });
}
