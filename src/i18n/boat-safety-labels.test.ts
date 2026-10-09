import { describe, expect, it } from "vitest";
import type { BoatSafetyNotice } from "@/lib/boat-safety";
import { boatSafetyNoticeText } from "./boat-safety-labels";
import { staffTranslator } from "./staff-messages";

const en = staffTranslator("en-US");
const es = staffTranslator("es-ES");

const kit = (overrides: Partial<Extract<BoatSafetyNotice, { code: "kit_clock" }>>) =>
  ({
    code: "kit_clock",
    gearItemId: "u1",
    label: "AED",
    clock: "aed_pads",
    dueOn: "2026-10-21",
    expired: false,
    days: 12,
    ...overrides,
  }) as const;

describe("boatSafetyNoticeText", () => {
  it("words the pre-departure check's lines the way a crew says them", () => {
    expect(boatSafetyNoticeText(en, kit({}))).toBe("AED: pads expire in 12 days");
    expect(
      boatSafetyNoticeText(en, kit({ label: "Flares", clock: "expiry", expired: true, days: 3 })),
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
    ).toBe("Coast Guard inspection overdue by 1 day");
    expect(boatSafetyNoticeText(en, { code: "over_certificate", aboard: 14, limit: 12 })).toBe(
      "14 people booked aboard; the Coast Guard certificate allows 12.",
    );
    expect(
      boatSafetyNoticeText(en, { code: "kit_off_service", gearItemId: "u1", label: "O2 kit" }),
    ).toBe("O2 kit: off the boat for service");
  });

  it("has a Spanish sentence for every one", () => {
    expect(boatSafetyNoticeText(es, kit({}))).toBe("AED: los parches vencen en 12 días");
    expect(boatSafetyNoticeText(es, kit({ clock: "aed_battery", expired: true, days: 1 }))).toBe(
      "AED: la batería venció hace 1 día",
    );
  });
});
