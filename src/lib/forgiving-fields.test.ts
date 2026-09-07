import { describe, expect, it } from "vitest";
import {
  formatWallTime,
  isNeverForgivingFieldName,
  readTypedDate,
  readTypedMoney,
  readTypedName,
  readTypedPhone,
  readTypedTime,
} from "./forgiving-fields";

/**
 * ADR 20260906-before-you-ask, decision 3: every specimen on the canvas's
 * Fields board, as a table, in both locales. A reader that cannot read the text
 * answers `null`, so the field leaves what was typed alone.
 */
describe("readTypedTime", () => {
  it.each([
    ["7", "07:00", "7:00 AM"],
    ["7:30", "07:30", "7:30 AM"],
    ["7.30", "07:30", "7:30 AM"],
    ["730", "07:30", "7:30 AM"],
    ["1p", "13:00", "1:00 PM"],
    ["1 pm", "13:00", "1:00 PM"],
    ["1:00 pm", "13:00", "1:00 PM"],
    ["13", "13:00", "1:00 PM"],
    ["12", "12:00", "12:00 PM"],
    ["12a", "00:00", "12:00 AM"],
    ["12:30 pm", "12:30", "12:30 PM"],
    ["07:00", "07:00", "7:00 AM"],
  ])("reads %j as %s (%s)", (raw, canonical, label) => {
    expect(readTypedTime(raw, "en-US")).toEqual({ canonical, label });
  });

  it("labels in the reader's language", () => {
    expect(readTypedTime("7", "es-ES")?.canonical).toBe("07:00");
    expect(readTypedTime("13", "es-ES")?.label).toBe(formatWallTime("13:00", "es-ES"));
  });

  it.each(["", "abc", "25", "7:75", "13 pm", "0 am"])("leaves %j alone", (raw) => {
    expect(readTypedTime(raw)).toBeNull();
  });
});

describe("readTypedDate", () => {
  // Thursday, August 27, 2026 — the week every canvas since Clearwater holds to.
  const today = "2026-08-27";

  it("reads a weekday as the next one, never today", () => {
    expect(readTypedDate("sat", today, "en-US")).toEqual({
      canonical: "2026-08-29",
      label: "Sat, Aug 29",
    });
    expect(readTypedDate("Saturday", today, "en-US")?.canonical).toBe("2026-08-29");
    expect(readTypedDate("thu", today, "en-US")?.canonical).toBe("2026-09-03");
    expect(readTypedDate("mon", today, "en-US")?.canonical).toBe("2026-08-31");
  });

  it("reads the weekday in Spanish for a shop in Cozumel", () => {
    expect(readTypedDate("sáb", today, "es-ES")?.canonical).toBe("2026-08-29");
    expect(readTypedDate("sábado", today, "es-ES")?.canonical).toBe("2026-08-29");
    expect(readTypedDate("jue", today, "es-ES")?.canonical).toBe("2026-09-03");
  });

  it("reads month and day in the locale's own order, rolling to next year when past", () => {
    expect(readTypedDate("9/12", today, "en-US")?.canonical).toBe("2026-09-12");
    expect(readTypedDate("9/12", today, "es-ES")?.canonical).toBe("2026-12-09");
    expect(readTypedDate("3/1", today, "en-US")?.canonical).toBe("2027-03-01");
    expect(readTypedDate("3/1/27", today, "en-US")?.canonical).toBe("2027-03-01");
  });

  it("passes an ISO date through and labels it with its weekday", () => {
    expect(readTypedDate("2026-09-05", today, "en-US")).toEqual({
      canonical: "2026-09-05",
      label: "Sat, Sep 5",
    });
  });

  it.each(["", "xx", "13/45", "2026-02-30", "tomorrow"])("leaves %j alone", (raw) => {
    expect(readTypedDate(raw, today, "en-US")).toBeNull();
  });
});

describe("readTypedPhone", () => {
  it.each([
    ["3055550142", "+1 305 555 0142"],
    ["(305) 555-0142", "+1 305 555 0142"],
    ["305.555.0142", "+1 305 555 0142"],
    ["1 305 555 0142", "+1 305 555 0142"],
    ["+1 305 555 0142", "+1 305 555 0142"],
    ["+44 20 7946 0958", "+44 207 946 0958"],
  ])("reads %j in a US shop as %s", (raw, canonical) => {
    expect(readTypedPhone(raw, "US")).toEqual({ canonical, label: canonical });
  });

  it("uses the shop's own country for a national number", () => {
    expect(readTypedPhone("987 123 4567", "MX")?.canonical).toBe("+52 987 123 4567");
    expect(readTypedPhone("07700 900123", "GB")?.canonical).toBe("+44 770 090 0123");
  });

  it.each(["", "555", "abc", "12345678901234567"])("leaves %j alone", (raw) => {
    expect(readTypedPhone(raw, "US")).toBeNull();
  });

  it("leaves a national number alone when the shop has no country", () => {
    expect(readTypedPhone("3055550142", null)).toBeNull();
    expect(readTypedPhone("+1 305 555 0142", null)?.canonical).toBe("+1 305 555 0142");
  });
});

describe("readTypedName", () => {
  it.each([
    ["SHARMA, PRIYA", "Priya Sharma"],
    ["Sharma, Priya", "Priya Sharma"],
    ["PRIYA SHARMA", "Priya Sharma"],
    ["O'BRIEN, EMMET", "Emmet O'Brien"],
    ["MARIE-CLAIRE DUBOIS", "Marie-Claire Dubois"],
  ])("turns %j around into %s", (raw, canonical) => {
    expect(readTypedName(raw)).toEqual({ canonical, label: canonical });
  });

  it.each(["van der Berg", "McKay", "Priya Sharma", "", "A"])(
    "leaves a name typed in mixed case exactly as typed (%j)",
    (raw) => {
      expect(readTypedName(raw)).toBeNull();
    },
  );
});

describe("readTypedMoney", () => {
  it.each([
    ["95", "95", "$95"],
    ["$95", "95", "$95"],
    ["95.00", "95", "$95"],
    ["62.50", "62.5", "$62.50"],
    ["1,250", "1250", "$1,250"],
  ])("reads %j as %s (%s)", (raw, canonical, label) => {
    expect(readTypedMoney(raw, "usd", "en-US")).toEqual({ canonical, label });
  });

  it("reads a Spanish decimal comma in euros", () => {
    expect(readTypedMoney("62,50", "eur", "es-ES")?.canonical).toBe("62.5");
    expect(readTypedMoney("95 €", "eur", "es-ES")?.canonical).toBe("95");
  });

  it("keeps a zero-decimal currency whole", () => {
    expect(readTypedMoney("5000", "jpy", "en-US")?.canonical).toBe("5000");
  });

  it.each(["", "free", "-5", "99999999"])("leaves %j alone", (raw) => {
    expect(readTypedMoney(raw, "usd")).toBeNull();
  });
});

describe("the never-list", () => {
  it.each([
    "cardNumber",
    "capacity",
    "headCount",
    "tankPressure",
    "o2Percent",
    "maxDepth",
    "medicalAnswer3",
    "questionnaireQ1",
    "emergencyContactName",
  ])("refuses %s", (name) => {
    expect(isNeverForgivingFieldName(name)).toBe(true);
  });

  it.each(["phone", "fullName", "startTime", "priceDollars", "emergencyContactPhone"])(
    "allows %s",
    (name) => {
      expect(isNeverForgivingFieldName(name)).toBe(false);
    },
  );
});
