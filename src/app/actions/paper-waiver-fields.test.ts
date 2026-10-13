import { describe, expect, it } from "vitest";
import { paperWaiverAttestation } from "./paper-waiver-fields";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe("paperWaiverAttestation", () => {
  it("reads the medical tick only when the box was ticked", () => {
    expect(paperWaiverAttestation(form({ medicalAttested: "on" })).medicalAttested).toBe(true);
    expect(paperWaiverAttestation(form({})).medicalAttested).toBe(false);
    expect(paperWaiverAttestation(form({ medicalAttested: "true" })).medicalAttested).toBe(false);
  });

  it("carries no guardian for an adult's form", () => {
    expect(paperWaiverAttestation(form({ medicalAttested: "on" })).guardian).toBeUndefined();
  });

  it("carries the co-signer as typed, namesake confirmation included", () => {
    const attestation = paperWaiverAttestation(
      form({
        guardianName: " Ana Ruiz ",
        guardianRelationship: "parent",
        guardianNamesakeAttested: "on",
      }),
    );
    expect(attestation.guardian).toEqual({
      name: " Ana Ruiz ",
      relationship: "parent",
      namesakeAttested: true,
    });
  });
});
