import { createHash } from "node:crypto";
import type {
  Certification,
  NitroxCertification,
  SpecialtyCertification,
  WaiverRecord,
} from "@/db/schema";
import {
  type RollCallCheckpoint,
  type RollCallLabel,
  rollCallLabel,
  type TripManifest,
} from "./manifests";
import { isUnsightedSelfDeclaration } from "./readiness";
import { type WaiverState, waiverState } from "./waivers";

/**
 * Incident-ready export: one departure's recorded safety evidence, assembled
 * into a single document a shop can hand to authorities or insurers.
 *
 * Two rules govern everything in this file:
 *
 * 1. **Recorded facts only.** The document restates what staff and divers
 *    recorded, each with its timestamp and the person who recorded it. It
 *    never computes or implies a safety judgment — there is no readiness
 *    verdict, no "this departure was safe" line, and nothing here re-derives a
 *    gate. The one derivation it performs is the same per-checkpoint roll-call
 *    label every manifest surface already shows (`rollCallLabel`), so this
 *    document can never disagree with the screen the crew used.
 * 2. **Absence is stated, never blank.** A diver with no certification on
 *    file, a departure with no roll call yet, a waiver that is superseded or
 *    was never signed — each renders as an explicit code the UI words
 *    (`awaiting`, `not_sent`, an empty-timeline statement), because on this
 *    document a silent gap reads as a missing page.
 *
 * Medical **answers never appear** (H-03 boundary): the waiver section carries
 * status, dates, and template version only. A `medical_review` state says a
 * review was required — never why.
 *
 * Codes, not sentences, throughout — the route picks the words from
 * the staff bundle (`staff/incidentExport.json`). Every instant is an ISO-8601 UTC string;
 * the route formats it for the reader's locale in the shop's timezone.
 */

export type IncidentCertificationEvidence = {
  kind: "level" | "specialty" | "nitrox";
  /** Agency code (`certification_agency` enum) — the UI maps it to a word. */
  agency: string;
  /** Ladder level code for `kind: "level"`, null otherwise. */
  level: string | null;
  /** Specialty code for `kind: "specialty"`, null otherwise. */
  specialty: string | null;
  /**
   * The card number as the shop holds it. Null on a self-declared card, which
   * has none — the diver named a level on a public opt-in and nobody has seen
   * anything (`selfDeclared` below).
   */
  identifier: string | null;
  /** Stored card status verbatim (`pending` | `verified`) — never upgraded. */
  status: string;
  /** When staff last reviewed/confirmed the card, if they have. */
  reviewedAt: string | null;
  /** The staffer who made that review, null for older or imported evidence. */
  reviewedByName: string | null;
  /**
   * The card arrived via the contact importer and was never sighted here (ADR
   * 20260724-import-verified-cards). Must render distinctly — an imported card
   * is a prior system's evidence, not a card this shop checked.
   */
  imported: boolean;
  /**
   * **The diver said so; nobody checked.** The card came from one of the three
   * public forms where a diver may name their own level — the deal list, a
   * trip's wait list, or the booking form (FU-20260813, ADR
   * 20260820-attested-at-booking-verified-at-boarding). It is the weakest thing in this file and has
   * to read that way — an investigator must never mistake it for a card the
   * shop sighted. True only while it is still unsighted: a self-declaration a
   * staffer later verified off the real card is a sighting, and reads as one.
   */
  selfDeclared: boolean;
};

export type IncidentWaiverStatus = {
  /**
   * The governing record's state after the sign-once rule — the same
   * `effectiveWaiverForBooking` resolution every readiness surface uses, so
   * this document can never call signed what the boarding gate called
   * missing. A superseded-only or absent record reads `not_sent`: a stated
   * absence, never a blank and never a stale "signed".
   */
  state: WaiverState;
  signedAt: string | null;
  templateTitle: string | null;
  templateVersion: number | null;
  /**
   * How the signature was recorded, verbatim (`in_person`,
   * `in_person_attested`, `imported`, null for the diver's own digital
   * completion). Imported acceptances must render distinctly (ADR
   * 20260724-import-waiver-acceptance).
   */
  signatureMethod: string | null;
  /**
   * The accountable staff member on a paper attestation. This is deliberately
   * absent for a diver's own digital signature and prior-system import: the
   * log names a staff member only when the shop itself attested a paper record.
   */
  recordedByName: string | null;
};

export type IncidentRollCallResult = {
  checkpoint: RollCallCheckpoint;
  /** The same label the live manifest shows (`rollCallLabel`) — `awaiting` is a stated absence. */
  label: RollCallLabel;
  occurredAt: string | null;
  recordedByName: string | null;
  note: string | null;
};

/**
 * One diver's side of a recorded buddy pairing, as the document prints it.
 *
 * `teamNumber` exists so the pairing is *readable* on paper. Roster order is
 * booking-creation order, so a team's members land wherever they were booked —
 * often pages apart on a full boat. Without a team number, checking "did
 * everyone on this team come back?" is a manual name-chase across a page
 * break, which is precisely the comparison this document leaves to the reader
 * instead of computing a verdict. Numbering is stable: `listTripBuddyTeams`
 * orders by `createdAt` then `pairId`, so the same records always number the
 * same way and the integrity code stays reproducible.
 */
export type IncidentBuddyPairing = {
  /** 1-based, in pairing order — printed as "Team 03". */
  teamNumber: number;
  /**
   * Everyone else on the team, in display order — a **list**, because a team
   * is two or more (ADR 20260804-buddy-teams).
   *
   * `isCrew` is the distinction this document exists to preserve: a diver
   * deliberately placed with a divemaster used to print identically to a diver
   * nobody paired, because crew hold no booking and the old model could not
   * record them. On the one page where "accompanied" and "unaccompanied" must
   * not read the same, they now don't.
   */
  members: Array<{ fullName: string; isCrew: boolean }>;
  /** The staff member who made the call; a pairing is never anonymous. */
  pairedByName: string | null;
  /** When the pairing was recorded — at the dock, or after the fact. */
  pairedAt: string | null;
};

export type IncidentRosterEntry = {
  bookingId: string;
  fullName: string;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  /**
   * The buddy team staff put this diver on for this departure
   * (ADR 20260804-buddy-teams). A **recorded decision**, not a derived one:
   * who dived with whom is exactly the question an investigator asks first,
   * and it is a fact the shop entered, so it belongs on this document — with
   * its recorder and timestamp, like every other fact here.
   *
   * `null` means no team was recorded, which the page states in words rather
   * than leaving blank — an unteamed diver is a normal boat, not a gap, and
   * plenty of shops record nothing at all.
   *
   * Deliberately names and not booking ids, matching the offline snapshot:
   * the document prints names, and ids are projected out of the hash anyway.
   *
   * The live manifest's split-team alert is deliberately not restated — and
   * "because it is derived" is *not* the reason (this document derives
   * `rollCallLabel`, the waiver's sign-once resolution, and every
   * `departureSummary` count). The reason is that `buddyAlertFor` collapses two
   * different facts into one code: a teammate a human recorded as not back
   * aboard, and a teammate with **no result recorded at all**. On a deck that
   * conflation is correct and urgent — both mean "go look". Afterwards
   * it would print a separation flag over what is usually an unfinished head
   * count, stating something louder than anyone actually recorded. The
   * per-checkpoint cells and the timeline carry both facts, distinctly.
   */
  buddy: IncidentBuddyPairing | null;
  /** One row per checkpoint, in sailing order — never omitted when unrecorded. */
  rollCall: IncidentRollCallResult[];
  /** Empty means "no certification evidence on file" — the UI must say so. */
  certifications: IncidentCertificationEvidence[];
  waiver: IncidentWaiverStatus;
};

export type IncidentCrewEntry = {
  fullName: string;
  /** Role codes as the roster holds them (effectiveCrewRoles). */
  roles: string[];
  rollCall: IncidentRollCallResult[];
  /**
   * The teams this crew member was recorded on, by number — plural, because one
   * divemaster commonly leads several groups on one boat
   * (ADR 20260804-buddy-teams). Empty means none was recorded; the page states
   * that in words like it does for a diver.
   */
  buddyTeamNumbers: number[];
};

export type IncidentTimelineEntry =
  | {
      kind: "diver" | "crew";
      occurredAt: string;
      checkpoint: string;
      subjectName: string;
      /** The stored event verbatim — `cleared` (a recorded correction) included. */
      action: "boarded" | "not_boarded" | "cleared";
      source: "live" | "offline";
      recordedByName: string;
      note: string | null;
    }
  /**
   * One act on a buddy team (ADR 20260804-buddy-teams). Buddy was the only fact
   * on this document with no corresponding timeline entry: a pairing could be
   * rewritten or erased after an incident with no mark, and cancelling the
   * missing diver's booking removed the pairing pointing at them as a side
   * effect. These entries close that.
   *
   * `memberNames` is the membership **as it stood at that moment**, denormalised
   * when the act was recorded — the roster section prints who is on a team
   * *now*, and a dissolved team has no now. Consecutive entries for one team
   * diff to who joined or left.
   *
   * `teamNumber` is 0 for a team that no longer stands: the roster's numbering
   * runs over standing teams only, so a dissolved one has no number to print
   * and the page says so rather than inventing one.
   */
  | {
      kind: "buddy_team";
      occurredAt: string;
      /** Pairing is a decision about the departure, not about a checkpoint. */
      checkpoint: null;
      action: "formed" | "dissolved" | "member_added" | "member_removed";
      teamNumber: number;
      memberNames: string[];
      recordedByName: string;
      note: null;
    };

export type IncidentExportDocument = {
  meta: {
    shopName: string;
    shopSlug: string;
    timezone: string;
    tripId: string;
    tripTitle: string;
    tripStartsAt: string;
    tripEndsAt: string;
    plannedDives: number;
    checkpoints: RollCallCheckpoint[];
    generatedAt: string;
    generatedByName: string;
  };
  /** Counts of records, not judgments: how many results of each kind stand at departure. */
  departureSummary: {
    totalDivers: number;
    boarded: number;
    notBoarded: number;
    awaiting: number;
    crewAssigned: number;
  };
  roster: IncidentRosterEntry[];
  crew: IncidentCrewEntry[];
  /** Every stored roll-call event and crew count, oldest first. Empty is stated by the UI. */
  timeline: IncidentTimelineEntry[];
  /**
   * SHA-256 (hex) over the canonical JSON of the document's **printed facts**,
   * shown in the footer. Tamper-*evidence*, not a signature: re-generating the
   * export from unchanged records reproduces the same hash, so two copies of
   * this document can be checked against each other, and an edited printout no
   * longer matches a fresh export. It proves nothing about who generated it.
   *
   * Internal row ids (`tripId`, `shopSlug`, `bookingId`) are excluded — they
   * are plumbing the page never prints, and they change when a shop's data is
   * exported and re-imported even though the facts a verifier compares do not.
   * See {@link incidentExportContentHash}.
   */
  contentHash: string;
};

export type IncidentTimelineEventInput = {
  subjectKind: "diver" | "crew";
  subjectName: string;
  checkpoint: string;
  status: "boarded" | "not_boarded" | "cleared";
  source: "live" | "offline";
  recordedByName: string;
  note: string | null;
  occurredAt: Date;
  createdAt: Date;
};

export type IncidentDiverEvidenceInput = {
  bookingId: string;
  certifications: readonly (Certification & { reviewedByName?: string | null })[];
  specialtyCertifications: readonly (SpecialtyCertification & { reviewedByName?: string | null })[];
  nitroxCertifications: readonly (NitroxCertification & { reviewedByName?: string | null })[];
  /** The governing record after the sign-once rule (`effectiveWaiverForBooking`), or null. */
  waiver: WaiverRecord | null;
  /** The staff member who attested the governing paper waiver, if any. */
  waiverRecordedByName?: string | null;
};

export type IncidentExportInput = {
  shop: { name: string; slug: string; timezone: string };
  /** Every checkpoint's manifest for the trip, in sailing order (`getTripManifests`). */
  manifests: readonly TripManifest[];
  /** Per-diver held evidence, keyed by booking id. A missing entry states absence. */
  diverEvidence: readonly IncidentDiverEvidenceInput[];
  events: readonly IncidentTimelineEventInput[];
  /**
   * The teams standing on this departure, in pairing order
   * (`listTripBuddyTeams`). One entry per team, not per member: the roster
   * prints each diver's *other* members, and the crew section prints the team
   * numbers a crew member is on, so both sides read off the same list and the
   * numbering can never disagree between them.
   *
   * Members whose seat was cancelled are expected to be filtered out by the
   * caller the same way the manifest filters them — this document states the
   * pairing as it stood for the people who were aboard.
   */
  buddyTeams?: readonly IncidentBuddyTeamInput[];
  /** The append-only pairing trail for this departure, oldest first. */
  buddyTeamEvents?: readonly IncidentBuddyTeamEventInput[];
  generatedAt: Date;
  generatedByName: string;
};

export type IncidentBuddyTeamInput = {
  teamId: string;
  members: ReadonlyArray<
    | { kind: "diver"; bookingId: string; fullName: string }
    | { kind: "crew"; personId: string; fullName: string }
  >;
  recordedByName: string | null;
  recordedAt: Date | null;
};

export type IncidentBuddyTeamEventInput = {
  teamId: string;
  action: "formed" | "dissolved" | "member_added" | "member_removed";
  memberNames: readonly string[];
  recordedByName: string;
  occurredAt: Date;
  createdAt: Date;
};

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function certificationEvidence(input: IncidentDiverEvidenceInput): IncidentCertificationEvidence[] {
  return [
    ...input.certifications.map((card) => ({
      kind: "level" as const,
      agency: card.agency,
      level: card.level,
      specialty: null,
      identifier: card.identifier,
      status: card.status,
      reviewedAt: iso(card.reviewedAt),
      reviewedByName: card.reviewedByName ?? null,
      imported: card.importedAt !== null,
      selfDeclared: isUnsightedSelfDeclaration(card),
    })),
    ...input.specialtyCertifications.map((card) => ({
      kind: "specialty" as const,
      agency: card.agency,
      level: null,
      specialty: card.specialty,
      identifier: card.identifier,
      status: card.status,
      reviewedAt: iso(card.reviewedAt),
      reviewedByName: card.reviewedByName ?? null,
      imported: card.importedAt !== null,
      // A specialty card is never self-declared: neither public form asks.
      selfDeclared: false,
    })),
    ...input.nitroxCertifications.map((card) => ({
      kind: "nitrox" as const,
      agency: card.agency,
      level: null,
      specialty: null,
      identifier: card.identifier,
      status: card.status,
      reviewedAt: iso(card.reviewedAt),
      reviewedByName: card.reviewedByName ?? null,
      imported: card.importedAt !== null,
      selfDeclared: isUnsightedSelfDeclaration(card),
    })),
  ];
}

function waiverStatus(
  record: WaiverRecord | null,
  now: Date,
  recordedByName: string | null | undefined,
): IncidentWaiverStatus {
  // The same fail-closed derivation readiness uses. A record parked in medical
  // review reads `medical_review` — a status, never the answers behind it.
  //
  // Defense in depth on supersession: the db layer already resolves the
  // governing record through `effectiveWaiverForBooking`, which never returns
  // a superseded completion — but if a caller ever hands one in anyway, it is
  // a signature that no longer stands and must read as the stated absence, not
  // as signed evidence on a document handed to an insurer.
  const state = record?.supersededAt ? "not_sent" : waiverState(record, now);
  if (!record || state === "not_sent") {
    return {
      state: "not_sent",
      signedAt: null,
      templateTitle: null,
      templateVersion: null,
      signatureMethod: null,
      recordedByName: null,
    };
  }
  return {
    state,
    signedAt: iso(record.signedAt ?? record.completedAt),
    templateTitle: record.templateTitle,
    templateVersion: record.templateVersion,
    signatureMethod: record.signatureMethod,
    recordedByName:
      record.signatureMethod === "in_person_attested" ? (recordedByName ?? null) : null,
  };
}

/** One roll-call line per checkpoint — a checkpoint with no result states `awaiting`. */
function rollCallResults(
  manifests: readonly TripManifest[],
  read: (
    manifest: TripManifest,
  ) => { rollCall?: TripManifest["divers"][number]["rollCall"] } | null,
): IncidentRollCallResult[] {
  return manifests.map((manifest) => {
    const rollCall = read(manifest)?.rollCall;
    return {
      checkpoint: manifest.checkpoint,
      label: rollCallLabel(manifest.checkpoint, rollCall),
      occurredAt: rollCall && !rollCall.implied ? rollCall.occurredAt.toISOString() : null,
      recordedByName: rollCall && !rollCall.implied ? rollCall.recordedByName : null,
      note: rollCall && !rollCall.implied ? rollCall.note : null,
    };
  });
}

/** Oldest first; `createdAt` breaks an `occurredAt` tie so replays order stably. */
function timelineOrder(
  a: { occurredAt: Date; createdAt: Date },
  b: { occurredAt: Date; createdAt: Date },
): number {
  return (
    a.occurredAt.getTime() - b.occurredAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime()
  );
}

export function buildIncidentExport(input: IncidentExportInput): IncidentExportDocument {
  const departure = input.manifests[0];
  if (!departure) throw new Error("buildIncidentExport: no departure manifest");
  const evidenceByBooking = new Map(input.diverEvidence.map((entry) => [entry.bookingId, entry]));

  // Teams number from their own list order, 1-based, and every surface on this
  // document reads the number off the same map — so the roster, the crew
  // section, and the timeline can never disagree about which team is which.
  const teams = input.buddyTeams ?? [];
  const teamNumberById = new Map(teams.map((team, index) => [team.teamId, index + 1] as const));
  const teamByBooking = new Map<string, IncidentBuddyTeamInput>();
  const teamNumbersByCrewId = new Map<string, number[]>();
  for (const team of teams) {
    for (const member of team.members) {
      if (member.kind === "diver") teamByBooking.set(member.bookingId, team);
      else {
        // Crew carry a *list*: one divemaster leading three groups is on three
        // teams, and this document must print all three.
        const numbers = teamNumbersByCrewId.get(member.personId) ?? [];
        numbers.push(teamNumberById.get(team.teamId) ?? 0);
        teamNumbersByCrewId.set(member.personId, numbers);
      }
    }
  }
  const pairingFor = (bookingId: string): IncidentBuddyPairing | null => {
    const team = teamByBooking.get(bookingId);
    if (!team) return null;
    const others = team.members.filter(
      (member) => member.kind !== "diver" || member.bookingId !== bookingId,
    );
    // A team reduced to this diver alone states nothing: there is no one to
    // name, and printing "Team 03" with an empty list would read as a gap.
    if (others.length === 0) return null;
    return {
      teamNumber: teamNumberById.get(team.teamId) ?? 0,
      members: others.map((member) => ({
        fullName: member.fullName,
        isCrew: member.kind === "crew",
      })),
      pairedByName: team.recordedByName,
      pairedAt: iso(team.recordedAt),
    };
  };

  // Every diver on the departure manifest is on this document — the manifest
  // derivation already refuses to filter anyone away, and so does this.
  const roster: IncidentRosterEntry[] = departure.divers.map((diver) => {
    const evidence = evidenceByBooking.get(diver.bookingId);
    return {
      bookingId: diver.bookingId,
      fullName: diver.fullName,
      emergencyContactName: diver.emergencyContactName,
      emergencyContactPhone: diver.emergencyContactPhone,
      buddy: pairingFor(diver.bookingId),
      rollCall: rollCallResults(
        input.manifests,
        (manifest) => manifest.divers.find((entry) => entry.bookingId === diver.bookingId) ?? null,
      ),
      // No evidence entry at all reads the same as empty evidence: an
      // explicit "nothing on file", never a crash and never a filtered row.
      certifications: evidence ? certificationEvidence(evidence) : [],
      waiver: waiverStatus(
        evidence?.waiver ?? null,
        input.generatedAt,
        evidence?.waiverRecordedByName,
      ),
    };
  });

  const crew: IncidentCrewEntry[] = departure.crew.map((member) => ({
    fullName: member.fullName,
    roles: member.roles,
    rollCall: rollCallResults(
      input.manifests,
      (manifest) => manifest.crew.find((entry) => entry.id === member.id) ?? null,
    ),
    buddyTeamNumbers: [...(teamNumbersByCrewId.get(member.id) ?? [])].sort((a, b) => a - b),
  }));

  const timeline: IncidentTimelineEntry[] = [
    ...input.events.map((event) => ({
      entry: {
        kind: event.subjectKind,
        occurredAt: event.occurredAt.toISOString(),
        checkpoint: event.checkpoint,
        subjectName: event.subjectName,
        action: event.status,
        source: event.source,
        recordedByName: event.recordedByName,
        note: event.note,
      } satisfies IncidentTimelineEntry,
      occurredAt: event.occurredAt,
      createdAt: event.createdAt,
    })),
    // The pairing trail, interleaved with the head count by time — a pairing
    // changed mid-day sits exactly where it happened relative to the boarding
    // it changed, which is the comparison an investigator makes.
    ...(input.buddyTeamEvents ?? []).map((event) => ({
      entry: {
        kind: "buddy_team" as const,
        occurredAt: event.occurredAt.toISOString(),
        checkpoint: null,
        action: event.action,
        teamNumber: teamNumberById.get(event.teamId) ?? 0,
        memberNames: [...event.memberNames],
        recordedByName: event.recordedByName,
        note: null,
      } satisfies IncidentTimelineEntry,
      occurredAt: event.occurredAt,
      createdAt: event.createdAt,
    })),
  ]
    .sort(timelineOrder)
    .map(({ entry }) => entry);

  const body = {
    meta: {
      shopName: input.shop.name,
      shopSlug: input.shop.slug,
      timezone: input.shop.timezone,
      tripId: departure.trip.id,
      tripTitle: departure.trip.title,
      tripStartsAt: departure.trip.startsAt.toISOString(),
      tripEndsAt: departure.trip.endsAt.toISOString(),
      plannedDives: departure.trip.plannedDives,
      checkpoints: input.manifests.map((manifest) => manifest.checkpoint),
      generatedAt: input.generatedAt.toISOString(),
      generatedByName: input.generatedByName,
    },
    departureSummary: {
      totalDivers: departure.summary.totalDivers,
      boarded: departure.summary.boarded,
      notBoarded: departure.summary.notBoarded,
      awaiting: departure.summary.awaiting,
      crewAssigned: departure.crew.length,
    },
    roster,
    crew,
    timeline,
  };

  return { ...body, contentHash: incidentExportContentHash(body) };
}

/**
 * SHA-256 over the document's canonical JSON — the facts, not the rendered
 * words, so the same records hash identically in every locale. Field order is
 * fixed by construction above (`JSON.stringify` preserves insertion order),
 * which is what makes the hash reproducible.
 *
 * Internal row ids are projected out before hashing: they never appear on the
 * printed document, so including them would make two visually identical
 * printouts "differ" — and a re-seeded or re-imported database would change
 * the code under a document whose every printed fact is unchanged. The hash
 * commits to exactly what a human can compare.
 */
export function incidentExportContentHash(
  body: Omit<IncidentExportDocument, "contentHash">,
): string {
  const { tripId: _tripId, shopSlug: _shopSlug, ...meta } = body.meta;
  const facts = {
    meta,
    departureSummary: body.departureSummary,
    roster: body.roster.map(({ bookingId: _bookingId, ...entry }) => entry),
    crew: body.crew,
    timeline: body.timeline,
  };
  return createHash("sha256").update(JSON.stringify(facts)).digest("hex");
}
