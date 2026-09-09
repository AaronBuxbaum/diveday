import { describe, expect, it } from "vitest";
import {
  CALL_OUTCOMES,
  type CallCapture,
  type CallOutcome,
  callOutcomeNeeds,
  callRefusal,
  isCallOutcome,
} from "./took-a-call";

/** Everything a call needs for every outcome, so a test can take one thing away. */
function complete(): CallCapture {
  return {
    fullName: "Adaeze Nwosu",
    email: "adaeze@example.com",
    phone: "+1 305 555 0143",
    tripId: "3f0d8f4e-1f4f-4a2a-9f4e-1f4f4a2a9f4e",
    interest: "Two-tank reef in March",
  };
}

describe("isCallOutcome", () => {
  it("accepts every outcome the form can offer", () => {
    for (const outcome of CALL_OUTCOMES) expect(isCallOutcome(outcome)).toBe(true);
  });

  it("refuses anything else a query string could carry", () => {
    for (const value of ["", "booking ", "BOOKING", "constructor", null, undefined, 3, {}]) {
      expect(isCallOutcome(value)).toBe(false);
    }
  });
});

describe("callRefusal", () => {
  it("writes a complete call of any kind", () => {
    for (const outcome of CALL_OUTCOMES) expect(callRefusal(outcome, complete())).toBeNull();
  });

  it("refuses a caller with no name, whatever they wanted", () => {
    for (const outcome of CALL_OUTCOMES) {
      expect(callRefusal(outcome, { ...complete(), fullName: "   " })).toBe("name");
    }
  });

  /**
   * The rule that is about the lead rather than the table underneath it: a
   * shop that cannot ring back has recorded a conversation, not a lead.
   */
  it("refuses a caller with neither an address nor a number", () => {
    for (const outcome of CALL_OUTCOMES) {
      expect(callRefusal(outcome, { ...complete(), email: "", phone: null })).toBe("reply");
    }
  });

  it("takes a phone number as the whole reply path for a request or a booking", () => {
    for (const outcome of ["date-request", "booking"] as const) {
      expect(callRefusal(outcome, { ...complete(), email: null })).toBeNull();
    }
  });

  /** A wait-list entry with no address has nobody to invite when a seat frees. */
  it("insists on an address for a wait-list entry even when a number is on file", () => {
    expect(callRefusal("waitlist", { ...complete(), email: null })).toBe("email");
  });

  it("insists on a departure for the two outcomes that name one", () => {
    expect(callRefusal("waitlist", { ...complete(), tripId: null })).toBe("departure");
    expect(callRefusal("booking", { ...complete(), tripId: "" })).toBe("departure");
    expect(callRefusal("date-request", { ...complete(), tripId: null })).toBeNull();
  });

  /** `course_inquiries`' own check constraint, said before the database says it. */
  it("insists a date request is about something", () => {
    expect(callRefusal("date-request", { ...complete(), interest: "  " })).toBe("interest");
    expect(callRefusal("booking", { ...complete(), interest: null })).toBeNull();
  });

  /**
   * Top to bottom, the order the staffer reads the form in: reporting the last
   * refusal first would send them back up the page for the next one.
   */
  it("reports the earliest missing answer first", () => {
    expect(callRefusal("waitlist", {})).toBe("name");
    expect(callRefusal("waitlist", { fullName: "Adaeze Nwosu" })).toBe("reply");
    expect(callRefusal("waitlist", { fullName: "Adaeze Nwosu", phone: "305" })).toBe("email");
  });
});

describe("callOutcomeNeeds", () => {
  it("agrees with the refusals it drives", () => {
    const requirements: Record<CallOutcome, string[]> = {
      "date-request": ["interest"],
      waitlist: ["departure", "email"],
      booking: ["departure"],
    };
    for (const outcome of CALL_OUTCOMES) {
      for (const requirement of ["departure", "email", "interest"] as const) {
        expect(callOutcomeNeeds(outcome, requirement)).toBe(
          requirements[outcome].includes(requirement),
        );
      }
    }
  });
});
