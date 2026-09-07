import { describe, expect, it } from "vitest";
import type { WaiverRecord } from "@/db/schema";
import { redactCapabilityUrl } from "@/lib/capability-urls";
import {
  foldKnownDiverFacts,
  HANDOFF_TTL_MS,
  handoffHref,
  type KnownDiverSources,
  NEVER_HANDED_OFF,
} from "./booking-handoff";

const NOW = new Date("2026-09-06T14:00:00Z");
const AUG_27 = new Date("2026-08-27T15:10:00Z");

function waiver(overrides: Partial<WaiverRecord> = {}): WaiverRecord {
  return {
    status: "completed",
    signedAt: AUG_27,
    completedAt: AUG_27,
    supersededAt: null,
    signatureMethod: "typed",
    templateGeneration: 3,
    templateVersion: 3,
    medicalClearedAt: null,
    medicalAnswers: { chestPain: true },
    ...overrides,
  } as unknown as WaiverRecord;
}

function sources(overrides: Partial<KnownDiverSources> = {}): KnownDiverSources {
  return {
    certifications: [
      {
        level: "open_water",
        status: "verified",
        reviewedAt: new Date("2026-05-02T10:00:00Z"),
        importedAt: null,
        createdAt: new Date("2026-05-01T10:00:00Z"),
      },
      {
        level: "advanced_open_water",
        status: "verified",
        reviewedAt: AUG_27,
        importedAt: null,
        createdAt: AUG_27,
      },
      {
        level: "rescue",
        status: "pending",
        reviewedAt: null,
        importedAt: null,
        createdAt: AUG_27,
      },
    ],
    waivers: [waiver()],
    currentTemplateGeneration: 3,
    rentalFit: {
      rentsBcd: true,
      rentsRegulator: true,
      rentsWetsuit: true,
      rentsMaskFins: false,
      rentsWeights: true,
      bcdSize: "M",
      wetsuitSize: "5mm M",
      bootSize: null,
      finSize: null,
      fitStatedAt: AUG_27,
      updatedAt: NOW,
    },
    emergencyContact: { name: "Tomás Reyes", phone: "+1 305 555 0101" },
    now: NOW,
    ...overrides,
  };
}

function keysAtAnyDepth(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) keysAtAnyDepth(item, into);
  else if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [key, inner] of Object.entries(value)) {
      into.add(key);
      keysAtAnyDepth(inner, into);
    }
  }
  return into;
}

/** ADR 20260906-before-you-ask, decision 3: the door remembers who opened it. */
describe("foldKnownDiverFacts", () => {
  it("folds the four standing facts the canvas drew, each with the day it was kept", () => {
    expect(foldKnownDiverFacts(sources())).toEqual([
      { kind: "card", level: "advanced_open_water", keptAt: AUG_27 },
      { kind: "waiver", keptAt: AUG_27 },
      { kind: "sizes", keptAt: AUG_27 },
      { kind: "contact", name: "Tomás Reyes" },
    ]);
  });

  it("names only a card a staffer verified — a pending one is not a fact", () => {
    const facts = foldKnownDiverFacts(
      sources({
        certifications: [
          {
            level: "rescue",
            status: "pending",
            reviewedAt: null,
            importedAt: null,
            createdAt: AUG_27,
          },
        ],
      }),
    );
    expect(facts.some((fact) => fact.kind === "card")).toBe(false);
  });

  it("drops a waiver the current release no longer covers, and a referral nobody cleared", () => {
    expect(
      foldKnownDiverFacts(sources({ currentTemplateGeneration: 4 })).some(
        (fact) => fact.kind === "waiver",
      ),
    ).toBe(false);
    expect(
      foldKnownDiverFacts(sources({ waivers: [waiver({ status: "medical_review" })] })).some(
        (fact) => fact.kind === "waiver",
      ),
    ).toBe(false);
  });

  it("says own gear when the diver rents nothing, and nothing when no size was kept", () => {
    const own = foldKnownDiverFacts(
      sources({
        rentalFit: {
          ...(sources().rentalFit as NonNullable<KnownDiverSources["rentalFit"]>),
          rentsBcd: false,
          rentsRegulator: false,
          rentsWetsuit: false,
          rentsMaskFins: false,
        },
      }),
    );
    expect(own).toContainEqual({ kind: "own_gear", keptAt: AUG_27 });
    const bare = foldKnownDiverFacts(
      sources({
        rentalFit: {
          ...(sources().rentalFit as NonNullable<KnownDiverSources["rentalFit"]>),
          bcdSize: null,
          wetsuitSize: null,
        },
      }),
    );
    expect(bare.some((fact) => fact.kind === "sizes" || fact.kind === "own_gear")).toBe(false);
  });

  it("carries nothing on the never-list: no medical answer, no phone, no card number", () => {
    const keys = keysAtAnyDepth(foldKnownDiverFacts(sources()));
    for (const banned of NEVER_HANDED_OFF) expect(keys.has(banned)).toBe(false);
  });

  it("is empty for a diver the shop holds nothing about", () => {
    expect(
      foldKnownDiverFacts({
        certifications: [],
        waivers: [],
        currentTemplateGeneration: 3,
        rentalFit: null,
        emergencyContact: { name: null, phone: null },
        now: NOW,
      }),
    ).toEqual([]);
  });
});

describe("handoff", () => {
  it("lives ten minutes and rides the booking page's own path", () => {
    expect(HANDOFF_TTL_MS).toBe(10 * 60 * 1000);
    expect(handoffHref("/s/blue-mantis/trips/abc", "t/k+n")).toBe(
      "/s/blue-mantis/trips/abc?handoff=t%2Fk%2Bn",
    );
  });

  it("never reaches telemetry raw: the query key is on the redaction list", () => {
    const href = handoffHref("/s/blue-mantis/trips/abc", "secret-token");
    expect(redactCapabilityUrl(href)).toBe("/s/blue-mantis/trips/abc?handoff=%5Btoken%5D");
    expect(redactCapabilityUrl(href)).not.toContain("secret-token");
  });
});
