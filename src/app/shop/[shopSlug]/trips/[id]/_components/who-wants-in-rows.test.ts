import { describe, expect, it } from "vitest";
import type { CertificationSummary } from "@/db/self-declared-cards";
import { staffTranslator } from "@/i18n/staff-messages";
import type { CertificationLevel, CertRequirementSource } from "@/lib/readiness";
import type { Waitlist } from "./types";
import { departureLeadRows } from "./who-wants-in-rows";

const t = staffTranslator("en-US");

function lead(
  id: string,
  fullName: string | null,
  askedAt: Date,
  over: Record<string, unknown> = {},
): Waitlist[number] {
  return {
    lead: {
      id,
      askedAt,
      askedBy: "diver",
      offeredAt: null,
      partySize: 1,
      personId: fullName ? `p-${id}` : null,
      parentLeadId: null,
      name: fullName ? null : "Snapshot Name",
      email: fullName ? null : "snap@example.com",
      ...over,
    } as unknown as Waitlist[number]["lead"],
    person: fullName
      ? ({ id: `p-${id}`, fullName, email: `${id}@example.com` } as Waitlist[number]["person"])
      : null,
  };
}

const requirement = (level: CertificationLevel): CertRequirementSource => ({
  minimumCertificationLevel: level,
  requiredSpecialties: [],
  requiresNitrox: false,
});

const openWater: CertificationSummary = {
  level: "open_water",
  levelSelfDeclared: false,
  noCertificationDeclared: false,
  nitrox: false,
  nitroxSelfDeclared: false,
  nitroxVerified: false,
  verifiedLevel: "open_water",
};

function rows(
  leads: Waitlist,
  summaries: Map<string, CertificationSummary> = new Map(),
  bar: CertRequirementSource | null = null,
) {
  return departureLeadRows({
    leads,
    certificationSummaries: summaries,
    departureRequirement: bar,
    t,
    locale: "en-US",
    timezone: "America/New_York",
  });
}

/** Date formatting may use a no-break space; the assertion is about the words. */
const plain = (text: string | undefined) => text?.replace(/\s/g, " ");

describe("departureLeadRows", () => {
  it("keeps the order people asked in and never lifts a name by fit (ADR 20260813)", () => {
    const out = rows(
      [
        lead("a", "Nora Quinn", new Date("2026-08-01T14:00:00Z")),
        lead("b", "Rafa Ortiz", new Date("2026-08-03T14:00:00Z")),
      ],
      new Map([
        ["p-a", { ...openWater, level: "instructor" }],
        ["p-b", openWater],
      ]),
      requirement("advanced_open_water"),
    );
    expect(out.map((row) => row.name)).toEqual(["Nora Quinn", "Rafa Ortiz"]);
    expect(out.map((row) => row.belowBar)).toEqual([false, true]);
  });

  it("says when they asked in the shop's zone, and the party only above one", () => {
    const [pair, single] = rows([
      lead("a", "Nora Quinn", new Date("2026-08-01T14:00:00Z"), { partySize: 2 }),
      lead("b", "Rafa Ortiz", new Date("2026-08-03T14:00:00Z")),
    ]);
    expect(plain(pair?.facts)).toBe("a@example.com · Asked Sat, Aug 1 · Party of 2");
    expect(single?.facts).not.toContain("Party");
  });

  it("calls the shop's own outreach an invitation, not an ask", () => {
    const [row] = rows([
      lead("a", "Cleo Park", new Date("2026-08-01T14:00:00Z"), {
        askedBy: "shop",
        parentLeadId: "request-1",
      }),
    ]);
    expect(plain(row?.facts)).toBe("a@example.com · Invited Sat, Aug 1 · from a request");
  });

  it("renders a person-less lead from its snapshot and weighs no card", () => {
    const [row] = rows([lead("a", null, new Date("2026-08-01T14:00:00Z"))]);
    expect(row).toMatchObject({ name: "Snapshot Name", email: "snap@example.com" });
    expect(row?.certification).toBeNull();
    expect(row?.belowBar).toBe(false);
  });

  it("marks a self-declared level unchecked and says a carded diver is under the bar", () => {
    const [unchecked] = rows(
      [lead("a", "Nora Quinn", new Date("2026-08-01T14:00:00Z"))],
      new Map([["p-a", { ...openWater, levelSelfDeclared: true }]]),
    );
    expect(unchecked?.certification).toEqual({
      text: "Open Water — unverified",
      unchecked: true,
    });
    const [under] = rows(
      [lead("a", "Nora Quinn", new Date("2026-08-01T14:00:00Z"))],
      new Map([["p-a", openWater]]),
      requirement("advanced_open_water"),
    );
    expect(under?.certification?.text).toBe("Open Water · below this departure’s minimum");
  });

  it("carries the offered stamp through", () => {
    const at = new Date("2026-08-02T10:00:00Z");
    const [row] = rows([
      lead("a", "Nora Quinn", new Date("2026-08-01T14:00:00Z"), { offeredAt: at }),
    ]);
    expect(row?.offeredAt).toBe(at);
  });
});
