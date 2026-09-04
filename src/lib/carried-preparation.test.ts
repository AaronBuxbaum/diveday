import { describe, expect, it } from "vitest";

import type { Certification } from "@/db/schema";
import { carriedPreparation } from "./carried-preparation";
import type { ShopWaiverStatus } from "./waivers";

/**
 * The rule behind the short list a diver reads on a day that did not happen
 * (issue #1197). Every case here is about **not overclaiming**: it renders
 * beside a cancellation, and a reassurance that turns out to be false is worse
 * than the silence it replaced.
 */
const SIGNED: ShopWaiverStatus = {
  state: "current",
  signedAt: new Date("2026-08-01T10:00:00Z"),
  expiresAt: new Date("2027-08-01T10:00:00Z"),
  medical: null,
};

const card = (status: Certification["status"]): Certification =>
  ({ status }) as unknown as Certification;

describe("carriedPreparation", () => {
  it("names everything the shop holds for a diver who had prepared", () => {
    expect(
      carriedPreparation({
        waiver: SIGNED,
        certifications: [card("verified")],
        hasRentalFit: true,
      }),
    ).toEqual(["waiver", "certification", "fit"]);
  });

  it("says nothing at all for a diver who had prepared nothing", () => {
    expect(
      carriedPreparation({
        waiver: { state: "none" },
        certifications: [],
        hasRentalFit: false,
      }),
    ).toEqual([]);
  });

  /**
   * **The defect the first version of this shipped with, caught before it did.**
   * That version read `readiness.blockers` and asked which families were
   * unblocked. A departure requiring no certification produces no certification
   * blocker — so a diver who has never shown this shop a card would have been
   * told, on the worst day of their trip, that their certification was safely on
   * file. The readiness engine answers "cleared for *that* boat"; this asks
   * "what does the shop have".
   */
  it("claims no card for a diver who never showed one, whatever the trip asked", () => {
    expect(
      carriedPreparation({
        waiver: SIGNED,
        certifications: [],
        hasRentalFit: false,
      }),
    ).toEqual(["waiver"]);
  });

  /**
   * A self-declared card is somebody's word for it and nobody at the shop has
   * seen anything (ADR 20260820-attested-at-booking-verified-at-boarding).
   * Saying it was kept would be the shop vouching for a claim it never checked.
   */
  it("claims no card on a pending one", () => {
    expect(
      carriedPreparation({
        waiver: SIGNED,
        certifications: [card("pending")],
        hasRentalFit: false,
      }),
    ).toEqual(["waiver"]);
  });

  it("finds the verified card beside the unverified ones", () => {
    expect(
      carriedPreparation({
        waiver: { state: "none" },
        certifications: [card("pending"), card("verified")],
        hasRentalFit: false,
      }),
    ).toEqual(["certification"]);
  });

  /**
   * `expired` means they sign again and `medical_review` is an open question,
   * not a thing kept. Neither is reassuring to read on the day a trip was
   * called off, and neither is true.
   */
  it.each([
    { state: "none" },
    { state: "expired", signedAt: new Date("2024-01-01T00:00:00Z") },
    { state: "medical_review", at: new Date("2026-08-02T00:00:00Z") },
  ] as ShopWaiverStatus[])("keeps no release in the $state state", (waiver) => {
    expect(
      carriedPreparation({ waiver, certifications: [card("verified")], hasRentalFit: true }),
    ).toEqual(["certification", "fit"]);
  });

  it("names sizes on their own, for a diver who did only that", () => {
    expect(
      carriedPreparation({
        waiver: { state: "none" },
        certifications: [],
        hasRentalFit: true,
      }),
    ).toEqual(["fit"]);
  });
});
