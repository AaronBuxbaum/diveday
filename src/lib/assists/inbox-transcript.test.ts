import { describe, expect, it } from "vitest";
import type { CallTranscript } from "@/lib/claude/transcript";
import { HEALTH_ANSWER_NOT_KEPT, HEALTH_MESSAGE_NOT_KEPT, keepUnlessHealth } from "./inbox";

const QUESTION = "Diver: I’m 14 weeks pregnant, can I still do Saturday’s boat?";

function transcript(answer: string | null): CallTranscript {
  return {
    system: "Draft.",
    context: "<facts>\nSaturday reef, 4 seats\n</facts>",
    content: `<thread>\n${QUESTION}\n</thread>`,
    answer,
    fetchedUrls: null,
  };
}

describe("keepUnlessHealth", () => {
  it("keeps a call that is not about health whole", () => {
    const kept = transcript(
      JSON.stringify({ reply: "Yes, 4 seats.", medical: false, eligibility: false, confidence: 1 }),
    );
    expect(keepUnlessHealth(kept)).toEqual(kept);
  });

  it("keeps no thread for a health question, and an answer that quotes nothing", () => {
    const answer = JSON.stringify({ reply: "", medical: true, eligibility: false, confidence: 1 });
    const kept = keepUnlessHealth(transcript(answer));
    expect(kept.content).toBe(HEALTH_MESSAGE_NOT_KEPT);
    expect(kept.answer).toBe(answer);
    expect(kept.context).toContain("Saturday reef");
    expect(JSON.stringify(kept)).not.toContain("pregnant");
  });

  it("drops an answer whose reply could quote the question back", () => {
    const answer = JSON.stringify({
      reply: "Congratulations on 14 weeks! A staff member will call.",
      medical: true,
      eligibility: false,
      confidence: 1,
    });
    const kept = keepUnlessHealth(transcript(answer));
    expect(kept).toMatchObject({
      content: HEALTH_MESSAGE_NOT_KEPT,
      answer: HEALTH_ANSWER_NOT_KEPT,
    });
    expect(JSON.stringify(kept)).not.toContain("14 weeks");
  });

  it("treats an answer it cannot parse that says medical the same way", () => {
    const kept = keepUnlessHealth(transcript('{"reply":"About your pregnancy","medical": true,'));
    expect(kept).toMatchObject({
      content: HEALTH_MESSAGE_NOT_KEPT,
      answer: HEALTH_ANSWER_NOT_KEPT,
    });
  });
});
