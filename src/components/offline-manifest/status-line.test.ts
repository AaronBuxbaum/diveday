import { describe, expect, it } from "vitest";
import { offlineDiverStatusLine } from "./status-line";

const quiet = {
  stateWord: "To call",
  blockerTexts: null,
  blockedWord: "Blocked",
  notHereWord: null,
  medicalWord: null,
  medicalAlertWord: null,
  participantWord: null,
  lateWord: null,
};

describe("offlineDiverStatusLine", () => {
  it("says the roll-call state alone for a diver with nothing else to say", () => {
    expect(offlineDiverStatusLine(quiet)).toBe("To call");
  });

  it("keeps a blocked diver blocked: every saved reason, after the state", () => {
    expect(
      offlineDiverStatusLine({
        ...quiet,
        stateWord: "Boarded",
        blockerTexts: ["Waiver not signed", "Certification not verified"],
      }),
    ).toBe("Boarded · Waiver not signed · Certification not verified");
  });

  it("says the blocked word when a block was saved with no reason, never nothing", () => {
    expect(offlineDiverStatusLine({ ...quiet, blockerTexts: [] })).toBe("To call · Blocked");
  });

  it("drops no fact the chips carried, in their order", () => {
    expect(
      offlineDiverStatusLine({
        stateWord: "Not back aboard",
        blockerTexts: ["Medical review open"],
        blockedWord: "Blocked",
        notHereWord: "Not here",
        medicalWord: "Riding only",
        medicalAlertWord: "Medical alert",
        participantWord: "Snorkeler",
        lateWord: "Running late since 7:10 AM",
      }),
    ).toBe(
      "Not back aboard · Medical review open · Not here · Riding only · Medical alert · Snorkeler · Running late since 7:10 AM",
    );
  });

  it("never says the saved-copy qualifier: the banner says it once", () => {
    expect(offlineDiverStatusLine({ ...quiet, notHereWord: "Not here" })).not.toMatch(/when saved/);
  });
});
