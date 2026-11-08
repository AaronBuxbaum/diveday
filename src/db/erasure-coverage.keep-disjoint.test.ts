import { describe, expect, it } from "vitest";
import { ERASURE_KEEPS } from "../test/substrate-fixtures/db/erasure-coverage-keeps.test-support";
import { OUTSIDE_CLOSURE_REASONS } from "../test/substrate-fixtures/db/erasure-outside-closure-classification.test-support";

describe("erasure coverage, the two classifications", () => {
  it("never lists a table both as a keep and as outside the closure", () => {
    const both = Object.keys(ERASURE_KEEPS).filter((name) => name in OUTSIDE_CLOSURE_REASONS);
    expect(both.sort()).toEqual([]);
  });
});
