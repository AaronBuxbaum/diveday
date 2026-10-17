import type { Certification, WaiverRecord } from "@/db/schema";
import type { IncidentExportInput } from "./incident-export";
import {
  buildTripManifest,
  type ManifestCrewMember,
  rollCallCheckpoints,
  type TripManifest,
} from "./manifests";

/** A manifest crew member with no emergency contact on file — the ordinary state. */
export const manifestCrew = (
  member: Omit<
    ManifestCrewMember,
    "emergencyContactName" | "emergencyContactPhone" | "standingRatings"
  > &
    Partial<
      Pick<ManifestCrewMember, "emergencyContactName" | "emergencyContactPhone" | "standingRatings">
    >,
): ManifestCrewMember => ({
  emergencyContactName: null,
  emergencyContactPhone: null,
  standingRatings: [],
  ...member,
});

export const TRIP = {
  id: "trip-1",
  title: "Two-Tank Reef",
  startsAt: new Date("2026-08-04T13:00:00.000Z"),
  endsAt: new Date("2026-08-04T18:00:00.000Z"),
  plannedDives: 2,
};

export const GENERATED_AT = new Date("2026-08-04T20:00:00.000Z");

export function diver(
  bookingId: string,
  fullName: string,
  rollCall?: TripManifest["divers"][number]["rollCall"],
) {
  return {
    bookingId,
    fullName,
    email: null,
    emergencyContactName: "Pat Reyes",
    emergencyContactPhone: "+1 555 0100",
    rentalFit: { state: "own_kit" as const },
    nitroxRequested: false,
    checkedIn: false,
    rollCall,
  };
}

/** All checkpoints of one trip, mirroring what getTripManifests hands the db layer. */
export function manifestsFor(
  divers: Parameters<typeof buildTripManifest>[0]["divers"],
  crew: Parameters<typeof buildTripManifest>[0]["crew"] = [],
): TripManifest[] {
  return rollCallCheckpoints(TRIP.plannedDives).map((checkpoint) =>
    buildTripManifest({ trip: TRIP, checkpoint, crew, divers }),
  );
}

export function completedWaiver(overrides: Partial<WaiverRecord> = {}): WaiverRecord {
  return {
    status: "completed",
    templateTitle: "Diving Release",
    templateVersion: 3,
    templateBody: "TEMPLATE-BODY-NEVER-EXPORTED",
    signedAt: new Date("2026-08-01T10:00:00.000Z"),
    completedAt: new Date("2026-08-01T10:00:00.000Z"),
    signatureMethod: null,
    supersededAt: null,
    medicalAnswers: {
      questionnaireId: "rstc",
      questionnaireVersion: 1,
      responses: { heartCondition: "MEDICAL-ANSWER-NEVER-EXPORTED" },
    },
    ...overrides,
  } as WaiverRecord;
}

export function verifiedCard(overrides: Partial<Certification> = {}): Certification {
  return {
    agency: "padi",
    level: "advanced_open_water",
    identifier: "AB-1234",
    status: "verified",
    reviewedAt: new Date("2026-07-20T09:00:00.000Z"),
    importedAt: null,
    ...overrides,
  } as Certification;
}

export function baseInput(overrides: Partial<IncidentExportInput> = {}): IncidentExportInput {
  const boarded = {
    state: "boarded" as const,
    occurredAt: new Date("2026-08-04T12:45:00.000Z"),
    recordedByName: "Captain Sol",
    note: null,
  };
  return {
    shop: { name: "Blue Mantis", slug: "blue-mantis", timezone: "America/New_York" },
    manifests: manifestsFor(
      [diver("b1", "Ana Diaz", boarded), diver("b2", "Ben Cho")],
      [manifestCrew({ id: "p9", fullName: "Sol Marin", roles: ["captain"], rollCall: boarded })],
    ),
    diverEvidence: [
      {
        bookingId: "b1",
        certifications: [verifiedCard()],
        specialtyCertifications: [],
        nitroxCertifications: [],
        waiver: completedWaiver(),
      },
    ],
    events: [
      {
        subjectKind: "diver",
        subjectName: "Ana Diaz",
        checkpoint: "departure",
        status: "boarded",
        source: "live",
        recordedByName: "Captain Sol",
        occurredAt: new Date("2026-08-04T12:45:00.000Z"),
        createdAt: new Date("2026-08-04T12:45:00.000Z"),
      },
    ],
    generatedAt: GENERATED_AT,
    generatedByName: "Rae Owner",
    ...overrides,
  };
}
