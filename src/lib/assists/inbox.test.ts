import { describe, expect, it } from "vitest";
import { buildStructuredRequest, callStructured } from "@/lib/claude/structured";
import { fakeClaude, fakeClaudeMessage } from "@/test/fakes";
import {
  checkedTranslation,
  draftedReply,
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
      replyDraftCall({
        window: "Today is Thu, Oct 22.",
        facts: ["Sat 26 Oct 8:00 AM, Two-tank reef: 4 seats open, $95"],
        thread,
      }),
    );
    expect(request.model).toBe("claude-sonnet-5-5");
    expect(request.system).toContainEqual({
      type: "text",
      text: "<window>\nToday is Thu, Oct 22.\n</window>\n<facts>\nSat 26 Oct 8:00 AM, Two-tank reef: 4 seats open, $95\n</facts>",
      cache_control: { type: "ephemeral" },
    });
    const content = String(request.messages[0]?.content);
    expect(content).not.toContain("line 2");
    expect(content).toContain("Diver: line 8");
  });
});

describe("what the prompts tell the model", () => {
  it("keeps a reply draft from clearing this diver, while it may state published requirements", () => {
    const request = buildStructuredRequest(
      replyDraftCall({
        window: "",
        facts: [],
        thread: [{ from: "diver", text: "I'm SSI Open Water, can I come?" }],
      }),
    );
    const system = JSON.stringify(request.system);
    expect(system).toContain(
      "Do not tell this particular diver that they are qualified or cleared; say a staff member will check their card.",
    );
  });

  it("tells a reply draft the facts are a window, never the whole schedule", () => {
    const system = JSON.stringify(
      buildStructuredRequest(replyDraftCall({ window: "", facts: [], thread: [] })).system,
    );
    expect(system).toContain(
      "<window> says today's date and which departures <facts> covers. For a date outside it, or a departure <facts> does not list, say a staff member will confirm; never say there is no trip.",
    );
  });

  it("sorts a diver's symptoms during or after a dive as urgent", () => {
    const request = buildStructuredRequest(
      inboundTriageCall({
        subject: null,
        body: "My shoulder has ached since yesterday's second dive and my fingers tingle.",
        targetLocale: "en-US",
      }),
    );
    expect(JSON.stringify(request.system)).toContain(
      "or they describe feeling unwell, pain, numbness, tingling, dizziness or trouble breathing during or after a dive.",
    );
  });
});

describe("draftedReply", () => {
  it("takes the model's words as written, numbers and all: staff read every draft", () => {
    expect(draftedReply({ reply: " Sure, it's $85. ", medical: false })).toBe("Sure, it's $85.");
  });

  it("still answers a health question, with the kind reply the prompt asks for", () => {
    expect(draftedReply({ reply: "A physician's sign-off may be needed.", medical: true })).toBe(
      "A physician's sign-off may be needed.",
    );
  });

  it("is null for an empty draft", () => {
    expect(draftedReply({ reply: "  ", medical: false })).toBeNull();
  });
});

describe("the reply prompt", () => {
  it("teaches the dive shop's concerns and never refuses a question outright", () => {
    const { system } = replyDraftCall({ window: "", facts: [], thread: [] });
    expect(system).toContain("Open Water");
    expect(system).toContain("nitrox");
    expect(system).toContain("nearly every message deserves a real attempt");
    expect(system).toContain("do not give any medical opinion");
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

  it("refuses a translation that adds a number or repeats one the staffer wrote once", () => {
    expect(checkedTranslation("See you soon.", "Bis bald um 8.")).toBeNull();
    expect(checkedTranslation("See you at 7:30.", "Bis 7:30, 7:30.")).toBeNull();
  });

  it("refuses a translation that changed a count written in words", () => {
    expect(checkedTranslation("We have two seats left.", "Nos quedan tres plazas.")).toBeNull();
    expect(checkedTranslation("We have two seats left.", "Nos quedan dos plazas.")).toBe(
      "Nos quedan dos plazas.",
    );
  });

  it("keeps a price the translation wrote in its own locale's style", () => {
    expect(checkedTranslation("It is $95.00.", "Cuesta 95,00 US$.")).toBe("Cuesta 95,00 US$.");
  });
});
