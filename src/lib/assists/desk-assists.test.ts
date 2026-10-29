import { describe, expect, it } from "vitest";
import { callStructured } from "@/lib/claude/structured";
import { fakeClaude, fakeClaudeMessage } from "@/test/fakes";
import { RENTAL_NOTE_SYSTEM, rentalNoteCall, rentalNoteFields } from "./rental-note";
import { samePersonCall, samePersonRead } from "./same-person";

function answering(value: unknown) {
  return fakeClaude({ reply: () => fakeClaudeMessage({ text: JSON.stringify(value) }) });
}

describe("gear note", () => {
  it("fills only the boxes the shop offers, sizes only", async () => {
    const provider = answering({
      bcdSize: "M",
      wetsuitSize: "L",
      drysuitSize: null,
      hoodSize: null,
      gloveSize: null,
      bootSize: null,
      finSize: "10",
      weightPreference: null,
    });
    const result = await callStructured(
      provider,
      rentalNoteCall("Men's L wetsuit, size 10 fins, I wear glasses"),
    );
    expect(rentalNoteFields(result.value, new Set(["wetsuitSize", "finSize"]))).toEqual({
      wetsuitSize: "L",
      finSize: "10",
    });
  });

  it("fills only empty boxes, and never the lead", () => {
    const offered = new Set(["wetsuitSize", "finSize", "bootSize", "weightPreference"]);
    expect(
      rentalNoteFields(
        { wetsuitSize: "L", finSize: "10", bootSize: "9", weightPreference: "6 kg" },
        offered,
        { wetsuitSize: "M", finSize: " ", bootSize: "" },
      ),
    ).toEqual({ finSize: "10", bootSize: "9" });
    expect(RENTAL_NOTE_SYSTEM).toContain("A fin size is not a boot size");
  });

  it("drops a size longer than the box takes", () => {
    expect(rentalNoteFields({ wetsuitSize: "L".repeat(41) }, new Set(["wetsuitSize"]))).toEqual({});
  });
});

describe("same-person read", () => {
  const a = {
    fullName: "Ana García",
    email: "ana.garcia@example.com",
    phone: "+34 600 111 222",
    dateOfBirth: "1990-04-02",
    certifications: ["open_water"],
    firstSeen: "2026-03",
    lastSeen: "2026-03",
  };
  const b = { ...a, email: "agarcia@other.example", phone: null, dateOfBirth: null };

  it("sends a minimised pair: no domain, last four of the phone, no medical field", async () => {
    const provider = answering({
      verdict: "unsure",
      reasons: ["Different email providers."],
      confidence: 0.7,
    });
    await callStructured(provider, samePersonCall(a, b, "en-US"));
    const sent = JSON.stringify(provider.requests[0]?.messages);
    expect(sent).toContain("ana.garcia");
    expect(sent).not.toContain("example.com");
    expect(sent).toContain("1222");
    expect(sent).not.toContain("600 111");
    expect(sent).not.toMatch(/medical|waiver/i);
  });

  it("reads at most three short reasons, and nothing under the floor", async () => {
    const provider = answering({ verdict: "same", reasons: ["a", "b", "c", "d"], confidence: 0.3 });
    const low = await callStructured(provider, samePersonCall(a, b, "en-US"));
    expect(samePersonRead(low.value)).toBeNull();
    expect(
      samePersonRead({ verdict: "same", reasons: [" a ", "", "b", "c", "d"], confidence: 0.9 }),
    ).toEqual({
      verdict: "same",
      reasons: ["a", "b", "c"],
    });
  });
});
