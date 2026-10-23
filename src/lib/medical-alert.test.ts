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

  it("refuses every control character but a newline, tab included", () => {
    for (const raw of ["Asthma\u0000", "Asthma\tinhaler", "a\u0007b", "a\u007fb", "a\u001bb"]) {
      expect(readMedicalAlert(raw)).toEqual({ ok: false, reason: "control_character" });
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
    const mended = readDraftMedicalAlert("EpiPen\tin the blue bag\u0000");
    expect(mended).toBe("EpiPen in the blue bag");
    expect(readMedicalAlert(mended)).toEqual({ ok: true, value: mended });
    expect(readDraftMedicalAlert("a".repeat(MEDICAL_ALERT_MAX + 1))).toBe(
      "a".repeat(MEDICAL_ALERT_MAX),
    );
  });
});
