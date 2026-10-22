import { describe, expect, it } from "vitest";
import type { DateLeadInReach } from "@/db/lead-dates";
import type { AnytimeRecipient } from "@/db/leads";
import type { CertificationSummary } from "@/db/self-declared-cards";
import { staffTranslator } from "@/i18n/staff-messages";
import type { CertificationLevel, CertRequirementSource } from "@/lib/readiness";
import type { Waitlist } from "./types";
import {
  anytimeLeadRows,
  dateLeadRows,
  departureLeadRows,
  whoWantsInSources,
} from "./who-wants-in-rows";

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

function dateLead(id: string, over: Partial<DateLeadInReach> = {}): DateLeadInReach {
  return {
    id,
    courseId: null,
    courseTitle: null,
    interest: "night dive",
    personId: null,
    name: "Eli Moss",
    email: "eli@example.com",
    phone: null,
    experienceLevel: null,
    timing: null,
    preferredDate: "2026-10-24",
    alternateDate: "2026-10-25",
    dateFlexible: false,
    partySize: 3,
    message: null,
    askedAt: new Date("2026-10-03T14:00:00Z"),
    closedAt: null,
    closedAs: null,
    match: "preferred",
    departureLeadId: null,
    offeredAt: null,
    ...over,
  } as DateLeadInReach;
}

function dateRows(leads: DateLeadInReach[], summaries = new Map<string, CertificationSummary>()) {
  return dateLeadRows({
    leads,
    certificationSummaries: summaries,
    departureRequirement: null,
    t,
    locale: "en-US",
  });
}

describe("dateLeadRows", () => {
  it("reads a person-less request from its snapshot: name, address, dates, party, interest", () => {
    const [row] = dateRows([dateLead("d1")]);
    expect(row).toMatchObject({ leadId: "d1", name: "Eli Moss", email: "eli@example.com" });
    expect(plain(row?.facts)).toBe(
      "eli@example.com · Oct 24, 2026 or Oct 25, 2026 · Party of 3 · night dive",
    );
    expect(row?.certification).toBeNull();
    expect(row?.offeredAt).toBeNull();
  });

  it("says flexible, quotes a long message once, and names a request with no name", () => {
    const [row] = dateRows([
      dateLead("d1", {
        name: null,
        email: null,
        dateFlexible: true,
        alternateDate: null,
        partySize: 1,
        interest: null,
        message: "x".repeat(80),
      }),
    ]);
    expect(row?.name).toBe("No name given");
    expect(row?.facts).toContain("no email");
    expect(row?.facts).toContain("flexible");
    expect(row?.facts).toContain(`wrote “${"x".repeat(60)}…”`);
  });

  it("weighs the card of a request that matched a diver", () => {
    const [row] = dateRows(
      [dateLead("d1", { personId: "p-1", name: "Eli Moss" })],
      new Map([["p-1", openWater]]),
    );
    expect(row?.certification?.text).toBe("Open Water");
  });

  it("carries the offered stamp of its departure child", () => {
    const at = new Date("2026-10-20T10:00:00Z");
    const [row] = dateRows([dateLead("d1", { departureLeadId: "c1", offeredAt: at })]);
    expect(row?.offeredAt).toBe(at);
  });
});

function recipient(id: string, fullName: string, level?: CertificationSummary): AnytimeRecipient {
  return {
    lead: {
      id,
      availableFrom: "2026-10-10",
      availableUntil: "2026-10-20",
    } as AnytimeRecipient["lead"],
    person: { id: `p-${id}`, fullName, email: `${id}@example.com` } as AnytimeRecipient["person"],
    certification: level ?? null,
  };
}

function anytime(recipients: AnytimeRecipient[], bar: CertRequirementSource | null, limit = 10) {
  return anytimeLeadRows({
    recipients,
    offeredAtByPerson: new Map(),
    departureRequirement: bar,
    limit,
    t,
    locale: "en-US",
  });
}

describe("anytimeLeadRows", () => {
  it("prints the window they are around, and an open window as any day", () => {
    const [row] = anytime([recipient("a", "Fay Ng", openWater)], null).shown;
    expect(plain(row?.facts)).toContain("a@example.com · Oct 10 – 20, 2026");
    const open = recipient("b", "Gus Ode");
    open.lead = { ...open.lead, availableFrom: null, availableUntil: null };
    expect(anytime([open], null).shown[0]?.facts).toContain("Any day");
  });

  it("lifts a name under the bar to the top and caps the preview, keeping the rest", () => {
    const instructor = { ...openWater, level: "instructor" as const };
    const many = [
      ...Array.from({ length: 11 }, (_, index) =>
        recipient(`i${index}`, `Instructor ${index}`, instructor),
      ),
      recipient("rav", "Ravi Menon", openWater),
    ];
    const out = anytime(many, requirement("rescue"));
    expect(out.shown).toHaveLength(10);
    expect(out.shown[0]?.name).toBe("Ravi Menon");
    expect(out.shown[0]?.belowBar).toBe(true);
    expect(out.more).toHaveLength(2);
  });
});

describe("whoWantsInSources", () => {
  const departureLead = (
    id: string,
    personId: string,
    over: Record<string, unknown> = {},
  ): Waitlist[number] =>
    lead(id, "Nora Quinn", new Date("2026-08-01T14:00:00Z"), { personId, ...over });

  it("leaves an attached but unoffered date lead to its child row in the first group", () => {
    const out = whoWantsInSources({
      departureLeads: [departureLead("c1", "p-x", { parentLeadId: "d1" })],
      dateLeads: [dateLead("d1", { departureLeadId: "c1" }), dateLead("d2")],
      anytimeRecipients: [],
    });
    expect(out.dateLeads.map((row) => row.id)).toEqual(["d2"]);
    expect(out.departureLeads).toHaveLength(1);
  });

  it("draws an offered date or anytime lead once, in its own group, reading offered", () => {
    const at = new Date("2026-10-20T10:00:00Z");
    const out = whoWantsInSources({
      departureLeads: [
        departureLead("c1", "p-x", { parentLeadId: "d1", offeredAt: at }),
        departureLead("c2", "p-a1", { parentLeadId: "a1", offeredAt: at }),
        departureLead("c3", "p-gus", { parentLeadId: null }),
      ],
      dateLeads: [dateLead("d1", { departureLeadId: "c1", offeredAt: at })],
      anytimeRecipients: [
        recipient("a1", "Fay Ng"),
        // Wait-listing here already: the first group has them.
        { ...recipient("a2", "Gus Ode"), person: { id: "p-gus" } as AnytimeRecipient["person"] },
      ],
    });
    expect(out.dateLeads.map((row) => row.id)).toEqual(["d1"]);
    expect(out.anytimeRecipients.map(({ lead }) => lead.id)).toEqual(["a1"]);
    expect(out.offeredAtByPerson.get("p-a1")).toBe(at);
    expect(out.departureLeads.map(({ lead }) => lead.id)).toEqual(["c3"]);
  });
});
