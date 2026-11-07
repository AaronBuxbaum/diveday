import { describe, expect, it } from "vitest";
import { WAIVER_SEALED_COLUMNS, WAIVER_STATE_COLUMNS } from "./waiver-record-columns";

/**
 * The two narrowed reads of a waiver record. What matters is what they leave
 * out: a status read never sees the release text, and neither read can hand a
 * bearer link or an unsigned draft back out.
 */
describe("waiver record column sets", () => {
  const neverRead = [
    "tokenHash",
    "draftSignerName",
    "draftMedicalAnswers",
    "draftGuardian",
    "draftShopAnswers",
    "draftMedicalAlert",
  ];

  it("keeps the bearer token and the unsigned draft out of the sealed read", () => {
    const sealed = Object.keys(WAIVER_SEALED_COLUMNS);
    for (const column of neverRead) expect(sealed).not.toContain(column);
    // What a seal covers and the seal itself are there.
    expect(sealed).toEqual(
      expect.arrayContaining([
        "templateBody",
        "signedName",
        "shopAnswers",
        "medicalAlert",
        "integrityHash",
        "integrityVersion",
      ]),
    );
  });

  it("keeps the release text and the seal out of the status read", () => {
    const state = Object.keys(WAIVER_STATE_COLUMNS);
    for (const column of [
      ...neverRead,
      "templateBody",
      "shopAnswers",
      // Medical-class text: only its own predicate-guarded readers (issue #2960).
      "medicalAlert",
      "integrityHash",
    ]) {
      expect(state).not.toContain(column);
    }
  });
});
