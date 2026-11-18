import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deriveLabelKey, signPayload } from "@/lib/signed-token";
import { issueTestAssertion, verifyTestAssertion } from "./capture-assertion";

const keyA = Buffer.alloc(32, 11);
const keyB = Buffer.alloc(32, 22);
const claims = () => ({
  shopId: randomUUID(),
  actorId: randomUUID(),
  tripId: randomUUID(),
  bookingId: randomUUID(),
  generationId: randomUUID(),
  meetingId: randomUUID(),
  snapshotId: randomUUID(),
  issuedAt: 1_000,
  expiresAt: 1_600,
});

describe("unconnected test capture assertion", () => {
  it("binds every asserted identity and labels the outcome integrity-only", () => {
    const c = claims();
    const token = issueTestAssertion(c, "key-a", keyA);
    const result = verifyTestAssertion(token, new Map([["key-a", keyA]]), c, 1_001);
    expect(result).toEqual({ kind: "integrity_only", claims: c });
    for (const field of [
      "shopId",
      "actorId",
      "tripId",
      "bookingId",
      "generationId",
      "meetingId",
      "snapshotId",
    ] as const) {
      expect(
        verifyTestAssertion(
          token,
          new Map([["key-a", keyA]]),
          { ...c, [field]: randomUUID() },
          1_001,
        ),
      ).toBeNull();
    }
  });
  it("rejects tampering, unknown keys, unsupported formats and malformed input", () => {
    const c = claims();
    const token = issueTestAssertion(c, "key-a", keyA);
    const [version, kid, payload, signature] = token.split(".");
    expect(
      verifyTestAssertion(
        `${version}.${kid}.${payload}.${signature}A`,
        new Map([["key-a", keyA]]),
        c,
        1_001,
      ),
    ).toBeNull();
    expect(
      verifyTestAssertion(
        `v2.${kid}.${payload}.${signature}`,
        new Map([["key-a", keyA]]),
        c,
        1_001,
      ),
    ).toBeNull();
    expect(verifyTestAssertion(token, new Map([["key-a", keyB]]), c, 1_001)).toBeNull();
    expect(verifyTestAssertion(token, new Map(), c, 1_001)).toBeNull();
    expect(verifyTestAssertion("x".repeat(3000), new Map([["key-a", keyA]]), c, 1_001)).toBeNull();
  });
  it("enforces the exact expiry boundary and limits lifetime", () => {
    const c = claims();
    const token = issueTestAssertion(c, "key-a", keyA);
    expect(verifyTestAssertion(token, new Map([["key-a", keyA]]), c, 999)).toBeNull();
    expect(verifyTestAssertion(token, new Map([["key-a", keyA]]), c, 1_000)?.kind).toBe(
      "integrity_only",
    );
    expect(verifyTestAssertion(token, new Map([["key-a", keyA]]), c, 1_599)?.kind).toBe(
      "integrity_only",
    );
    expect(verifyTestAssertion(token, new Map([["key-a", keyA]]), c, 1_600)).toBeNull();
    expect(() => issueTestAssertion({ ...c, expiresAt: 2_000 }, "key-a", keyA)).toThrow();
  });
  it("allows an old verification key only while it remains in the supplied test keyring", () => {
    const c = claims();
    const token = issueTestAssertion(c, "old", keyA);
    expect(
      verifyTestAssertion(
        token,
        new Map([
          ["old", keyA],
          ["new", keyB],
        ]),
        c,
        1_001,
      )?.kind,
    ).toBe("integrity_only");
    expect(verifyTestAssertion(token, new Map([["new", keyB]]), c, 1_001)).toBeNull();
  });
  it("rejects modified payloads, altered key IDs and correctly signed noncanonical JSON", () => {
    const c = claims();
    const token = issueTestAssertion(c, "old", keyA);
    const [version, kid, encoded, signature] = token.split(".");
    const changed = Buffer.from(
      JSON.stringify([
        c.shopId,
        randomUUID(),
        c.tripId,
        c.bookingId,
        c.generationId,
        c.meetingId,
        c.snapshotId,
        c.issuedAt,
        c.expiresAt,
      ]),
    ).toString("base64url");
    expect(
      verifyTestAssertion(
        `${version}.${kid}.${changed}.${signature}`,
        new Map([["old", keyA]]),
        c,
        1_001,
      ),
    ).toBeNull();
    expect(
      verifyTestAssertion(
        `${version}.other.${encoded}.${signature}`,
        new Map([["other", keyA]]),
        c,
        1_001,
      ),
    ).toBeNull();
    const noncanonical = Buffer.from(
      ` ${Buffer.from(encoded ?? "", "base64url").toString("utf8")}`,
    ).toString("base64url");
    const message = `v1.old.${noncanonical}`;
    const correctMac = signPayload(
      deriveLabelKey(keyA.toString("hex"), "test-only-dock-capture-assertion-v1"),
      message,
    );
    expect(
      verifyTestAssertion(`${message}.${correctMac}`, new Map([["old", keyA]]), c, 1_001),
    ).toBeNull();
  });
  it("does not manufacture a meeting identifier when the asserted one is missing", () => {
    const original = { ...claims(), meetingId: "" };
    expect(() => issueTestAssertion(original, "key-a", keyA)).toThrow();
    expect(original.meetingId).toBe("");
  });
});
