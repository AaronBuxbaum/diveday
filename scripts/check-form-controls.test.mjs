import { describe, expect, it } from "vitest";

import { blankComments, placeholderOnlyControls, rawSubmits } from "./check-form-controls.mjs";

const lines = (...rows) => rows.join("\n");

describe("a control named only by its placeholder", () => {
  it("refuses an input with a placeholder and nothing else to name it", () => {
    const source = lines(
      "<div>",
      '  <input type="text" name="description-0" placeholder={t("x")} className={c} />',
      "</div>",
    );
    expect(placeholderOnlyControls(source)).toEqual([2]);
  });

  it("refuses the second control inside one wrapping <Field>, whose label names the first", () => {
    const source = lines(
      '<Field label={t("brand")}>',
      '  <input type="color" aria-label={t("picker")} />',
      '  <input name="brandColor" type="text" placeholder="#000" />',
      "</Field>",
    );
    expect(placeholderOnlyControls(source)).toEqual([3]);
  });

  it("refuses a textarea too, across lines", () => {
    const source = lines("<textarea", '  name="note"', '  placeholder={t("note")}', "/>");
    expect(placeholderOnlyControls(source)).toEqual([1]);
  });

  it("leaves alone a control with an aria-label, an aria-labelledby, an id, or spread props", () => {
    const source = lines(
      '<input aria-label={t("a")} placeholder="a" />',
      '<input aria-labelledby="h" placeholder="b" />',
      '<input id="c" placeholder="c" />',
      '<input {...props} placeholder="d" />',
      '<input type="hidden" name="e" placeholder="e" />',
    );
    expect(placeholderOnlyControls(source)).toEqual([]);
  });

  it("leaves alone the first control inside a <Field> or a <label>", () => {
    const source = lines(
      '<Field label={t("name")}>',
      '  <input name="name" placeholder={t("n")} />',
      "</Field>",
      "<label>",
      '  {t("q")} <input name="q" placeholder={t("q")} />',
      "</label>",
    );
    expect(placeholderOnlyControls(source)).toEqual([]);
  });

  it("is not opened by a <label> named in a comment", () => {
    const source = lines(
      "{/* the caption's <label> wraps nothing here */}",
      '<input name="x" placeholder="x" />',
    );
    expect(placeholderOnlyControls(source)).toEqual([2]);
  });

  it("leaves alone a placeholder-free control", () => {
    expect(placeholderOnlyControls('<input name="a" />')).toEqual([]);
  });
});

describe("a raw submit button in a form that posts to an action", () => {
  it("refuses one", () => {
    const source = lines(
      "<form action={dissolveAction}>",
      '  <button type="submit" className={b}>',
      '    {t("dissolve")}',
      "  </button>",
      "</form>",
    );
    expect(rawSubmits(source)).toEqual([2]);
  });

  it("refuses each answer of a form with several", () => {
    const source = lines(
      "<form action={formAction}>",
      '  <button type="submit" name="intent" value="returned">R</button>',
      '  <button type="submit" name="intent" value="discarded">D</button>',
      "</form>",
    );
    expect(rawSubmits(source)).toEqual([2, 3]);
  });

  it("leaves alone a GET form, in either attribute order", () => {
    const source = lines(
      '<form action={path} method="get">',
      '  <button type="submit">Show</button>',
      "</form>",
      '<form method="get" action={dayPath}>',
      '  <button type="submit">Review</button>',
      "</form>",
    );
    expect(rawSubmits(source)).toEqual([]);
  });

  it("leaves alone a button that owns its disabled state, a SubmitButton, and a plain button", () => {
    const source = lines(
      "<form action={save}>",
      '  <button type="submit" disabled={pending}>Save</button>',
      '  <SubmitButton pendingLabel="…">Save</SubmitButton>',
      '  <button type="button" onClick={open}>More</button>',
      "</form>",
    );
    expect(rawSubmits(source)).toEqual([]);
  });

  it("leaves alone a submit outside any form in the file, and one after its form closed", () => {
    const source = lines("<form action={save}></form>", '<button type="submit">Save</button>');
    expect(rawSubmits(source)).toEqual([]);
  });

  it("honours the opt-out on the line or within three lines above", () => {
    const source = lines(
      "<form action={record}>",
      "  {/* diveday:allow-raw-submit: the popup must open in the click */}",
      '  <button type="submit">Print</button>',
      "</form>",
    );
    expect(rawSubmits(source)).toEqual([]);
  });
});

describe("blanking comments", () => {
  it("keeps every newline so lines still number the same", () => {
    const source = "a\n/* b\n c */\n// d\ne";
    const blanked = blankComments(source);
    expect(blanked.split("\n")).toHaveLength(5);
    expect(blanked).not.toContain("b");
    expect(blanked).not.toContain("d");
    expect(blanked.split("\n")[4]).toBe("e");
  });
});
