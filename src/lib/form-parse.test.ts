import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formFields, parseForm } from "./form-parse";

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
