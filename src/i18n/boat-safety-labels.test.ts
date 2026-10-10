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
    expect(boatSafetyNoticeText(en, kit({}))).toBe("AED: pads expire in 12 days");
    expect(
      boatSafetyNoticeText(
        en,
        kit({ label: "Flares", kind: "flares", clock: "expiry", expired: true, days: 3 }),
      ),
    ).toBe("Flares: expired 3 days ago");
    expect(boatSafetyNoticeText(en, kit({ days: 0 }))).toBe("AED: pads expire today");
    expect(
      boatSafetyNoticeText(en, {
        code: "paper",
        paper: "inspection",
        dueOn: "2026-10-01",
        expired: true,
        days: 1,
      }),
    ).toBe("Safety inspection overdue by 1 day");
    expect(
      boatSafetyNoticeText(en, {
        code: "kit_off_service",
        gearItemId: "u1",
        label: "O2 kit",
        kind: "o2_kit",
      }),
    ).toBe("O2 kit: flagged for service. Check before sailing.");
  });

  it("says booked before boarding and aboard once the crew are counting", () => {
    expect(
      boatSafetyNoticeText(en, {
        code: "over_certificate",
        passengers: 14,
        limit: 12,
        counted: false,
      }),
    ).toBe("14 people booked; the boat’s certificate allows 12.");
    expect(
      boatSafetyNoticeText(en, {
        code: "over_certificate",
        passengers: 13,
        limit: 12,
        counted: true,
      }),
    ).toBe("13 passengers aboard; the boat’s certificate allows 12.");
  });

  it("names the must-carry kit a hull lacks", () => {
    expect(boatSafetyNoticeText(en, { code: "kit_missing", kind: "o2_kit" })).toBe(
      "No emergency oxygen aboard",
    );
    expect(boatSafetyNoticeText(en, { code: "kit_missing", kind: "aed" })).toBe("No AED aboard");
  });

  it("names no country's authority", () => {
    // A shop in Cozumel or Dahab holds a certificate too, from somebody else.
    for (const notice of [
      { code: "over_certificate", passengers: 2, limit: 1, counted: false },
      { code: "paper", paper: "inspection", dueOn: "2026-10-01", expired: false, days: 4 },
      { code: "paper", paper: "inspection", dueOn: "2026-10-01", expired: true, days: 4 },
    ] satisfies BoatSafetyNotice[]) {
      expect(boatSafetyNoticeText(en, notice)).not.toMatch(/Coast Guard/);
      expect(boatSafetyNoticeText(es, notice)).not.toMatch(/Guardia Costera/);
    }
  });

  it("has a Spanish sentence for every one", () => {
    expect(boatSafetyNoticeText(es, kit({}))).toBe("AED: los parches vencen en 12 días");
    expect(boatSafetyNoticeText(es, kit({ clock: "aed_battery", expired: true, days: 1 }))).toBe(
      "AED: la batería venció hace 1 día",
    );
    expect(boatSafetyNoticeText(es, { code: "kit_missing", kind: "aed" })).toBe(
      "No hay DEA a bordo",
    );
    expect(
      boatSafetyNoticeText(es, {
        code: "kit_off_service",
        gearItemId: "u1",
        label: "Kit de O2",
        kind: "o2_kit",
      }),
    ).toBe("Kit de O2: marcado para mantenimiento. Revísalo antes de zarpar.");
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
    expect(boatSafetySection(en, { boatName: "Mantis I", notices: [] })).toBeNull();
    expect(boatSafetySection(en, null)).toBeNull();
    expect(
      boatSafetySection(en, {
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
