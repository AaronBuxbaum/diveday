import { describe, expect, it } from "vitest";
import type { DiverChecklistItem } from "@/lib/readiness-summary";
import { THREAD_STEP_ORDER } from "@/lib/thread-steps";
import { diverTranslator } from "./messages";
import { threadNextKey } from "./thread-labels";

const item = (state: DiverChecklistItem["state"]) => ({ state }) as DiverChecklistItem;

describe("threadNextKey", () => {
  it("says the act, not the step's name, for every step in both locales", () => {
    for (const locale of ["en-US", "es-ES"] as const) {
      const t = diverTranslator(locale);
      for (const id of THREAD_STEP_ORDER) {
        const key = threadNextKey({ id, item: item("action") });
        const sentence = t(key);
        expect(sentence, `${locale} ${id}`).not.toBe(key);
        expect(sentence, `${locale} ${id}`).toMatch(/^(Next|Siguiente): .+\.$/);
      }
    }
  });

  it("promises two minutes for the release only, and names the forms once it is on file", () => {
    const t = diverTranslator("en-US");
    expect(t(threadNextKey({ id: "sign", item: item("action") }))).toBe(
      "Next: sign your waiver, about two minutes.",
    );
    expect(t(threadNextKey({ id: "sign", item: item("done") }))).toBe(
      "Next: sign your course forms.",
    );
  });
});
