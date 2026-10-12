import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  allValues,
  blankAsAbsent,
  checkbox,
  formFields,
  formValue,
  parseForm,
  readForm,
  single,
  text,
  trimmedText,
} from "./form-parse";

function form(entries: Array<[string, string]>): FormData {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
}

describe("formFields", () => {
  it("keeps a name sent once as its value, and one sent twice as every value in order", () => {
    expect(
      formFields(
        form([
          ["bookingId", "b-1"],
          ["day", "mon"],
          ["day", "thu"],
        ]),
      ),
    ).toEqual({ bookingId: "b-1", day: ["mon", "thu"] });
  });

  it("leaves a name the form never sent absent", () => {
    expect("note" in formFields(form([["bookingId", "b-1"]]))).toBe(false);
  });

  it("reads a field named __proto__ as an ordinary field, never as the object's prototype", () => {
    const fields = formFields(
      form([
        ["__proto__", "a"],
        ["__proto__", "b"],
        ["constructor", "c"],
      ]),
    );
    expect(Object.getPrototypeOf(fields)).toBeNull();
    expect(Object.keys(fields).sort()).toEqual(["__proto__", "constructor"]);
    expect(Object.getOwnPropertyDescriptor(fields, "__proto__")?.value).toEqual(["a", "b"]);
    expect(fields.constructor).toBe("c");
    // A schema reading such a form still reads its own fields, and nothing leaks.
    expect(
      parseForm(
        z.object({ name: text() }),
        form([
          ["__proto__", "x"],
          ["name", "Ana"],
        ]),
      ),
    ).toEqual({ ok: true, data: { name: "Ana" } });
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });
});

describe("parseForm", () => {
  const schema = z.object({
    scope: z.enum(["assignments", "shop_trips"]),
    rotating: z.literal("true").optional(),
  });

  it("hands back the schema's own reading of a good form", () => {
    expect(parseForm(schema, form([["scope", "assignments"]]))).toEqual({
      ok: true,
      data: { scope: "assignments" },
    });
  });

  it("names the refusing fields, once each, rather than throwing", () => {
    expect(
      parseForm(
        schema,
        form([
          ["scope", "everyone"],
          ["rotating", "yes"],
        ]),
      ),
    ).toMatchObject({ ok: false, fields: ["scope", "rotating"] });
  });

  it("refuses a required field the form left out", () => {
    expect(parseForm(schema, form([]))).toMatchObject({ ok: false, fields: ["scope"] });
  });

  it("hands back a schema's own messages in issue order, for one whose messages are codes", () => {
    const coded = z.object({
      name: z.string().min(2, "name_too_short"),
      slug: z.string().regex(/^[a-z]+$/, "slug_invalid"),
    });
    expect(
      parseForm(
        coded,
        form([
          ["name", "a"],
          ["slug", "NO"],
        ]),
      ),
    ).toEqual({
      ok: false,
      fields: ["name", "slug"],
      messages: ["name_too_short", "slug_invalid"],
    });
  });

  it("reads a repeated field as an array a schema can ask for", () => {
    const days = z.object({ day: z.array(z.string()) });
    expect(
      parseForm(
        days,
        form([
          ["day", "mon"],
          ["day", "thu"],
        ]),
      ),
    ).toEqual({ ok: true, data: { day: ["mon", "thu"] } });
  });
});

describe("blankAsAbsent and checkbox", () => {
  const schema = z.object({
    phone: blankAsAbsent(z.string().min(3)),
    nitrox: checkbox(),
  });

  it("reads a blank box and an absent field alike, and holds a filled one to the schema", () => {
    const blank = new FormData();
    blank.set("phone", "");
    expect(parseForm(schema, blank)).toEqual({
      ok: true,
      data: { phone: undefined, nitrox: false },
    });
    expect(parseForm(schema, new FormData())).toEqual({
      ok: true,
      data: { phone: undefined, nitrox: false },
    });
    const short = new FormData();
    short.set("phone", "12");
    expect(parseForm(schema, short)).toMatchObject({ ok: false, fields: ["phone"] });
  });

  it("reads a checkbox as on only when the browser sent its value", () => {
    const on = new FormData();
    on.set("nitrox", "on");
    expect(parseForm(schema, on)).toMatchObject({ ok: true, data: { nitrox: true } });
    const odd = new FormData();
    odd.set("nitrox", "yes");
    expect(parseForm(schema, odd)).toMatchObject({ ok: true, data: { nitrox: false } });
  });
});

describe("formValue", () => {
  it("reads a field the way FormData.get does: first value, or null", () => {
    const schema = z.object({ source: formValue(), missing: formValue() });
    const form = new FormData();
    form.append("source", "first");
    form.append("source", "second");
    expect(parseForm(schema, form)).toEqual({
      ok: true,
      data: { source: "first", missing: null },
    });
  });
});

describe("trimmedText", () => {
  it("reads a box as its first value trimmed, and an absent one as empty", () => {
    const schema = z.object({ name: trimmedText(), missing: trimmedText() });
    const form = new FormData();
    form.append("name", "  Ana  ");
    form.append("name", "Bea");
    expect(parseForm(schema, form)).toEqual({ ok: true, data: { name: "Ana", missing: "" } });
  });
});

describe("checkbox", () => {
  it("reads a repeated checkbox by its first value, as FormData.get did", () => {
    const form = new FormData();
    form.append("tick", "on");
    form.append("tick", "off");
    expect(parseForm(z.object({ tick: checkbox() }), form)).toEqual({
      ok: true,
      data: { tick: true },
    });
  });
});

describe("single", () => {
  it("holds a field's first value to the schema, and an absent one as undefined", () => {
    const schema = z.object({ id: single(z.string()), note: single(z.string().optional()) });
    const form = new FormData();
    form.append("id", "a");
    form.append("id", "b");
    expect(parseForm(schema, form)).toEqual({ ok: true, data: { id: "a", note: undefined } });
    expect(parseForm(schema, new FormData())).toMatchObject({ ok: false, fields: ["id"] });
  });
});

describe("text and readForm", () => {
  it("reads a field as its first value as a string, and an absent one as empty", () => {
    const form = new FormData();
    form.append("id", " a ");
    form.append("id", "b");
    expect(readForm(z.object({ id: text(), missing: text() }), form)).toEqual({
      id: " a ",
      missing: "",
    });
  });

  it("throws, naming the field, when a schema it was handed refuses after all", () => {
    expect(() => readForm(z.object({ id: z.string() }), new FormData())).toThrow(/id/);
  });
});

describe("single with a reading for an absent field", () => {
  it("hands the schema that reading, and holds it to the schema like any other", () => {
    const schema = z.object({ note: single(z.string(), ""), code: single(z.string().min(1), "") });
    expect(parseForm(schema, form([["code", "x"]]))).toEqual({
      ok: true,
      data: { note: "", code: "x" },
    });
    expect(parseForm(schema, new FormData())).toMatchObject({ ok: false, fields: ["code"] });
  });
});

describe("allValues", () => {
  it("reads every value of a repeated field in order, and none as empty", () => {
    const schema = z.object({ unit: allValues(), none: allValues() });
    expect(
      parseForm(
        schema,
        form([
          ["unit", "a"],
          ["unit", "b"],
        ]),
      ),
    ).toEqual({
      ok: true,
      data: { unit: ["a", "b"], none: [] },
    });
    expect(parseForm(schema, form([["unit", "a"]]))).toMatchObject({ data: { unit: ["a"] } });
  });
});
