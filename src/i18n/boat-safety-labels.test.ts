import { describe, expect, it } from "vitest";
import type { BoatSafetyNotice } from "@/lib/boat-safety";
import {
  boatSafetyHeadingText,
  boatSafetyNoticeText,
  boatSafetySection,
} from "./boat-safety-labels";
import { staffTranslator } from "./staff-messages";

const en = staffTranslator("en-US");
const es = staffTranslator("es-ES");

const kit = (
  overrides: Partial<Extract<BoatSafetyNotice, { code: "kit_clock" }>>,
): BoatSafetyNotice => ({
  code: "kit_clock",
  gearItemId: "u1",
  label: "AED",
  kind: "aed",
  clock: "aed_pads",
  dueOn: "2026-10-21",
  expired: false,
  days: 12,
  ...overrides,
});

describe("boatSafetyNoticeText", () => {
  it("words the pre-departure check's lines the way a crew says them", () => {
    expect(boatSafetyNoticeText(en, "en-US", kit({}))).toBe("AED: pads expire in 12 days");
    expect(
      boatSafetyNoticeText(
        en,
        "en-US",
        kit({ label: "Flares", kind: "flares", clock: "expiry", expired: true, days: 3 }),
      ),
    ).toBe("Flares: expired 3 days ago");
    expect(boatSafetyNoticeText(en, "en-US", kit({ days: 0 }))).toBe("AED: pads expire today");
    expect(
      boatSafetyNoticeText(en, "en-US", {
        code: "paper",
        paper: "inspection",
        dueOn: "2026-10-01",
        expired: true,
        days: 1,
      }),
    ).toMatch(/^Safety inspection was due Oct\s1,\s2026$/);
    expect(
      boatSafetyNoticeText(en, "en-US", {
        code: "kit_off_service",
        gearItemId: "u1",
        label: "O2 kit",
        kind: "o2_kit",
      }),
    ).toBe("O2 kit: flagged for service. Check before sailing.");
  });

  it("says booked before boarding and aboard once the crew are counting", () => {
    expect(
      boatSafetyNoticeText(en, "en-US", {
        code: "over_certificate",
        passengers: 14,
        limit: 12,
        counted: false,
      }),
    ).toBe("14 people booked; the boat’s certificate allows 12.");
    expect(
      boatSafetyNoticeText(en, "en-US", {
        code: "over_certificate",
        passengers: 13,
        limit: 12,
        counted: true,
      }),
    ).toBe("13 passengers aboard; the boat’s certificate allows 12.");
  });

  it("names the must-carry kit a hull lacks", () => {
    expect(boatSafetyNoticeText(en, "en-US", { code: "kit_missing", kind: "o2_kit" })).toBe(
      "No emergency oxygen aboard",
    );
    expect(boatSafetyNoticeText(en, "en-US", { code: "kit_missing", kind: "aed" })).toBe(
      "No AED aboard",
    );
  });

  it("names no country's authority", () => {
    // A shop in Cozumel or Dahab holds a certificate too, from somebody else.
    for (const notice of [
      { code: "over_certificate", passengers: 2, limit: 1, counted: false },
      { code: "paper", paper: "inspection", dueOn: "2026-10-01", expired: false, days: 4 },
      { code: "paper", paper: "inspection", dueOn: "2026-10-01", expired: true, days: 4 },
    ] satisfies BoatSafetyNotice[]) {
      expect(boatSafetyNoticeText(en, "en-US", notice)).not.toMatch(/Coast Guard/);
      expect(boatSafetyNoticeText(es, "es-ES", notice)).not.toMatch(/Guardia Costera/);
    }
  });

  it("has a Spanish sentence for every one", () => {
    expect(boatSafetyNoticeText(es, "es-ES", kit({}))).toBe("AED: los parches vencen en 12 días");
    expect(
      boatSafetyNoticeText(es, "es-ES", kit({ clock: "aed_battery", expired: true, days: 1 })),
    ).toBe("AED: la batería venció hace 1 día");
    expect(boatSafetyNoticeText(es, "es-ES", { code: "kit_missing", kind: "aed" })).toBe(
      "No hay DEA a bordo",
    );
    expect(
      boatSafetyNoticeText(es, "es-ES", {
        code: "kit_off_service",
        gearItemId: "u1",
        label: "Kit de O2",
        kind: "o2_kit",
      }),
    ).toBe("Kit de O2: marcado para mantenimiento. Revísalo antes de zarpar.");
  });
});

/** A lapsed paper names the day it ran out, in the reader's own order (H-20261015-lapsed-boat-papers-loud). */
describe("a lapsed paper", () => {
  const lapsed = (paper: "inspection" | "registration" | "insurance"): BoatSafetyNotice => ({
    code: "paper",
    paper,
    dueOn: "2026-10-08",
    expired: true,
    days: 8,
  });

  it("says when each paper ran out", () => {
    // The date is one unit (U+00A0 inside, `keepUnitsWhole`), so `\s`.
    expect(boatSafetyNoticeText(en, "en-US", lapsed("insurance"))).toMatch(
      /^Hull insurance ended Oct\s8,\s2026$/,
    );
    expect(boatSafetyNoticeText(en, "en-US", lapsed("registration"))).toMatch(
      /^Registration ended Oct\s8,\s2026$/,
    );
    expect(boatSafetyNoticeText(es, "es-ES", lapsed("insurance"))).toMatch(
      /^Seguro del casco: venció el 8\soct\.?\s2026$/,
    );
  });

  it("says a paper still good today ends before a later departure, never that it ended", () => {
    const ahead = (paper: "inspection" | "registration" | "insurance"): BoatSafetyNotice => ({
      code: "paper",
      paper,
      dueOn: "2026-11-01",
      expired: true,
      days: 19,
      beforeDeparture: true,
    });
    expect(boatSafetyNoticeText(en, "en-US", ahead("insurance"))).toMatch(
      /^Hull insurance ends Nov\s1,\s2026, before this departure$/,
    );
    expect(boatSafetyNoticeText(en, "en-US", ahead("registration"))).toMatch(
      /^Registration ends Nov\s1,\s2026, before this departure$/,
    );
    expect(boatSafetyNoticeText(en, "en-US", ahead("inspection"))).toMatch(
      /^Safety inspection due Nov\s1,\s2026, before this departure$/,
    );
    expect(boatSafetyNoticeText(es, "es-ES", ahead("insurance"))).toMatch(
      /^Seguro del casco: vence el 1\snov\.?\s2026, antes de esta salida$/,
    );
  });

  it("is a danger line in the boat's section", () => {
    expect(
      boatSafetySection(en, "en-US", { boatName: "Mantis I", notices: [lapsed("insurance")] }),
    ).toEqual({
      heading: "Mantis I: papers and safety kit",
      lines: [
        { text: expect.stringMatching(/^Hull insurance ended Oct\s8,\s2026$/), tone: "danger" },
      ],
    });
  });
});

describe("boatSafetyHeadingText", () => {
  it("names the hull and what the lines are about", () => {
    expect(boatSafetyHeadingText(en, "Mantis I")).toBe("Mantis I: papers and safety kit");
    expect(boatSafetyHeadingText(es, "Mantis I")).toBe(
      "Mantis I: documentación y equipo de seguridad",
    );
  });
});

describe("boatSafetySection", () => {
  it("words the heading and tones each line, and is null with nothing to say", () => {
    expect(boatSafetySection(en, "en-US", { boatName: "Mantis I", notices: [] })).toBeNull();
    expect(boatSafetySection(en, "en-US", null)).toBeNull();
    expect(
      boatSafetySection(en, "en-US", {
        boatName: "Mantis I",
        notices: [{ code: "kit_missing", kind: "aed" }, kit({})],
      }),
    ).toEqual({
      heading: "Mantis I: papers and safety kit",
      lines: [
        { text: "No AED aboard", tone: "danger" },
        { text: "AED: pads expire in 12 days", tone: "neutral" },
      ],
    });
  });
});

// #2302: the total-persons line and the certificate's own expiry, both locales.
describe("boatSafetyNoticeText and the certificate's second limit", () => {
  const over = (counted: boolean): BoatSafetyNotice => ({
    code: "over_total_persons",
    persons: 13,
    limit: 12,
    counted,
  });

  it("says the crew are in the count, booked and aboard", () => {
    expect(boatSafetyNoticeText(en, "en-US", over(false))).toBe(
      "13 people booked or named as crew; the certificate allows 12 in all.",
    );
    expect(boatSafetyNoticeText(en, "en-US", over(true))).toBe(
      "13 people aboard, crew included; the certificate allows 12 in all.",
    );
    expect(boatSafetyNoticeText(es, "es-ES", over(true))).toBe(
      "13 personas a bordo con la tripulación; el certificado permite 12 en total.",
    );
  });

  it("names the certificate's expiry apart from the inspection", () => {
    const coi = (expired: boolean, days: number): BoatSafetyNotice => ({
      code: "paper",
      paper: "coi",
      dueOn: "2026-10-01",
      expired,
      days,
    });
    expect(boatSafetyNoticeText(en, "en-US", coi(false, 30))).toBe(
      "Boat certificate expires in 30 days",
    );
    expect(boatSafetyNoticeText(en, "en-US", coi(true, 2))).toMatch(
      /^Boat certificate expired Oct\s1,\s2026$/,
    );
    expect(boatSafetyNoticeText(es, "es-ES", coi(true, 2))).toMatch(
      /^Certificado del barco: venció el 1\soct\.?\s2026$/,
    );
  });
});
