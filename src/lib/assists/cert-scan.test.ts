import { describe, expect, it } from "vitest";
import { callStructured } from "@/lib/claude/structured";
import { fakeClaude, fakeClaudeMessage } from "@/test/fakes";
import { certScanCall, certScanFields, parseCardImage, scanCard } from "./cert-scan";

const options = {
  agencies: ["padi", "ssi"] as const,
  cards: [
    ["level:open_water", "Open Water"],
    ["nitrox", "Nitrox"],
  ] as const,
};
const image = { data: "aGVsbG8=", mediaType: "image/jpeg" as const };

function answering(value: unknown) {
  return fakeClaude({ reply: () => fakeClaudeMessage({ text: JSON.stringify(value) }) });
}

describe("certScanCall", () => {
  it("sends the image and the form's own options, with Haiku first", async () => {
    const provider = answering({
      agency: "padi",
      card: "nitrox",
      cardNumber: "12345",
      confidence: 0.9,
    });
    const result = await callStructured(provider, certScanCall(image, options, "quick"));
    expect(result.value).toMatchObject({ agency: "padi", card: "nitrox" });
    const request = provider.requests[0];
    expect(request?.model).toBe("claude-haiku-5-5");
    expect(JSON.stringify(request?.messages)).toContain("aGVsbG8=");
    expect(JSON.stringify(request?.messages)).toContain("level:open_water (Open Water)");
  });

  it("drops a reading under the confidence floor whole", async () => {
    const provider = answering({
      agency: "padi",
      card: "nitrox",
      cardNumber: "12345",
      confidence: 0.4,
    });
    const result = await callStructured(provider, certScanCall(image, options, "quick"));
    expect(result.outcome).toBe("low_confidence");
    expect(certScanFields(result.value)).toEqual({});
  });

  it("refuses a card the form does not offer", async () => {
    const provider = answering({
      agency: "padi",
      card: "level:instructor",
      cardNumber: "1",
      confidence: 1,
    });
    const result = await callStructured(provider, certScanCall(image, options, "quick"));
    expect(result.outcome).toBe("invalid");
  });
});

describe("certScanFields", () => {
  it("keeps a number only when a person could have typed it", () => {
    const base = { agency: "padi" as const, card: "nitrox" as const };
    expect(certScanFields({ ...base, cardNumber: " 2207 1188 " })).toEqual({
      ...base,
      cardNumber: "2207 1188",
    });
    expect(certScanFields({ ...base, cardNumber: "ab" }).cardNumber).toBeUndefined();
    expect(certScanFields({ ...base, cardNumber: "no digits" }).cardNumber).toBeUndefined();
    expect(
      certScanFields({ ...base, cardNumber: "<script>1</script>" }).cardNumber,
    ).toBeUndefined();
  });

  it("answers nothing for no reading, and never a verification field", () => {
    expect(certScanFields(null)).toEqual({});
    const fields = certScanFields({ agency: "ssi", card: null, cardNumber: "SSI-22891" });
    expect(Object.keys(fields).sort()).toEqual(["agency", "cardNumber"]);
  });
});

describe("scanCard", () => {
  it("asks Sonnet only when Haiku came back empty", async () => {
    const asked: string[] = [];
    const first = await scanCard(async (model) => {
      asked.push(model);
      return model === "quick" ? "haiku" : "sonnet";
    });
    expect(first).toBe("haiku");
    expect(asked).toEqual(["quick"]);
    asked.length = 0;
    const second = await scanCard(async (model) => {
      asked.push(model);
      return model === "quick" ? null : "sonnet";
    });
    expect(second).toBe("sonnet");
    expect(asked).toEqual(["quick", "draft"]);
  });
});

describe("parseCardImage", () => {
  it("takes only a bounded base64 image of an accepted type", () => {
    expect(parseCardImage("aGVsbG8=", "image/png")).toEqual({
      data: "aGVsbG8=",
      mediaType: "image/png",
    });
    expect(parseCardImage("aGVsbG8=", "application/pdf")).toBeNull();
    expect(parseCardImage("not base64!", "image/png")).toBeNull();
    expect(parseCardImage("", "image/png")).toBeNull();
    expect(parseCardImage("A".repeat(4_000_004), "image/png")).toBeNull();
  });
});
