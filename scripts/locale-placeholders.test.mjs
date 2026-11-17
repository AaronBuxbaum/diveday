import { describe, expect, it } from "vitest";
import { placeholderParity, placeholders, richTextTags } from "./locale-placeholders.mjs";

describe("placeholders", () => {
  it("reads argument names, not the text inside plural branches", () => {
    expect(
      placeholders("{count, plural, one {queda # plaza} other {quedan # plazas}} en {trip}"),
    ).toEqual(["count", "trip"]);
  });

  it("reads an argument nested inside a branch body", () => {
    expect(placeholders("{count, plural, one {{name} solo} other {{name} y # más}}")).toEqual([
      "count",
      "name",
      "name",
    ]);
  });

  it("finds none in plain text", () => {
    expect(placeholders("Sin plazas")).toEqual([]);
  });
});

describe("richTextTags", () => {
  it("lists opening and closing tags", () => {
    expect(richTextTags("Lee <link>la guía</link>")).toEqual(["</link>", "<link>"]);
  });
});

describe("placeholderParity", () => {
  it("passes a draft that keeps every argument and tag, reordered", () => {
    expect(
      placeholderParity("{name} booked <b>{trip}</b>", "<b>{trip}</b>: reservó {name}").ok,
    ).toBe(true);
  });

  it("passes a plural whose branches read differently", () => {
    const english = "{count, plural, one {# diver} other {# divers}}";
    const spanish = "{count, plural, one {# buzo listo} other {# buzos listos}}";
    expect(placeholderParity(english, spanish).ok).toBe(true);
  });

  it("names an argument the draft dropped", () => {
    expect(placeholderParity("Hi {name}, see {trip}", "Hola, mira {trip}")).toEqual({
      ok: false,
      missing: ["name"],
      extra: [],
    });
  });

  it("names an argument the draft translated", () => {
    expect(placeholderParity("Hi {name}", "Hola {nombre}")).toEqual({
      ok: false,
      missing: ["name"],
      extra: ["nombre"],
    });
  });

  it("names a dropped rich-text tag", () => {
    expect(placeholderParity("Read <link>the guide</link>", "Lee la guía")).toEqual({
      ok: false,
      missing: ["</link>", "<link>"],
      extra: [],
    });
  });

  it("counts a repeated argument", () => {
    expect(placeholderParity("{name} and {name}", "{name}").missing).toEqual(["name"]);
  });
});
