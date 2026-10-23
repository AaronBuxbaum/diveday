import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { waiverRecords } from "./schema";
import {
  CLEARED_DRAFT_COLUMNS,
  WAIVER_SEALED_COLUMNS,
  WAIVER_STATE_COLUMNS,
} from "./waiver-record-columns";

/**
 * The two narrowed reads of a waiver record. What matters is what they leave
 * out: a status read never sees the release text, and neither read can hand a
 * bearer link or an unsigned draft back out.
 */
describe("waiver record column sets", () => {
  const neverRead = [
    "tokenHash",
    "tokenSealed",
    "draftSignerName",
    "draftMedicalAnswers",
    "draftGuardian",
    "draftShopAnswers",
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
        "integrityHash",
        "integrityVersion",
      ]),
    );
  });

  it("keeps the release text and the seal out of the status read", () => {
    const state = Object.keys(WAIVER_STATE_COLUMNS);
    for (const column of [...neverRead, "templateBody", "shopAnswers", "integrityHash"]) {
      expect(state).not.toContain(column);
    }
  });

  // Security review M1: a repoint once cleared every draft column but the
  // newest one. Every writer that moves or strips a pending link spreads this
  // one object, so a draft column added later fails here first.
  it("lists every draft column the schema has, so a moved or erased link keeps none", () => {
    const drafts = Object.keys(getTableColumns(waiverRecords))
      .filter((column) => column.startsWith("draft"))
      .sort();
    expect(Object.keys(CLEARED_DRAFT_COLUMNS).sort()).toEqual(drafts);
    for (const [column, value] of Object.entries(CLEARED_DRAFT_COLUMNS)) {
      expect(value, column).toBe(column === "draftAcknowledged" ? false : null);
    }
  });
});
