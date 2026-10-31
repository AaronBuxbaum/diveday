import { describe, expect, it } from "vitest";
import { normalizeImportKey } from "./import-key";

describe("normalizeImportKey", () => {
  it.each([
    [" Certification Level ", "certification_level"],
    ["Customer--Email", "customer_email"],
    ["équipement 42", "quipement_42"],
    ["...", ""],
    ["Already_normalized", "already_normalized"],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeImportKey(input)).toBe(expected);
  });
});
