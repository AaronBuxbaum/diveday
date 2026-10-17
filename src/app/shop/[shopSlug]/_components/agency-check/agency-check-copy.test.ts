import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { agencyCheckCopies } from "./agency-check-copy";

/** Domain review R4 (adversarial) 2: "nobody found" names what each agency was searched by. */
describe("agencyCheckCopy's no-record words", () => {
  it("names what each agency was searched by, and sends a CMAS diver to their federation", () => {
    const copies = agencyCheckCopies(staffTranslator("en-US"));
    expect(copies.ssi.noRecord).toBe("SSI has no match for this card number.");
    expect(copies.gue.noRecord).toBe("GUE has no match for this card number.");
    expect(copies.naui.noRecord).toBe("NAUI has no match for this name and birth date.");
    expect(copies.padi.noRecord).toBe("PADI has no match for this name and birth date.");
    expect(copies.cmas.noRecord).toBe(
      "The CMAS portal doesn’t list this certification. Federations are still adding theirs, so ask the federation named on the card.",
    );
  });

  it("says the same in Spanish", () => {
    const copies = agencyCheckCopies(staffTranslator("es-ES"));
    expect(copies.ssi.noRecord).toContain("número de certificación");
    expect(copies.cmas.noRecord).toContain("federación");
  });
});
