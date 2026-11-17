import { describe, expect, it } from "vitest";
import { checkDrafts, isExcludedKey, mergeDrafts, missingMessages } from "./draft-locale.mjs";

describe("isExcludedKey", () => {
  it("keeps waiver and medical wording for a human", () => {
    expect(isExcludedKey("diver.json", "waiver.body.intro")).toBe(true);
    expect(isExcludedKey("diver.json", "ready.medicalQuestion")).toBe(true);
    expect(isExcludedKey("staff/waiversStaff.json", "list.heading")).toBe(true);
  });

  it("leaves ordinary copy to draft", () => {
    expect(isExcludedKey("staff/today.json", "todayQueue.emptyHeading")).toBe(false);
  });
});

describe("missingMessages", () => {
  const reference = { a: { title: "Trips", body: "{count} left" }, waiver: { body: "I release" } };

  it("asks only for what the locale lacks or left blank", () => {
    const other = { a: { title: "Salidas", body: " " } };
    expect(missingMessages("diver.json", reference, other)).toEqual({
      draftable: { "a.body": "{count} left" },
      excluded: ["waiver.body"],
    });
  });

  it("asks for nothing when the locale is complete", () => {
    const other = { a: { title: "Salidas", body: "quedan {count}" }, waiver: { body: "Libero" } };
    expect(missingMessages("diver.json", reference, other)).toEqual({
      draftable: {},
      excluded: [],
    });
  });
});

describe("mergeDrafts", () => {
  it("writes drafts in the English key order and never overwrites a translation", () => {
    const reference = { first: "One", group: { second: "Two", third: "Three" } };
    const other = { group: { third: "Tres" } };
    const merged = mergeDrafts(reference, other, {
      first: "Uno",
      "group.second": "Dos",
      "group.third": "X",
    });
    expect(JSON.stringify(merged)).toBe('{"first":"Uno","group":{"second":"Dos","third":"Tres"}}');
  });

  it("keeps a key only the locale has, for check:locale to report", () => {
    expect(mergeDrafts({ a: "A" }, { a: "A2", stray: "S" }, {})).toEqual({ a: "A2", stray: "S" });
  });

  it("leaves a key with no draft absent", () => {
    expect(mergeDrafts({ a: "A", b: "B" }, {}, { a: "Á" })).toEqual({ a: "Á" });
  });
});

describe("checkDrafts", () => {
  const asked = {
    "diver.json a": "Hi {name}",
    "diver.json b": "Read <link>this</link>",
    "diver.json c": "Go",
  };

  it("accepts a draft that keeps its placeholders and drops one that does not", () => {
    const result = checkDrafts(asked, [
      { id: "diver.json a", text: "Hola {name}" },
      { id: "diver.json b", text: "Lee esto" },
      { id: "diver.json z", text: "not asked" },
    ]);
    expect(result.accepted).toEqual({ "diver.json a": "Hola {name}" });
    expect(result.rejected).toEqual([
      { id: "diver.json b", missing: ["</link>", "<link>"], extra: [] },
    ]);
    expect(result.unanswered).toEqual(["diver.json c"]);
  });

  it("treats a blank answer as no answer", () => {
    expect(checkDrafts({ x: "Go" }, [{ id: "x", text: "  " }]).unanswered).toEqual(["x"]);
  });
});
