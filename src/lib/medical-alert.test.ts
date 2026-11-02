import { describe, expect, it } from "vitest";
import {
  emergencyReadWindow,
  MEDICAL_ALERT_MAX,
  readDraftMedicalAlert,
  readMedicalAlert,
} from "./medical-alert";
import { wallTimeToUtc } from "./zoned";

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

describe("emergencyReadWindow (the days of the trip, H-20261023-medical-alert-for-the amendment of 2026-10-24)", () => {
  const KEY_LARGO = "America/New_York";
  const at = (wall: string, timeZone = KEY_LARGO) => {
    const [date = "", time = "00:00"] = wall.split(" ");
    const [year, month, day] = date.split("-").map(Number);
    const [hour, minute] = time.split(":").map(Number);
    return wallTimeToUtc(
      { year: year ?? 0, month: month ?? 0, day: day ?? 0, hour: hour ?? 0, minute: minute ?? 0 },
      timeZone,
    );
  };
  const nightBoat = { startsAt: at("2026-07-21 23:00"), endsAt: at("2026-07-21 23:59") };

  it("is open all of a day boat's own day, from midnight to midnight in the shop's zone", () => {
    const morning = { startsAt: at("2026-07-21 08:00"), endsAt: at("2026-07-21 12:00") };
    expect(emergencyReadWindow(morning, KEY_LARGO, at("2026-07-21 00:00"))).toBe("open");
    expect(emergencyReadWindow(morning, KEY_LARGO, at("2026-07-21 23:59"))).toBe("open");
  });

  it("is still open for a 23:00 departure read at 00:15 the next day", () => {
    expect(emergencyReadWindow(nightBoat, KEY_LARGO, at("2026-07-22 00:15"))).toBe("open");
  });

  it("stays open past midnight until the boat is marked returned, then closes", () => {
    const lateBack = { startsAt: at("2026-07-21 20:00"), endsAt: at("2026-07-21 23:30") };
    // The hour past the scheduled return runs to 00:30.
    expect(emergencyReadWindow(lateBack, KEY_LARGO, at("2026-07-22 00:29"))).toBe("open");
    expect(emergencyReadWindow(lateBack, KEY_LARGO, at("2026-07-22 00:30"))).toBe("closed");
  });

  it("is open on every day of a three-day trip, day 2 included", () => {
    const threeDays = { startsAt: at("2026-07-21 08:00"), endsAt: at("2026-07-23 16:00") };
    expect(emergencyReadWindow(threeDays, KEY_LARGO, at("2026-07-21 07:00"))).toBe("open");
    expect(emergencyReadWindow(threeDays, KEY_LARGO, at("2026-07-22 10:00"))).toBe("open");
    expect(emergencyReadWindow(threeDays, KEY_LARGO, at("2026-07-23 22:00"))).toBe("open");
  });

  it("is closed the day after endsAt", () => {
    const morning = { startsAt: at("2026-07-21 08:00"), endsAt: at("2026-07-21 16:00") };
    expect(emergencyReadWindow(morning, KEY_LARGO, at("2026-07-22 00:00"))).toBe("closed");
    expect(emergencyReadWindow(morning, KEY_LARGO, at("2026-07-22 10:00"))).toBe("closed");
  });

  it("is not yet open before the start date", () => {
    const morning = { startsAt: at("2026-07-21 08:00"), endsAt: at("2026-07-21 16:00") };
    expect(emergencyReadWindow(morning, KEY_LARGO, at("2026-07-20 23:59"))).toBe("not_yet");
    expect(emergencyReadWindow(morning, KEY_LARGO, at("2026-07-20 09:00"))).toBe("not_yet");
  });

  it("reads the days in a shop zone far from UTC", () => {
    // Kiritimati is UTC+14: its 2026-07-21 starts at 10:00Z on the 20th.
    const LINE_ISLANDS = "Pacific/Kiritimati";
    const morning = {
      startsAt: at("2026-07-21 08:00", LINE_ISLANDS),
      endsAt: at("2026-07-21 12:00", LINE_ISLANDS),
    };
    expect(emergencyReadWindow(morning, LINE_ISLANDS, new Date("2026-07-20T09:59:00Z"))).toBe(
      "not_yet",
    );
    expect(emergencyReadWindow(morning, LINE_ISLANDS, new Date("2026-07-20T10:00:00Z"))).toBe(
      "open",
    );
    expect(emergencyReadWindow(morning, LINE_ISLANDS, new Date("2026-07-21T09:59:00Z"))).toBe(
      "open",
    );
    expect(emergencyReadWindow(morning, LINE_ISLANDS, new Date("2026-07-21T10:00:00Z"))).toBe(
      "closed",
    );
  });
});
