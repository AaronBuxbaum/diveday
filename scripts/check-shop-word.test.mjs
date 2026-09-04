import { describe, expect, it } from "vitest";

import { findSettledTerms } from "./check-shop-word.mjs";

/**
 * This guard exists because the es-ES README's decisions are binding and were
 * broken anyway — six `tienda` strings on 2026-08-21, and four more of its
 * decisions on 2026-09-04 (issue #1316). So the thing worth testing is not
 * "does a regex match a word": it is that each rule still fires on the mistake
 * it was written for **and still lets the near-miss through**. Every rule here
 * has a word that looks like the banned one and is not, and each of those
 * false positives is one a naive find-and-replace has already produced in this
 * repository or would on its next run.
 *
 * A bundle is just an object, so each case below is the whole input.
 */

/** Run the check over one bundle, returning the rule ids it objected to. */
function rules(bundle, relative = "src/i18n/locales/es-ES/diver.json") {
  return findSettledTerms(bundle, { relative }).violations.map((violation) => violation.rule);
}

const STAFF = `src/i18n/locales/es-ES/staff/trips.json`;

describe("the words the es-ES README settled", () => {
  it("reads nested keys and counts every string it passed", () => {
    // The walk itself: a rule that silently stopped descending would report a
    // clean tree forever, which is the one failure mode a guard must not have.
    const result = findSettledTerms({
      a: { b: { c: "Reserva tu plaza" } },
      d: "Abre la salida",
      e: 7,
    });
    expect(result.strings).toBe(2);
    expect(result.violations).toEqual([]);
  });

  describe("the shop is el centro", () => {
    it("refuses la tienda", () => {
      expect(rules({ k: "Pregunta en la tienda." })).toEqual(["shop"]);
      expect(rules({ k: "Las tiendas cercanas" })).toEqual(["shop"]);
    });

    it("leaves trastienda and entiendas alone", () => {
      // Both contain the letters and neither is the word. `trastienda` is all
      // over the switching guides; `entiendas` is in the waiver's own notice
      // ("no firmes nada que no entiendas"). The README warns by name not to
      // let a find-and-replace eat the first.
      expect(rules({ k: "el PC de la trastienda" })).toEqual([]);
      expect(rules({ k: "no firmes nada que no entiendas" })).toEqual([]);
    });

    it("leaves venta minorista alone, which is what tienda was freed up to mean", () => {
      expect(rules({ k: "historial de venta minorista" })).toEqual([]);
    });
  });

  describe("the waiver is la exención", () => {
    it("refuses descargo and liberación", () => {
      expect(rules({ k: "Te enviaremos el descargo." })).toEqual(["waiver"]);
      expect(rules({ k: "registrar una liberación en papel" })).toEqual(["waiver"]);
      // The accent-less spelling too: it is the same word typed in a hurry.
      expect(rules({ k: "certificaciones, liberaciones, notas" })).toEqual(["waiver"]);
    });

    it("accepts exención", () => {
      expect(rules({ k: "Tengo la exención firmada de este buceador." })).toEqual([]);
    });
  });

  describe("a place you dive is un sitio de buceo", () => {
    it("refuses both spellings the 2026-08-05 sweep removed", () => {
      expect(rules({ k: "Tus puntos de buceo previstos" })).toEqual(["dive-site"]);
      expect(rules({ k: "esta salida y sus puntos de inmersión" })).toEqual(["dive-site"]);
    });

    it("leaves the two puntos that are correct", () => {
      // `punto de venta` is the POS the README explicitly keeps, and `punto de
      // pronóstico` is the marine forecast's offshore coordinate — the one
      // place "el punto" survives. A rule matching "punto" alone would take
      // both, which is why this one names the following words.
      expect(rules({ k: "POS / punto de venta" })).toEqual([]);
      expect(rules({ k: "el punto de pronóstico" })).toEqual([]);
    });

    it("leaves una inmersión alone, which is one dive rather than a place", () => {
      expect(rules({ k: "dos inmersiones en un sitio de buceo" })).toEqual([]);
    });
  });

  describe("quotation marks are curly, not guillemets", () => {
    it("refuses « and »", () => {
      expect(rules({ k: "se imprime como «18 metros»" })).toEqual(["quotes"]);
    });

    it("accepts the curly pair", () => {
      expect(rules({ k: "se imprime como “18 metros”" })).toEqual([]);
    });
  });

  describe("tú, never vosotros", () => {
    it("refuses a vosotros present tense", () => {
      expect(rules({ k: "Cuando entráis al muelle" })).toEqual(["vosotros"]);
      expect(rules({ k: "Si queréis cambiarlo" })).toEqual(["vosotros"]);
    });

    it("leaves país and raíz alone, where the accent sits on the i", () => {
      // The whole reason this rule is safe to write as a suffix match: every
      // vosotros present-tense ending accents the a or the e, and the innocent
      // words that end in those letters accent the i instead.
      expect(rules({ k: "el país del centro" })).toEqual([]);
      expect(rules({ k: "la raíz del problema" })).toEqual([]);
    });

    it("leaves tú imperatives alone", () => {
      expect(rules({ k: "Revisa el cuestionario e inténtalo otra vez." })).toEqual([]);
    });
  });

  describe("a departure is la salida, in the staff bundles", () => {
    it("refuses viaje in a staff bundle", () => {
      expect(rules({ k: "Los requisitos de este viaje" }, STAFF)).toEqual(["departure"]);
    });

    it("allows viaje in diver.json, which is the scoped half of this rule", () => {
      // Deliberate: `diver.json`'s marketing and switching prose uses `viaje`
      // for an outing a diver takes, which is a different job from a row on
      // the schedule board. Narrowing that copy is a voice decision, not a
      // terminology violation, and this guard does not force it.
      expect(rules({ k: "reservar un viaje, firmar la exención" })).toEqual([]);
    });

    it("accepts salida in a staff bundle", () => {
      expect(rules({ k: "Los requisitos de esta salida" }, STAFF)).toEqual([]);
    });
  });

  it("reports every rule a single string breaks, not only the first", () => {
    // A string can be wrong twice, and reporting one at a time turns a sweep
    // into as many rounds as the string has mistakes.
    expect(rules({ k: "Pide el descargo en la tienda." })).toEqual(["shop", "waiver"]);
  });

  it("names the right word, not only the wrong one", () => {
    // The failure text is the whole remedy a reader gets. A guard that says
    // "this is wrong" and stops gets satisfied by a second synonym nobody
    // chose either.
    const [violation] = findSettledTerms({ k: "el descargo" }, { relative: "x" }).violations;
    expect(violation?.says).toContain("exención");
  });
});
