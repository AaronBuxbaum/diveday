import { describe, expect, it } from "vitest";
import {
  assembleDisputeSheet,
  DISPUTE_ACTIVITY_CODES,
  type DisputeSheetInput,
} from "./dispute-sheet";

const at = (hours: number) => new Date(Date.UTC(2026, 6, 18, hours, 0, 0));

function input(overrides: Partial<DisputeSheetInput> = {}): DisputeSheetInput {
  return {
    shopName: "Blue Mantis",
    timezone: "America/Belize",
    generatedAt: at(20),
    diverName: "Grace Halloran",
    identityHeld: false,
    trip: { title: "Two-Tank Reef", startsAt: at(14), plannedDives: 2 },
    order: {
      description: "Trip deposit",
      status: "paid",
      currency: "usd",
      totalCents: 5400,
      taxCents: 400,
      amountPaidCents: 5400,
      refundedCents: 0,
      createdAt: at(1),
      paidAt: at(2),
      lines: [{ description: "Trip deposit", kind: "deposit", quantity: 1, unitAmountCents: 5000 }],
    },
    waiver: {
      signedAt: at(3),
      signedName: "Grace Halloran",
      signatureMethod: "typed_consent",
      templateTitle: "Diving Release",
      templateVersion: 3,
    },
    arrivalEvents: [],
    rollCallEvents: [],
    activity: [],
    ...overrides,
  };
}

const roll = (
  checkpoint: string,
  status: "boarded" | "not_boarded" | "cleared",
  hours: number,
  seq = 1,
) => ({
  checkpoint,
  status,
  occurredAt: at(hours),
  createdAt: at(hours),
  seq,
  recordedByName: "Sam Reyes",
  source: "live" as const,
});

describe("assembleDisputeSheet: what may appear", () => {
  it("prints the signed waiver's date, name, method and version", () => {
    const sheet = assembleDisputeSheet(input());
    expect(sheet.waiver).toEqual({
      signedAt: at(3),
      signedName: "Grace Halloran",
      method: "online",
      templateTitle: "Diving Release",
      templateVersion: 3,
    });
  });

  it("never carries a medical field, even when the caller hands over a whole record", () => {
    // The loader selects six columns, so this cannot happen from there. It is
    // the test for the next caller who passes `select()` instead: the sheet is
    // built field by field and nothing the input carries beyond its type
    // survives.
    const wholeRecord = {
      signedAt: at(3),
      signedName: "Grace Halloran",
      signatureMethod: "typed_consent",
      templateTitle: "Diving Release",
      templateVersion: 3,
      status: "medical_review",
      medicalAnswers: {
        questionnaireId: "rstc",
        questionnaireVersion: 1,
        responses: { q3: true, q7: true },
      },
      draftMedicalAnswers: { responses: { q9: true } },
      medicalClearancePhysicianName: "Dr. Okafor",
      medicalClearedAt: at(5),
      medicalReviewRequired: true,
      tokenHash: "secret-hash",
    };
    const sheet = assembleDisputeSheet(input({ waiver: wholeRecord }));
    const printed = JSON.stringify(sheet);
    for (const leaked of [
      "medical",
      "Medical",
      "q3",
      "q7",
      "q9",
      "Okafor",
      "secret-hash",
      "questionnaire",
      "review",
    ]) {
      expect(printed).not.toContain(leaked);
    }
    // Positive pair: the signature itself is still there.
    expect(printed).toContain("Grace Halloran");
    expect(sheet.waiver?.templateVersion).toBe(3);
  });

  it("keeps medical and identity activity lines off the sheet and drops params beyond the names", () => {
    const sheet = assembleDisputeSheet(
      input({
        activity: [
          {
            code: "medical_clearance_opened",
            params: { actor: "Sam", diver: "Grace" },
            occurredAt: at(4),
            seq: 1,
          },
          {
            code: "record_exported",
            params: { actor: "Sam", diver: "Grace" },
            occurredAt: at(4),
            seq: 2,
          },
          {
            code: "note_added",
            params: { actor: "Sam", diver: "Grace" },
            occurredAt: at(4),
            seq: 3,
          },
          {
            code: "identity_confirmed",
            params: { actor: "Sam", diver: "Grace" },
            occurredAt: at(4),
            seq: 4,
          },
          { code: "redacted", params: {}, occurredAt: at(4), seq: 5 },
          { code: "not_a_code_yet", params: { actor: "Sam" }, occurredAt: at(4), seq: 6 },
          {
            code: "counter_check_in",
            params: {
              actor: "Sam",
              diver: "Grace",
              secret: "q3 answered yes",
              certCheck: "overridden",
            },
            occurredAt: at(13),
            seq: 7,
          },
        ],
      }),
    );
    expect(sheet.activity).toEqual([
      {
        code: "counter_check_in",
        params: { actor: "Sam", diver: "Grace Halloran" },
        at: at(13),
      },
    ]);
    expect(JSON.stringify(sheet)).not.toContain("q3 answered yes");
  });

  it("prints the sheet's diver, never the name a held seat's row was written with", () => {
    const sheet = assembleDisputeSheet(
      input({
        identityHeld: true,
        diverName: "Booked Stranger",
        activity: [
          {
            code: "payment_waived",
            params: { actor: "Sam", diver: "Matched Person" },
            occurredAt: at(2),
            seq: 1,
          },
          {
            code: "counter_check_in",
            params: { diver: "Matched Person" },
            occurredAt: at(3),
            seq: 2,
          },
          {
            code: "seat_self_cancelled",
            params: { actor: "Matched Person" },
            occurredAt: at(4),
            seq: 3,
          },
        ],
      }),
    );
    expect(JSON.stringify(sheet)).not.toContain("Matched Person");
    expect(sheet.activity.map((line) => line.params.diver)).toEqual([
      "Booked Stranger",
      "Booked Stranger",
    ]);
  });

  it("names the diver as the actor of their own cancel and drops lines about a second diver", () => {
    const sheet = assembleDisputeSheet(
      input({
        activity: [
          { code: "seat_self_cancelled", params: { actor: "Grace H." }, occurredAt: at(2), seq: 1 },
          {
            code: "party_seat_self_cancelled",
            params: { actor: "Lead Diver", diver: "Grace" },
            occurredAt: at(3),
            seq: 2,
          },
          { code: "seat_claimed", params: { actor: "Claimer" }, occurredAt: at(4), seq: 3 },
        ],
      }),
    );
    expect(sheet.activity).toEqual([
      { code: "seat_self_cancelled", params: { actor: "Grace Halloran" }, at: at(2) },
    ]);
  });

  it("only allows codes that exist in the activity registry", async () => {
    const { ACTIVITY_CODES } = await import("./activity");
    for (const code of DISPUTE_ACTIVITY_CODES) expect(ACTIVITY_CODES).toContain(code);
  });

  it("withholds the waiver on a seat whose identity is held, and shows an unsigned link as nothing", () => {
    expect(assembleDisputeSheet(input({ identityHeld: true })).waiver).toBeNull();
    expect(
      assembleDisputeSheet(
        input({
          waiver: {
            signedAt: null,
            signedName: null,
            signatureMethod: null,
            templateTitle: "Diving Release",
            templateVersion: 3,
          },
        }),
      ).waiver,
    ).toBeNull();
  });

  it("states an erased signer name as null rather than inventing one", () => {
    const sheet = assembleDisputeSheet(
      input({
        waiver: {
          signedAt: at(3),
          signedName: null,
          signatureMethod: "in_person_attested",
          templateTitle: "Diving Release",
          templateVersion: 3,
        },
      }),
    );
    expect(sheet.waiver).toMatchObject({ signedName: null, method: "counter" });
  });
});

describe("assembleDisputeSheet: roll call and check-in", () => {
  it("returns one row per planned checkpoint, recorded or not", () => {
    const sheet = assembleDisputeSheet(input());
    expect(sheet.rollCall.map((row) => [row.checkpoint, row.result])).toEqual([
      ["departure", "not_recorded"],
      ["after_dive_1", "not_recorded"],
      ["after_dive_2", "not_recorded"],
    ]);
  });

  it("reads the newest event at each checkpoint and lets a cleared one retract it", () => {
    const sheet = assembleDisputeSheet(
      input({
        rollCallEvents: [
          roll("departure", "not_boarded", 14, 1),
          roll("departure", "boarded", 14, 2),
          roll("after_dive_1", "boarded", 15, 3),
          roll("after_dive_1", "cleared", 16, 4),
          roll("after_dive_2", "not_boarded", 17, 5),
          roll("after_dive_9", "boarded", 17, 6),
        ],
      }),
    );
    expect(sheet.rollCall.map((row) => [row.checkpoint, row.result])).toEqual([
      ["departure", "boarded"],
      ["after_dive_1", "not_recorded"],
      ["after_dive_2", "not_boarded"],
    ]);
    expect(sheet.rollCall[0]).toMatchObject({ at: at(14), recordedByName: "Sam Reyes" });
    expect(sheet.rollCall[1]).toMatchObject({ at: null, recordedByName: null });
  });

  it("never carries a dock result forward to a checkpoint nobody recorded", () => {
    const sheet = assembleDisputeSheet(
      input({ rollCallEvents: [roll("departure", "not_boarded", 14)] }),
    );
    expect(sheet.rollCall.map((row) => row.result)).toEqual([
      "not_boarded",
      "not_recorded",
      "not_recorded",
    ]);
  });

  it("shows the standing arrival, and nothing once the desk took it back", () => {
    const arrived = {
      status: "arrived" as const,
      occurredAt: at(13),
      createdAt: at(13),
      seq: 1,
      recordedByName: "Lee Park",
      source: "live" as const,
    };
    expect(assembleDisputeSheet(input({ arrivalEvents: [arrived] })).checkIn).toEqual({
      at: at(13),
      recordedByName: "Lee Park",
      offline: false,
    });
    expect(
      assembleDisputeSheet(input({ arrivalEvents: [{ ...arrived, source: "offline" }] })).checkIn
        ?.offline,
    ).toBe(true);
    expect(
      assembleDisputeSheet(
        input({
          arrivalEvents: [arrived, { ...arrived, status: "cleared", occurredAt: at(13), seq: 2 }],
        }),
      ).checkIn,
    ).toBeNull();
    expect(assembleDisputeSheet(input()).checkIn).toBeNull();
  });

  it("lists the trail oldest first, as a story", () => {
    const sheet = assembleDisputeSheet(
      input({
        activity: [
          { code: "counter_check_in", params: { diver: "Grace" }, occurredAt: at(13), seq: 2 },
          {
            code: "payment_waived",
            params: { actor: "Sam", diver: "Grace" },
            occurredAt: at(1),
            seq: 1,
          },
        ],
      }),
    );
    expect(sheet.activity.map((line) => line.code)).toEqual(["payment_waived", "counter_check_in"]);
  });
});
