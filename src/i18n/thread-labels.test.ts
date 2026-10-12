import { describe, expect, it } from "vitest";
import type { ReadinessBlockerCode } from "@/lib/readiness";
import type { ChecklistDetailCode, DiverChecklistItem } from "@/lib/readiness-summary";
import { THREAD_STEP_ORDER, type ThreadStepId } from "@/lib/thread-steps";
import { diverTranslator } from "./messages";
import { threadNextKey } from "./thread-labels";

const item = (
  state: DiverChecklistItem["state"],
  code?: ReadinessBlockerCode,
  detailCode?: ChecklistDetailCode,
) => ({ state, code, detailCode }) as DiverChecklistItem;

const next = (
  locale: "en-US" | "es-ES",
  id: ThreadStepId,
  code?: ReadinessBlockerCode,
  detailCode?: ChecklistDetailCode,
) => diverTranslator(locale)(threadNextKey({ id, item: item("action", code, detailCode) }));

describe("threadNextKey", () => {
  it("says the act, not the step's name, for every step in both locales", () => {
    for (const locale of ["en-US", "es-ES"] as const) {
      const t = diverTranslator(locale);
      for (const id of THREAD_STEP_ORDER) {
        const key = threadNextKey({ id, item: item("action") });
        const sentence = t(key);
        expect(sentence, `${locale} ${id}`).not.toBe(key);
        expect(sentence, `${locale} ${id}`).toMatch(/^(Next|Siguiente): .+[.?]$/);
      }
    }
  });

  it("says the release once (the step row carries the two minutes) and names the forms once it is on file", () => {
    const t = diverTranslator("en-US");
    expect(next("en-US", "sign", "waiver_pending")).toBe("Next: sign your waiver.");
    expect(t(threadNextKey({ id: "sign", item: item("done") }))).toBe(
      "Next: sign your course forms.",
    );
    for (const locale of ["en-US", "es-ES"] as const) {
      expect(next(locale, "sign", "waiver_pending")).not.toMatch(/two minutes|dos minutos/);
    }
  });

  it("asks a guardian to sign a minor's waiver, and a lapsed link for a fresh one", () => {
    expect(next("en-US", "sign", "guardian_signature_missing")).toBe(
      "Next: a parent or guardian signs the waiver.",
    );
    expect(next("es-ES", "sign", "guardian_signature_missing")).toBe(
      "Siguiente: tu madre, padre o tutor firma la exención.",
    );
    expect(next("en-US", "sign", "waiver_expired")).toBe("Next: get a fresh waiver link.");
    expect(next("es-ES", "sign", "waiver_expired")).toBe(
      "Siguiente: consigue un enlace nuevo para la exención.",
    );
  });

  it.each([
    [
      "certification_missing",
      undefined,
      "Next: add your certification.",
      "Siguiente: agrega tu certificación.",
    ],
    [
      "certification_self_declared",
      undefined,
      "Next: add your certification.",
      "Siguiente: agrega tu certificación.",
    ],
    [
      "certification_insufficient",
      undefined,
      "Next: check your certification level with the shop.",
      "Siguiente: consulta tu nivel de certificación con el centro.",
    ],
    [
      "specialty_missing",
      undefined,
      "Next: add your specialty card.",
      "Siguiente: agrega tu tarjeta de especialidad.",
    ],
    [
      "nitrox_missing",
      undefined,
      "Next: add your Nitrox card.",
      "Siguiente: agrega tu tarjeta de nitrox.",
    ],
    [
      "nitrox_self_declared",
      undefined,
      "Next: add your Nitrox card.",
      "Siguiente: agrega tu tarjeta de nitrox.",
    ],
    [
      "certification_missing",
      "certification_multiple_needed",
      "Next: add the cards this dive needs.",
      "Siguiente: agrega las tarjetas que pide esta inmersión.",
    ],
  ] as const)("certification step on %s (%s) asks for the right card", (code, detail, en, es) => {
    expect(next("en-US", "certification", code, detail)).toBe(en);
    expect(next("es-ES", "certification", code, detail)).toBe(es);
  });

  it("never tells a diver short a level to add a card they already sent", () => {
    for (const locale of ["en-US", "es-ES"] as const) {
      expect(next(locale, "certification", "certification_insufficient")).not.toBe(
        next(locale, "certification", "certification_missing"),
      );
    }
  });

  it("asks about gear without presuming the diver rents", () => {
    expect(next("en-US", "gear")).toBe("Next: your gear, renting or bringing your own?");
    expect(next("es-ES", "gear")).toBe("Siguiente: tu equipo, ¿lo alquilas o traes el tuyo?");
  });
});
