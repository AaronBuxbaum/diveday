import { describe, expect, it } from "vitest";
import { MEDICAL_ALERT_MAX, readDraftMedicalAlert, readMedicalAlert } from "./medical-alert";

describe("readMedicalAlert (glossary *Medical alert for the crew*)", () => {
  it("keeps the diver's words, trimmed and NFC, with newlines", () => {
    expect(readMedicalAlert("  Bee-sting allergy.\r\nEpiPen in the blue dry bag.  ")).toEqual({
      ok: true,
      value: "Bee-sting allergy.\nEpiPen in the blue dry bag.",
    });
    // "é" typed as e + combining acute is stored composed.
    expect(readMedicalAlert("Médico")).toEqual({ ok: true, value: "Médico" });
  });

  it("reads blank, whitespace and a missing field as no alert", () => {
    for (const raw of ["", "   ", "\n\n", null, undefined]) {
      expect(readMedicalAlert(raw)).toEqual({ ok: true, value: null });
    }
  });

  it("takes exactly the cap and refuses one character more", () => {
    expect(readMedicalAlert("a".repeat(MEDICAL_ALERT_MAX))).toEqual({
      ok: true,
      value: "a".repeat(MEDICAL_ALERT_MAX),
    });
    expect(readMedicalAlert("a".repeat(MEDICAL_ALERT_MAX + 1))).toEqual({
      ok: false,
      reason: "too_long",
    });
    // Measured after trimming: padding never refuses a fitting alert.
    expect(readMedicalAlert(`  ${"a".repeat(MEDICAL_ALERT_MAX)}  `).ok).toBe(true);
  });

  it("turns tabs into spaces and never refuses for one", () => {
    expect(readMedicalAlert("Asthma\tinhaler in my BCD pocket")).toEqual({
      ok: true,
      value: "Asthma inhaler in my BCD pocket",
    });
    expect(readMedicalAlert("Allergies:\tPenicillin, bees")).toEqual({
      ok: true,
      value: "Allergies: Penicillin, bees",
    });
  });

  it("strips zero-width and direction characters, so the crew read exactly what was typed", () => {
    // A right-to-left override would make "EpiPen in bag on ton" read as
    // "EpiPen in bag not no".
    expect(readMedicalAlert("EpiPen in bag \u202Eon ton\u202C")).toEqual({
      ok: true,
      value: "EpiPen in bag on ton",
    });
    expect(readMedicalAlert("Dia\u200Bbetic\u2066\uFEFF")).toEqual({ ok: true, value: "Diabetic" });
    // Nothing left once they go: no alert, so no chip that opens to nothing.
    expect(readMedicalAlert("\u200B\u2060\uFEFF")).toEqual({ ok: true, value: null });
  });

  it("refuses the remaining control characters", () => {
    for (const raw of ["Asthma\u0000", "a\u0007b", "a\u007fb", "a\u001bb", "a\u0085b"]) {
      expect(readMedicalAlert(raw)).toEqual({ ok: false, reason: "control_character" });
    }
  });

  it("reads a 'nothing' answer, in English or Spanish, as no alert", () => {
    for (const raw of [
      "none",
      "None.",
      "N/A",
      "n/a.",
      "NA",
      "No",
      "nothing",
      "Nil",
      "  none  ",
      "Ninguna",
      "ninguno.",
      "Nada",
      "No aplica",
    ]) {
      expect(readMedicalAlert(raw), raw).toEqual({ ok: true, value: null });
    }
  });

  it("keeps anything more than a bare 'nothing'", () => {
    for (const raw of [
      "No known allergies but carry inhaler",
      "None, but I carry an EpiPen",
      "No.\nInhaler in my bag",
      "nada de cacahuetes",
    ]) {
      expect(readMedicalAlert(raw).ok, raw).toBe(true);
      expect(readMedicalAlert(raw), raw).not.toEqual({ ok: true, value: null });
    }
  });

  it("is text and nothing else: an alert that names a heart condition is still just kept", () => {
    expect(readMedicalAlert("Stent placed in June, on blood thinners")).toEqual({
      ok: true,
      value: "Stent placed in June, on blood thinners",
    });
  });
});

describe("readDraftMedicalAlert", () => {
  it("keeps what signing would keep, and mends what it would refuse so nothing typed is lost", () => {
    expect(readDraftMedicalAlert(" Diabetic, glucose in my bag ")).toBe(
      "Diabetic, glucose in my bag",
    );
    expect(readDraftMedicalAlert("")).toBeNull();
    expect(readDraftMedicalAlert("\u0000")).toBeNull();
    // A pasted tab becomes a space; the mended draft would sign.
    expect(readDraftMedicalAlert("N/A")).toBeNull();
    const mended = readDraftMedicalAlert("EpiPen\tin the blue bag\u0000");
    expect(mended).toBe("EpiPen in the blue bag");
    expect(readMedicalAlert(mended)).toEqual({ ok: true, value: mended });
    expect(readDraftMedicalAlert("a".repeat(MEDICAL_ALERT_MAX + 1))).toBe(
      "a".repeat(MEDICAL_ALERT_MAX),
    );
  });
});
