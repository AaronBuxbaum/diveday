import { describe, expect, it } from "vitest";
import { buildStructuredRequest, callStructured } from "@/lib/claude/structured";
import { fakeClaude, fakeClaudeMessage } from "@/test/fakes";
import { askFields, type BookingAsk, bookingAskCall } from "./booking-request";

const ask: BookingAsk = {
  fullName: "Jen Smith",
  email: "Jen@Example.com",
  phone: "305 555 0110",
  preferredDate: "2026-10-24",
  divers: 4,
  interest: "Saturday morning boat: 2 Open Water, 1 Advanced, 1 never dived; nitrox",
  callback: "after 5",
  confidence: 0.9,
};

describe("bookingAskCall", () => {
  it("sends today and the ask as tagged data on the quick model", () => {
    const request = buildStructuredRequest(
      bookingAskCall({
        text: "jen smith 3 ppl sat am wants nitrox call back after 5",
        source: "call",
        today: "2026-10-22 (Thursday)",
      }),
    );
    expect(request.model).toBe("claude-haiku-5-5");
    expect(request.messages[0]?.content).toBe(
      "<today>2026-10-22 (Thursday)</today>\n\nA staff member's note from a phone call:\n<ask>\njen smith 3 ppl sat am wants nitrox call back after 5\n</ask>",
    );
  });

  it("drops a low-confidence reading", async () => {
    const provider = fakeClaude({
      reply: () => fakeClaudeMessage({ text: JSON.stringify({ ...ask, confidence: 0.3 }) }),
    });
    const result = await callStructured(
      provider,
      bookingAskCall({ text: "hello", source: "email", today: "2026-10-22 (Thursday)" }),
    );
    expect(result.value).toBeNull();
  });
});

describe("askFields", () => {
  it("fills the Took a call form as a date request, by its own control names", () => {
    expect(askFields(ask, "2026-10-22")).toEqual({
      outcome: "date-request",
      fullName: "Jen Smith",
      email: "jen@example.com",
      phone: "305 555 0110",
      preferredDate: "2026-10-24",
      divers: "4",
      interest: "Saturday morning boat: 2 Open Water, 1 Advanced, 1 never dived; nitrox",
    });
  });

  it("leaves blank what the form would refuse, rather than fill it wrong", () => {
    expect(
      askFields(
        {
          ...ask,
          email: "not an email",
          phone: "call me",
          preferredDate: "2026-10-21",
          divers: 40,
          interest: "x".repeat(201),
        },
        "2026-10-22",
      ),
    ).toEqual({ outcome: "date-request", fullName: "Jen Smith" });
    expect(
      askFields({ ...ask, preferredDate: "2026-02-30", divers: 2.5 }, "2026-01-01"),
    ).not.toHaveProperty("preferredDate");
  });

  it("is only the outcome when the text named nothing", () => {
    expect(
      askFields(
        {
          fullName: null,
          email: null,
          phone: null,
          preferredDate: null,
          divers: null,
          interest: null,
          callback: null,
          confidence: 1,
        },
        "2026-10-22",
      ),
    ).toEqual({ outcome: "date-request" });
  });
});
