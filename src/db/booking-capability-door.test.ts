import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sourceFiles, stripComments } from "@/test/source";

/**
 * **A booking link reaches its row only through the token door** (issue #2711,
 * ADR 20261104-derived-booking-link-tokens). A link carries its row's id in the
 * clear, so a lookup written as "take the id, `where id = $1`" without the tag
 * check would make any id a key. `src/db/booking-capabilities.ts` is the one
 * module that turns a token into a row (`parseVerifiedCapabilityToken`, then
 * purpose and key version); no other source file may filter
 * `booking_capabilities` by its id.
 */
const ROOT = path.resolve(import.meta.dirname, "../..");
const DOOR = "src/db/booking-capabilities.ts";
const BY_ID = /\b(?:eq|inArray|ne)\(\s*(?:schema\.)?bookingCapabilities\.id\b/;

describe("the booking link door", () => {
  it("is the only module that filters booking_capabilities by id", () => {
    const offenders = sourceFiles(path.join(ROOT, "src"))
      .map((file) => path.relative(ROOT, file).split(path.sep).join("/"))
      .filter((file) => file !== DOOR)
      .filter((file) => BY_ID.test(stripComments(readFileSync(path.join(ROOT, file), "utf8"))));
    expect(offenders).toEqual([]);
  });

  it("still sees the door's own lookups, so the pattern matches what it guards", () => {
    expect(BY_ID.test(stripComments(readFileSync(path.join(ROOT, DOOR), "utf8")))).toBe(true);
  });
});
