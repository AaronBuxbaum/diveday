import { expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { rescheduleCountLine, rescheduleHoldCopy } from "./reschedule-hold-copy";

const COUNTS = [1, 2, 5, 11, 21, 100, 101, 500];

const EXPECTED = {
  "en-US": {
    told: (n: number) => `Told ${n} ${n === 1 ? "diver" : "divers"} the new time.`,
    place: (n: number) => `Told ${n} ${n === 1 ? "diver" : "divers"} the new meeting point.`,
    missed: (n: number) =>
      `${n} ${n === 1 ? "diver" : "divers"} could not be reached by email or text.`,
  },
  "es-ES": {
    told: (n: number) =>
      `Avisamos del nuevo horario a ${n} ${n === 1 ? "buceador" : "buceadores"}.`,
    place: (n: number) =>
      `Avisamos del nuevo punto de encuentro a ${n} ${n === 1 ? "buceador" : "buceadores"}.`,
    missed: (n: number) =>
      `No pudimos avisar a ${n} ${n === 1 ? "buceador" : "buceadores"} por correo ni por mensaje.`,
  },
} as const;

it.each(["en-US", "es-ES"] as const)(
  "speaks the actual count, count-free while telling (%s)",
  (locale) => {
    const t = staffTranslator(locale);
    const time = rescheduleHoldCopy(t, locale);
    const place = rescheduleHoldCopy(t, locale, true);
    expect(time.telling).not.toMatch(/\d/);
    for (const n of COUNTS) {
      expect(rescheduleCountLine(time.told, n, locale)).toBe(EXPECTED[locale].told(n));
      expect(rescheduleCountLine(place.told, n, locale)).toBe(EXPECTED[locale].place(n));
      expect(rescheduleCountLine(time.someMissed, n, locale)).toBe(EXPECTED[locale].missed(n));
    }
  },
);
