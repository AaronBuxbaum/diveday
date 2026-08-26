import { describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import {
  CONSERVATION_COMMITMENT_CODES,
  conservationCommitmentLabel,
  isConservationCommitmentCode,
  parseConservationCommitments,
} from "./conservation-commitments";

describe("conservation commitments", () => {
  it("contains 8 defined commitment codes", () => {
    expect(CONSERVATION_COMMITMENT_CODES).toHaveLength(8);
  });

  it("validates commitment codes correctly", () => {
    expect(isConservationCommitmentCode("green_fins_member")).toBe(true);
    expect(isConservationCommitmentCode("padi_aware_partner")).toBe(true);
    expect(isConservationCommitmentCode("random_code")).toBe(false);
    expect(isConservationCommitmentCode(null)).toBe(false);
  });

  it("parses, filters, deduplicates, and preserves canonical ordering", () => {
    const raw = [
      "coral_nursery_support",
      "padi_aware_partner",
      "padi_aware_partner",
      "invalid_badge",
      "green_fins_member",
    ];
    const parsed = parseConservationCommitments(raw);
    expect(parsed).toEqual(["green_fins_member", "padi_aware_partner", "coral_nursery_support"]);
  });

  it("returns empty array for non-array inputs", () => {
    expect(parseConservationCommitments(null)).toEqual([]);
    expect(parseConservationCommitments("green_fins_member")).toEqual([]);
  });

  it("translates commitment labels into English and Spanish", () => {
    const enT = diverTranslator("en-US");
    const esT = diverTranslator("es-ES");

    expect(conservationCommitmentLabel("green_fins_member", enT)).toBe("Green Fins member");
    expect(conservationCommitmentLabel("green_fins_member", esT)).toBe("Miembro de Green Fins");

    expect(conservationCommitmentLabel("no_touch_policy", enT)).toBe("No-touch reef policy");
    expect(conservationCommitmentLabel("no_touch_policy", esT)).toBe(
      "Política de no tocar el arrecife",
    );
  });
});
