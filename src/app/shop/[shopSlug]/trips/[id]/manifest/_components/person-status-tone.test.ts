import { describe, expect, it } from "vitest";
import { personStatusTone } from "./person-status-tone";

const none = {
  notBackAboard: false,
  boarded: false,
  recordedNotBoarded: false,
  impliedNotBoarded: false,
};

describe("personStatusTone", () => {
  it("keeps a person not back aboard in danger ink, whatever else is true", () => {
    expect(personStatusTone({ ...none, notBackAboard: true, recordedNotBoarded: true })).toBe(
      "danger",
    );
  });

  it("reads boarded as success, not boarded as warning, and nothing said as plain", () => {
    expect(personStatusTone({ ...none, boarded: true })).toBe("success");
    expect(personStatusTone({ ...none, recordedNotBoarded: true })).toBe("warning");
    expect(personStatusTone({ ...none, impliedNotBoarded: true })).toBe("warning");
    expect(personStatusTone(none)).toBe("neutral");
  });
});
