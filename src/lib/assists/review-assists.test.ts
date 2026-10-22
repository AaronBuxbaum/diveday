import { describe, expect, it } from "vitest";
import { callStructured } from "@/lib/claude/structured";
import { fakeClaude, fakeClaudeMessage } from "@/test/fakes";
import { reviewFlagsCall, reviewFlagsFor } from "./review-flags";
import { reviewThemes, reviewThemesCall } from "./review-themes";

function answering(value: unknown) {
  return fakeClaude({ reply: () => fakeClaudeMessage({ text: JSON.stringify(value) }) });
}

describe("review flags", () => {
  it("sends the comment and nothing else", async () => {
    const provider = answering({ flags: ["names_someone"] });
    const result = await callStructured(provider, reviewFlagsCall("Marco was great"));
    expect(result.value).toEqual({ flags: ["names_someone"] });
    expect(provider.requests[0]?.messages).toEqual([
      { role: "user", content: "Comment: Marco was great" },
    ]);
  });

  it("refuses a flag outside the four", async () => {
    const provider = answering({ flags: ["publish"] });
    expect((await callStructured(provider, reviewFlagsCall("ok"))).value).toBeNull();
  });

  it("finds contact details without the assist, and orders the chips", () => {
    expect(reviewFlagsFor("call me on +1 305 555 0101", null)).toEqual(["contact_info"]);
    expect(reviewFlagsFor("mail me at a@b.co", ["profanity", "names_someone"])).toEqual([
      "names_someone",
      "contact_info",
      "profanity",
    ]);
    expect(reviewFlagsFor("Lovely day", null)).toEqual([]);
  });
});

describe("review themes", () => {
  const reviews = Array.from({ length: 6 }, (_, index) => ({
    id: `id-${index}`,
    comment: `Comment ${index}`,
  }));

  it("maps prompt ids back to rows and keeps three to five themes", async () => {
    const provider = answering({
      themes: [
        { title: "Briefings", reviewIds: ["r1", "r2"] },
        { title: "Boat", reviewIds: ["r3", "r4", "r9"] },
        { title: "Turtles", reviewIds: ["r5", "r6"] },
        { title: "One review only", reviewIds: ["r1"] },
      ],
    });
    const result = await callStructured(provider, reviewThemesCall(reviews, "en-US"));
    expect(reviewThemes(result.value, reviews)).toEqual([
      { title: "Briefings", reviewIds: ["id-0", "id-1"] },
      { title: "Boat", reviewIds: ["id-2", "id-3"] },
      { title: "Turtles", reviewIds: ["id-4", "id-5"] },
    ]);
    expect(JSON.stringify(provider.requests[0]?.messages)).not.toContain("id-0");
  });

  it("answers nothing for fewer than three themes", () => {
    expect(reviewThemes({ themes: [{ title: "A", reviewIds: ["r1", "r2"] }] }, reviews)).toEqual(
      [],
    );
  });
});
