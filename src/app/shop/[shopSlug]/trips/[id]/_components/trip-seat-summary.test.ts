import { expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { tripSeatSummary } from "./trip-seat-summary";

it("distinguishes sellable seats from a known passenger certificate, without inventing one", () => {
  const t = staffTranslator("en-US");
  expect(tripSeatSummary(t, 3, 8, 12)).toBe("3 of 8 booked · Certificate: 12 passengers");
  expect(tripSeatSummary(t, 3, 8, null)).toBe("3 of 8 booked");
  expect(tripSeatSummary(staffTranslator("es-ES"), 3, 8, 1)).toContain("Certificado: 1 pasajero");
});
