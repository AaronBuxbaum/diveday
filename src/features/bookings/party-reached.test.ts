import { describe, expect, it } from "vitest";
import { partyReachedParam, readPartyReached } from "./party-reached";

const A = "0b0c6f2e-6a51-4c47-9d6f-5f1f0d6f9a01";
const B = "1b0c6f2e-6a51-4c47-9d6f-5f1f0d6f9a02";
const C = "2b0c6f2e-6a51-4c47-9d6f-5f1f0d6f9a03";

describe("party reached parameter", () => {
  it("carries each reached seat's channels and leaves out the seats nothing reached", () => {
    const param = partyReachedParam([
      { bookingId: A, reached: ["sms", "email"] },
      { bookingId: B, reached: [] },
      { bookingId: C, reached: ["whatsapp"] },
    ]);
    expect(param).toBe(`${A}.es,${C}.w`);
    const read = readPartyReached(param);
    expect(read?.get(A)).toEqual(["email", "sms"]);
    expect(read?.has(B)).toBe(false);
    expect(read?.get(C)).toEqual(["whatsapp"]);
  });

  it("reads an empty parameter as a party nobody could be reached in", () => {
    expect(partyReachedParam([{ bookingId: A, reached: [] }])).toBe("");
    expect(readPartyReached("")?.size).toBe(0);
  });

  it("reads no parameter as a landing not reached from an add", () => {
    expect(readPartyReached(undefined)).toBeNull();
  });

  it("skips an entry that is not a booking id and channel letters", () => {
    const read = readPartyReached(`${A}.e,not-an-id.e,${B}.x,${C}.,<script>`);
    expect([...(read?.keys() ?? [])]).toEqual([A]);
  });
});
