import { describe, expect, it } from "vitest";
import { PRESENCE_LABEL_KEYS, presenceText } from "./presence-labels";
import { staffTranslator } from "./staff-messages";

describe("presenceText", () => {
  it("says the arrived word once, in each locale", () => {
    expect(PRESENCE_LABEL_KEYS.arrived).toBe("shared.presence.arrived");
    expect(presenceText(staffTranslator("en-US"), "arrived")).toBe("Checked in");
    expect(presenceText(staffTranslator("es-ES"), "arrived")).toBe("Registrado");
  });

  it("says the rail's two answers once, in each locale", () => {
    expect(presenceText(staffTranslator("en-US"), "boarded")).toBe("Boarded");
    expect(presenceText(staffTranslator("es-ES"), "not_boarded")).toBe("No embarcado");
  });
});
