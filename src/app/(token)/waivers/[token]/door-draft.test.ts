import { describe, expect, it } from "vitest";
import type { waiverRecords } from "@/db/schema";
import { recordForDoor } from "./door-draft";

type WaiverRecord = typeof waiverRecords.$inferSelect;

const counter = "11111111-1111-4111-8111-111111111111";
const mailed = "22222222-2222-4222-8222-222222222222";

function drafted(via: string | null): WaiverRecord {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    draftSignerName: "Leo Diver",
    draftAcknowledged: true,
    draftMedicalAnswers: { q1: true },
    draftGuardian: {
      name: "Rosa",
      relationship: "parent",
      email: "rosa@dive.day",
      acknowledged: true,
    },
    draftShopAnswers: { q: "yes" },
    draftMedicalAlert: "stent",
    draftViaLinkId: via,
  } as unknown as WaiverRecord;
}

describe("recordForDoor (issue 4008)", () => {
  it("shows a draft on the door that saved it", () => {
    const record = drafted(counter);
    expect(recordForDoor(record, counter)).toBe(record);
  });

  it("withholds every draft field, ticks included, from another door", () => {
    expect(recordForDoor(drafted(counter), mailed)).toMatchObject({
      draftSignerName: null,
      draftAcknowledged: false,
      draftMedicalAnswers: null,
      draftGuardian: null,
      draftShopAnswers: null,
      draftMedicalAlert: null,
    });
  });

  it("withholds a draft the thread saved, and any draft from a page with no door", () => {
    expect(recordForDoor(drafted(null), mailed).draftGuardian).toBeNull();
    expect(recordForDoor(drafted(counter), null).draftSignerName).toBeNull();
  });
});
