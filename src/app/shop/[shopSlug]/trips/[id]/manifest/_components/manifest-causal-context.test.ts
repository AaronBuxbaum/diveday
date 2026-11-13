import { expect, it } from "vitest";
import type { RollCallCausalContext } from "@/lib/roll-call-causality";
import { manifestCausalContexts } from "./manifest-causal-context";

it("retains each diver and crew member's observed evidence from the same manifest", () => {
  const diver: RollCallCausalContext = {
    meetingDay: 2,
    observedEvidenceIds: ["client:diver"],
    conflict: false,
    orderingUnknown: false,
    unknownMeetingDay: false,
    evidence: [],
  };
  const crew: RollCallCausalContext = {
    meetingDay: 3,
    observedEvidenceIds: ["server:crew"],
    conflict: true,
    orderingUnknown: true,
    unknownMeetingDay: false,
    evidence: [],
  };
  const contexts = manifestCausalContexts({
    divers: [{ bookingId: "b1", rollCallContext: diver }, { bookingId: "b2" }],
    crew: [{ id: "c1", rollCallContext: crew }, { id: "c2" }],
  });
  expect(contexts).toEqual({ "bookingId:b1": diver, "personId:c1": crew });
  expect(contexts["bookingId:b1"]).toBe(diver);
  expect(contexts["personId:c1"]).toBe(crew);
});
