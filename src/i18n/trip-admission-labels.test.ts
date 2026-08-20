import { describe, expect, it } from "vitest";
import type { TripAdmissionRefusal } from "@/lib/trip-admission";
import { diverTranslator } from "./messages";
import { tripAdmissionRefusalText, tripRequirementList } from "./readiness-labels";
import { staffTranslator } from "./staff-messages";

/**
 * The copy this covers is a **safety-surface** refusal. One static sentence
 * used to cover every case — *"…don't reach what that trip and its dive sites
 * require. Add the missing card above."* — and on a level refusal that is both
 * false (there is no missing card; an Open Water diver is not an Advanced one)
 * and dangerous: it points a staffer at the certifications form as the way past
 * a cert gate, and a hand-entered card clears admission on the very next
 * attempt (H-24). These assertions are what keep the two cases apart.
 */
const t = staffTranslator("en-US");
const tEs = staffTranslator("es-ES");

function refusal(overrides: Partial<TripAdmissionRefusal> = {}): TripAdmissionRefusal {
  return {
    requiredLevel: null,
    heldLevel: null,
    missingSpecialties: [],
    nitroxRequired: false,
    ...overrides,
  };
}

describe("tripAdmissionRefusalText — a level refusal", () => {
  const levelRefusal = refusal({
    requiredLevel: "advanced_open_water",
    heldLevel: "open_water",
  });

  it("names both the requirement and what the diver actually holds", () => {
    const text = tripAdmissionRefusalText(t, levelRefusal, "en-US");
    expect(text).toContain("Advanced Open Water");
    // The held level is what makes a wrong record visible — without it the
    // staffer cannot tell a genuine gap from a mis-typed card.
    expect(text).toContain("Open Water");
    expect(text).toContain("course");
  });

  it("makes adding a card conditional on the diver holding one", () => {
    // Not "add the missing card" — there may be no card to add, and saying so
    // unconditionally is the invitation into the H-24 leak.
    expect(tripAdmissionRefusalText(t, levelRefusal, "en-US")).toContain("If they hold");
  });

  it("says something true when nothing on the record reaches the bar", () => {
    const text = tripAdmissionRefusalText(t, refusal({ requiredLevel: "rescue" }), "en-US");
    expect(text).toContain("Rescue Diver");
    expect(text).not.toContain("{held}");
  });

  it("speaks the reader's language", () => {
    expect(tripAdmissionRefusalText(tEs, levelRefusal, "es-ES")).toContain("Esta salida exige");
  });
});

describe("tripAdmissionRefusalText — a card refusal", () => {
  it("says the card is simply not on the record, which is where 'add it' is right", () => {
    const text = tripAdmissionRefusalText(t, refusal({ missingSpecialties: ["deep"] }), "en-US");
    expect(text).toContain("Deep");
    expect(text).toContain("none on this diver's record");
    // A specialty refusal never names a ladder rung — the diver's level is not
    // what is wrong (`heldLevel` is nulled for exactly this reason).
    expect(text).not.toContain("Open Water");
  });

  it("lists several missing cards as one locale-appropriate phrase", () => {
    const text = tripAdmissionRefusalText(
      t,
      refusal({ missingSpecialties: ["deep", "night"], nitroxRequired: true }),
      "en-US",
    );
    expect(text).toContain("Deep, Night, and Nitrox");
    expect(text).toContain("None of them");
  });

  it("renders both sentences when the ladder and a card both fail", () => {
    const text = tripAdmissionRefusalText(
      t,
      refusal({
        requiredLevel: "advanced_open_water",
        heldLevel: "open_water",
        missingSpecialties: ["deep"],
      }),
      "en-US",
    );
    expect(text).toContain("Advanced Open Water");
    expect(text).toContain("Deep");
  });

  it("falls back to the generic sentence rather than an empty banner", () => {
    expect(tripAdmissionRefusalText(t, refusal(), "en-US")).toBe(t("shared.tripAdmission.generic"));
  });
});

describe("tripRequirementList — what the trip asks of anybody", () => {
  const td = diverTranslator("en-US");

  it("is null when the trip demands nothing, so nothing renders", () => {
    expect(
      tripRequirementList(
        td,
        { minimumCertificationLevel: null, requiredSpecialties: [], requiresNitrox: false },
        "en-US",
      ),
    ).toBeNull();
  });

  it("names the level, the specialties, and nitrox as one phrase", () => {
    expect(
      tripRequirementList(
        td,
        {
          minimumCertificationLevel: "advanced_open_water",
          requiredSpecialties: ["deep"],
          requiresNitrox: true,
        },
        "en-US",
      ),
    ).toBe("Advanced Open Water or higher, a Deep certification, and a nitrox certification");
  });

  it("describes the trip and never the reader", () => {
    // H-22: this string is shown on an anonymous page and repeated back in a
    // refusal to an anonymous submitter, so it must be identical for everyone.
    const requirement = {
      minimumCertificationLevel: "rescue" as const,
      requiredSpecialties: [],
      requiresNitrox: false,
    };
    expect(tripRequirementList(td, requirement, "en-US")).toBe(
      tripRequirementList(td, requirement, "en-US"),
    );
  });

  it("speaks the reader's language", () => {
    expect(
      tripRequirementList(
        diverTranslator("es-ES"),
        {
          minimumCertificationLevel: "open_water",
          requiredSpecialties: ["night"],
          requiresNitrox: false,
        },
        "es-ES",
      ),
    ).toBe("Open Water o superior y certificación de Nocturno");
  });
});
