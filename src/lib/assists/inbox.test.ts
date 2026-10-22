import { describe, expect, it } from "vitest";
import { buildStructuredRequest, callStructured } from "@/lib/claude/structured";
import { fakeClaude, fakeClaudeMessage } from "@/test/fakes";
import {
  checkedTranslation,
  groundedReply,
  inboundTriageCall,
  replyDraftCall,
  replyTranslationCall,
  storedTriage,
} from "./inbox";

function answering(value: unknown) {
  return fakeClaude({ reply: () => fakeClaudeMessage({ text: JSON.stringify(value) }) });
}

describe("inboundTriageCall", () => {
  it("sends the message as tagged data on the quick model, the target language as cached context", () => {
    const request = buildStructuredRequest(
      inboundTriageCall({
        subject: "Samstag",
        body: "Wir kommen 20 Minuten später",
        targetLocale: "en-US",
      }),
    );
    expect(request.model).toBe("claude-haiku-5-5");
    expect(request.system).toEqual([
      expect.objectContaining({ type: "text" }),
      { type: "text", text: "Target language: en", cache_control: { type: "ephemeral" } },
    ]);
    expect(request.messages[0]?.content).toBe(
      "<message>\nSubject: Samstag\n\nWir kommen 20 Minuten später\n</message>",
    );
  });

  it("reads a valid answer and drops a low-confidence one", async () => {
    const call = inboundTriageCall({ subject: null, body: "running late!", targetLocale: "en-US" });
    const ok = await callStructured(
      answering({
        intent: "late",
        urgent: true,
        language: "en",
        translation: null,
        confidence: 0.9,
      }),
      call,
    );
    expect(ok.value).toMatchObject({ intent: "late", urgent: true });
    const unsure = await callStructured(
      answering({
        intent: "late",
        urgent: true,
        language: "en",
        translation: null,
        confidence: 0.2,
      }),
      call,
    );
    expect(unsure.value).toBeNull();
  });

  it("refuses an intent that is not one of the codes", async () => {
    const result = await callStructured(
      answering({
        intent: "refund_now",
        urgent: false,
        language: "en",
        translation: null,
        confidence: 1,
      }),
      inboundTriageCall({ subject: null, body: "x", targetLocale: "en-US" }),
    );
    expect(result.value).toBeNull();
  });
});

describe("storedTriage", () => {
  const base = { intent: "question" as const, urgent: false, confidence: 1 };

  it("keeps a translation from another language, keyed to the shop's locale", () => {
    expect(
      storedTriage(
        { ...base, language: "DE", translation: "Is there room on Saturday?" },
        { body: "Gibt es Platz am Samstag?", targetLocale: "en-US" },
      ),
    ).toEqual({
      intent: "question",
      urgent: false,
      language: "de",
      translation: "Is there room on Saturday?",
      translatedTo: "en-US",
    });
  });

  it("drops a translation into the language the message is already in, or one that echoes it", () => {
    expect(
      storedTriage(
        { ...base, language: "es", translation: "¿Hay sitio?" },
        { body: "¿Hay sitio el sábado?", targetLocale: "es-ES" },
      ),
    ).toMatchObject({ language: "es", translation: null, translatedTo: null });
    expect(
      storedTriage(
        { ...base, language: "fr", translation: "Bonjour" },
        { body: "Bonjour", targetLocale: "en-US" },
      ).translation,
    ).toBeNull();
  });

  it("drops a language that is not a code, and the translation with it", () => {
    expect(
      storedTriage(
        { ...base, language: "German", translation: "Hello" },
        { body: "Hallo", targetLocale: "en-US" },
      ),
    ).toMatchObject({ language: null, translation: null });
  });
});

describe("replyDraftCall", () => {
  it("caches the facts, sends only the last few lines of the thread, on the draft model", () => {
    const thread = Array.from({ length: 9 }, (_, index) => ({
      from: index % 2 === 0 ? ("diver" as const) : ("shop" as const),
      text: `line ${index}`,
    }));
    const request = buildStructuredRequest(
      replyDraftCall({ facts: ["Sat 26 Oct 8:00 AM, Two-tank reef: 4 seats open, $95"], thread }),
    );
    expect(request.model).toBe("claude-sonnet-5-5");
    expect(request.system).toContainEqual({
      type: "text",
      text: "<facts>\nSat 26 Oct 8:00 AM, Two-tank reef: 4 seats open, $95\n</facts>",
      cache_control: { type: "ephemeral" },
    });
    const content = String(request.messages[0]?.content);
    expect(content).not.toContain("line 2");
    expect(content).toContain("Diver: line 8");
  });
});

describe("groundedReply", () => {
  const facts = ["Sat 26 Oct 8:00 AM, Two-tank reef: 4 seats open, $95"];
  const thread = [{ from: "diver" as const, text: "Is there room for 2 on Saturday?" }];

  it("passes a draft whose every number is quoted from the facts or the thread", () => {
    expect(
      groundedReply(
        {
          reply: "Yes, 4 seats are open on Sat 26 Oct at 8:00 for $95. Room for 2!",
          medical: false,
          confidence: 1,
        },
        { facts, thread },
      ),
    ).toBe("Yes, 4 seats are open on Sat 26 Oct at 8:00 for $95. Room for 2!");
  });

  it("throws away a draft that names a price or a seat count nobody gave it", () => {
    expect(
      groundedReply({ reply: "Sure, it's $85.", medical: false, confidence: 1 }, { facts, thread }),
    ).toBeNull();
    expect(
      groundedReply(
        { reply: "We have 6 seats.", medical: false, confidence: 1 },
        { facts, thread },
      ),
    ).toBeNull();
  });

  it("never drafts an answer to a medical question, whatever the reply says", () => {
    expect(
      groundedReply(
        { reply: "You should be fine.", medical: true, confidence: 1 },
        { facts, thread },
      ),
    ).toBeNull();
  });

  it("is null for an empty draft", () => {
    expect(
      groundedReply({ reply: "  ", medical: false, confidence: 1 }, { facts, thread }),
    ).toBeNull();
  });
});

describe("reply translation", () => {
  it("sends the staffer's words as data on the quick model", () => {
    const request = buildStructuredRequest(
      replyTranslationCall({ text: "See you at 7:30!", language: "de" }),
    );
    expect(request.model).toBe("claude-haiku-5-5");
    expect(request.messages[0]?.content).toBe(
      "Language: de\n\n<reply>\nSee you at 7:30!\n</reply>",
    );
  });

  it("keeps a translation that kept every number, and refuses one that changed a time", () => {
    expect(checkedTranslation("See you at 7:30, $95.", "Bis 7:30, $95.")).toBe("Bis 7:30, $95.");
    expect(checkedTranslation("See you at 7:30.", "Bis 8:30.")).toBeNull();
    expect(checkedTranslation("Hello", "Hello")).toBeNull();
    expect(checkedTranslation("Hello", " ")).toBeNull();
  });
});
