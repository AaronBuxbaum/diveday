import { describe, expect, it } from "vitest";
import { BLOCKER_CATEGORY, type ReadinessBlockerCode } from "@/lib/readiness";
import type { ChecklistDetailCode, DiverChecklistItem } from "@/lib/readiness-summary";
import { THREAD_STEP_ORDER, type ThreadStepId } from "@/lib/thread-steps";
import { diverTranslator } from "./messages";
import { CERTIFICATION_NEXT_KEYS, SIGN_NEXT_KEYS, threadNextKey } from "./thread-labels";

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
        if (id === "dayof") {
          expect(sentence).toBe(
            locale === "en-US"
              ? "Next: a few details for the day"
              : "Siguiente: unos detalles para el día",
          );
        } else {
          expect(sentence, `${locale} ${id}`).toMatch(/^(Next|Siguiente): .+/);
          expect(sentence).not.toMatch(/\.$/);
        }
      }
    }
  });

  it("says the release once (the step row carries the two minutes) and names the forms once it is on file", () => {
    const t = diverTranslator("en-US");
    expect(next("en-US", "sign", "waiver_pending")).toBe("Next: sign your waiver");
    expect(t(threadNextKey({ id: "sign", item: item("done") }))).toBe(
      "Next: sign your course forms",
    );
    for (const locale of ["en-US", "es-ES"] as const) {
      expect(next(locale, "sign", "waiver_pending")).not.toMatch(/two minutes|dos minutos/);
    }
  });

  it("asks a guardian to sign a minor's waiver, and a lapsed link for a fresh one", () => {
    expect(next("en-US", "sign", "guardian_signature_missing")).toBe(
      "Next: a parent or guardian signs the waiver",
    );
    expect(next("es-ES", "sign", "guardian_signature_missing")).toBe(
      "Siguiente: tu madre, padre o tutor firma la exención",
    );
    expect(next("en-US", "sign", "waiver_expired")).toBe("Next: get a fresh waiver link");
    expect(next("es-ES", "sign", "waiver_expired")).toBe(
      "Siguiente: consigue un enlace nuevo para la exención",
    );
  });

  it.each([
    [
      "certification_missing",
      undefined,
      "Next: add your certification",
      "Siguiente: agrega tu certificación",
    ],
    [
      "certification_self_declared",
      undefined,
      "Next: add your certification",
      "Siguiente: agrega tu certificación",
    ],
    [
      "certification_insufficient",
      undefined,
      "Next: check your certification level with the shop",
      "Siguiente: consulta tu nivel de certificación con el centro",
    ],
    [
      "specialty_missing",
      undefined,
      "Next: add your specialty card",
      "Siguiente: agrega tu tarjeta de especialidad",
    ],
    [
      "nitrox_missing",
      undefined,
      "Next: add your Nitrox card",
      "Siguiente: agrega tu tarjeta de nitrox",
    ],
    [
      "nitrox_self_declared",
      undefined,
      "Next: add your Nitrox card",
      "Siguiente: agrega tu tarjeta de nitrox",
    ],
    [
      "certification_missing",
      "certification_multiple_needed",
      "Next: add the cards this dive needs",
      "Siguiente: agrega las tarjetas que pide esta inmersión",
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

  const codesIn = (category: string) =>
    (Object.keys(BLOCKER_CATEGORY) as ReadinessBlockerCode[])
      .filter((code) => BLOCKER_CATEGORY[code] === category)
      .sort();

  it("has a sentence for every code the sign and certification steps can carry", () => {
    expect(Object.keys(SIGN_NEXT_KEYS).sort()).toEqual(codesIn("waiver"));
    expect(Object.keys(CERTIFICATION_NEXT_KEYS).sort()).toEqual(codesIn("certification"));
  });

  // One row per code in each step's category; the walk above fails first on a
  // code added to the union without a row here.
  const SIGN_SENTENCES: Record<string, readonly [string, string]> = {
    waiver_not_sent: [
      "Next: ask the shop for your waiver",
      "Siguiente: pide tu exención al centro",
    ],
    waiver_lapsed: [
      "Next: get a fresh waiver link",
      "Siguiente: consigue un enlace nuevo para la exención",
    ],
    waiver_runs_out: [
      "Next: get a fresh waiver link",
      "Siguiente: consigue un enlace nuevo para la exención",
    ],
    waiver_pending: ["Next: sign your waiver", "Siguiente: firma tu exención"],
    waiver_expired: [
      "Next: get a fresh waiver link",
      "Siguiente: consigue un enlace nuevo para la exención",
    ],
    medical_review: [
      "Next: talk to the shop about your medical answers",
      "Siguiente: habla con el centro sobre tus respuestas médicas",
    ],
    medical_not_cleared: [
      "Next: talk to the shop about your medical answers",
      "Siguiente: habla con el centro sobre tus respuestas médicas",
    ],
    guardian_signature_missing: [
      "Next: a parent or guardian signs the waiver",
      "Siguiente: tu madre, padre o tutor firma la exención",
    ],
    course_form_unsigned: [
      "Next: sign your course forms",
      "Siguiente: firma los formularios del curso",
    ],
    course_form_guardian_missing: [
      "Next: a parent or guardian signs your course forms",
      "Siguiente: tu madre, padre o tutor firma los formularios del curso",
    ],
  };

  const CARD_WITH_SHOP = [
    "Next: nothing from you. The shop is checking your card",
    "Siguiente: nada de tu parte. El centro está revisando tu tarjeta",
  ] as const;

  const CERTIFICATION_SENTENCES: Record<string, readonly [string, string]> = {
    certification_missing: ["Next: add your certification", "Siguiente: agrega tu certificación"],
    certification_pending: CARD_WITH_SHOP,
    certification_self_declared: [
      "Next: add your certification",
      "Siguiente: agrega tu certificación",
    ],
    certification_insufficient: [
      "Next: check your certification level with the shop",
      "Siguiente: consulta tu nivel de certificación con el centro",
    ],
    certification_in_training: ["Next: finish your course", "Siguiente: termina tu curso"],
    certification_not_yet: [
      "Next: nothing from you. The shop will get in touch before the day",
      "Siguiente: nada de tu parte. El centro se pondrá en contacto contigo antes del día",
    ],
    specialty_missing: [
      "Next: add your specialty card",
      "Siguiente: agrega tu tarjeta de especialidad",
    ],
    specialty_pending: CARD_WITH_SHOP,
    specialty_import_unconfirmed: CARD_WITH_SHOP,
    nitrox_missing: ["Next: add your Nitrox card", "Siguiente: agrega tu tarjeta de nitrox"],
    nitrox_pending: CARD_WITH_SHOP,
    nitrox_self_declared: ["Next: add your Nitrox card", "Siguiente: agrega tu tarjeta de nitrox"],
  };

  it.each(codesIn("waiver"))("sign step on %s says what the diver does next", (code) => {
    const row = SIGN_SENTENCES[code];
    expect(row, `no sentence row for ${code}`).toBeDefined();
    expect(next("en-US", "sign", code)).toBe(row?.[0]);
    expect(next("es-ES", "sign", code)).toBe(row?.[1]);
  });

  it.each(codesIn("certification"))(
    "certification step on %s says what the diver does next",
    (code) => {
      const row = CERTIFICATION_SENTENCES[code];
      expect(row, `no sentence row for ${code}`).toBeDefined();
      expect(next("en-US", "certification", code)).toBe(row?.[0]);
      expect(next("es-ES", "certification", code)).toBe(row?.[1]);
    },
  );

  it("never asks for a card the shop already has", () => {
    for (const code of ["certification_pending", "specialty_pending", "nitrox_pending"] as const) {
      for (const locale of ["en-US", "es-ES"] as const) {
        expect(next(locale, "certification", code)).not.toMatch(/\badd\b|agrega/i);
      }
    }
  });

  it("asks about gear without presuming the diver rents", () => {
    expect(next("en-US", "gear")).toBe("Next: your gear, renting or bringing your own?");
    expect(next("es-ES", "gear")).toBe("Siguiente: tu equipo, ¿lo alquilas o traes el tuyo?");
  });
});
