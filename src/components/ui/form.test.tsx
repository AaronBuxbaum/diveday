// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { controlClass, Field, FieldActions, FieldGrid, FormStatus } from "./form";

afterEach(cleanup);

/**
 * The two halves of "a refusal belongs where the work is": `Field`'s `error`
 * puts it on the control, `FormStatus` puts it in the action row. Both are
 * wired for assistive tech, which is the part a screenshot cannot check.
 */
describe("Field error", () => {
  it("renders nothing and wires nothing when the field is fine", () => {
    render(
      <Field label="Name">
        <input name="name" className={controlClass} />
      </Field>,
    );
    const input = screen.getByLabelText("Name");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("announces the refusal and points the control at it", () => {
    render(
      <Field label="Name" error="Give the site a name.">
        <input name="name" className={controlClass} />
      </Field>,
    );
    const input = screen.getByLabelText("Name");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Give the site a name.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    // The message is *the* description of the control, not a sibling a screen
    // reader has to be told about separately.
    expect(input.getAttribute("aria-describedby")?.split(" ")).toContain(alert.id);
  });

  it("keeps the helper description alongside the refusal", () => {
    render(
      <Field label="Depth" description="Metres, to the nearest metre." error="Too deep.">
        <input name="depth" className={controlClass} />
      </Field>,
    );
    const input = screen.getByLabelText("Depth");
    const described = input.getAttribute("aria-describedby")?.split(" ") ?? [];
    expect(described).toHaveLength(2);
    expect(screen.getByText("Metres, to the nearest metre.").id).toBe(described[0]);
    expect(screen.getByRole("alert").id).toBe(described[1]);
  });

  it("never clears an aria-invalid the caller set itself", () => {
    render(
      <Field label="Email">
        <input name="email" aria-invalid="true" className={controlClass} />
      </Field>,
    );
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
  });

  it("merges with an aria-describedby the caller already set", () => {
    render(
      <Field label="Code" error="Already taken.">
        <input name="code" aria-describedby="house-rules" className={controlClass} />
      </Field>,
    );
    const described =
      screen.getByLabelText("Code").getAttribute("aria-describedby")?.split(" ") ?? [];
    expect(described[0]).toBe("house-rules");
    expect(described).toContain(screen.getByRole("alert").id);
  });

  it("still shows the refusal for a field wrapping something other than one control", () => {
    // The documented fallback: a `Field` whose children are a wrapper div fall
    // back to label-wraps-everything, and must not silently drop the message.
    render(
      <Field label="Price" error="Enter a price.">
        <div>
          <span>$</span>
          <input name="price" className={controlClass} />
        </div>
      </Field>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a price.");
  });
});

/**
 * A child that is not a native control has no id to clone onto, so `Field`
 * associates its caption by *wrapping* — except when the caller names the
 * control with `htmlFor`, where wrapping would put one `<label>` inside
 * another. `ImageFileInput` is that caller: its button *is* a label around the
 * file input, and nested labels are invalid HTML whose click forwarding has two
 * candidates to choose between (issue #807).
 */
describe("Field around a child that labels itself", () => {
  it("wraps a plain composite child, so the caption still names it", () => {
    const { container } = render(
      <Field label="Party">
        <div>
          <input name="party" className={controlClass} />
        </div>
      </Field>,
    );
    expect(container.querySelector("label")?.tagName).toBe("LABEL");
    expect(screen.getByLabelText("Party")).toHaveAttribute("name", "party");
  });

  it("stops wrapping once the caller names the control, leaving one label to nest inside", () => {
    const { container } = render(
      <Field label="Map image" htmlFor="map-image">
        <label>
          Choose a photo
          <input id="map-image" type="file" name="mapImage" className="sr-only" />
        </label>
      </Field>,
    );
    // No label with a label inside it: the caption is a sibling of the child.
    expect(container.querySelector("label label")).toBeNull();
    // And it still names the control — both labels do, caption first.
    expect(screen.getByLabelText(/Map image/)).toHaveAttribute("name", "mapImage");
  });
});

describe("FormStatus", () => {
  it("renders nothing at rest, so an action row keeps its layout", () => {
    const { container } = render(
      <FieldActions>
        <button type="submit">Save</button>
        <FormStatus tone="danger">{undefined}</FormStatus>
      </FieldActions>,
    );
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });

  /**
   * **Two empty children are still empty.**
   *
   * The guard was `if (!children)`, which held only while every caller passed
   * exactly one expression. `{undefined}` is falsy; `{undefined}{null}` is an
   * *array*, and an array is truthy — so the waiver editor, which appended a
   * conditional link beside its banner, rendered a bare ✅ with no message on a
   * page at rest, and no test noticed (issue #790).
   */
  it("still renders nothing when a caller passes several empty children", () => {
    const { container } = render(
      <FieldActions>
        <button type="submit">Save</button>
        <FormStatus tone="success">
          {undefined}
          {null}
          {false}
        </FormStatus>
      </FieldActions>,
    );
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });

  it("renders when one of several children has something to say", () => {
    render(
      <FormStatus tone="success">
        {undefined}
        {"Saved."}
      </FormStatus>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
  });

  it("gives a refusal role=alert so it interrupts", () => {
    render(<FormStatus tone="danger">That code is already in use.</FormStatus>);
    expect(screen.getByRole("alert")).toHaveTextContent("That code is already in use.");
  });

  it("gives a confirmation role=status so it does not", () => {
    render(<FormStatus tone="success">Saved.</FormStatus>);
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps its tone glyph out of the announced text", () => {
    render(<FormStatus tone="warning">Saved, and two divers no longer qualify.</FormStatus>);
    // `❌`/`⚠️` are the colourblind-safe cue, not words — a screen reader that
    // reads them aloud is reading punctuation at someone.
    const status = screen.getByRole("status");
    expect(status.querySelector("[aria-hidden='true']")?.textContent).toBe("⚠️");
  });

  it("sits inside the form it belongs to", () => {
    // The whole point: the message is a descendant of the `<form>`, not a
    // sibling of the page header. This is the assertion the e2e specs mirror.
    const { container } = render(
      <FieldGrid as="form" columns={2}>
        <Field label="Name">
          <input name="name" className={controlClass} />
        </Field>
        <FieldActions>
          <button type="submit">Save</button>
          <FormStatus tone="danger">Give the site a name.</FormStatus>
        </FieldActions>
      </FieldGrid>,
    );
    const form = container.querySelector("form");
    expect(form?.contains(screen.getByRole("alert"))).toBe(true);
  });
});

/**
 * `Field` derives the visible `*` from the control's own `required`, so a form
 * gets the marker for free and nobody has to remember it. `markRequired={false}`
 * is the one deliberate way out, for a form where every field is required and
 * the marker therefore distinguishes nothing.
 */
describe("Field's required marker", () => {
  it("marks a required control, since that is what tells it from an optional one", () => {
    render(
      <Field label="Subhead">
        <input name="subhead" required />
      </Field>,
    );
    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("leaves an optional control unmarked", () => {
    render(
      <Field label="Subhead">
        <input name="subhead" />
      </Field>,
    );
    expect(screen.queryByText("*")).not.toBeInTheDocument();
  });

  it("can be opted out of, for a form whose every field is required", () => {
    // The buddy panel's "Add to this team": one field, one submit button, and
    // two or three open teams put two or three red marks into a panel whose
    // only meaningful warning colour is the dissolve control.
    render(
      <Field label="Add to this team" markRequired={false}>
        <select name="member" required />
      </Field>,
    );
    expect(screen.queryByText("*")).not.toBeInTheDocument();
  });

  it("opting out never relaxes the control itself — the server refusal is real", () => {
    render(
      <Field label="Add to this team" markRequired={false}>
        <select name="member" required data-testid="member" />
      </Field>,
    );
    expect(screen.getByTestId("member")).toBeRequired();
  });
});

/**
 * **`hint` is a short qualifier, and the type cannot say so.**
 *
 * It takes a `ReactNode` and renders whatever it is given, so a sentence and
 * "(optional)" are the same thing to the compiler — and the two props read as
 * interchangeable from a call site. `/onboard` passed a **31-word** sentence as
 * `hint`, which pushed the caption row to five lines, left a ~100px hole beside
 * it in the two-column grid, floated the required `*` at the end of a
 * paragraph, and — because `hint` renders *inside* the `<label>* — folded all
 * thirty-one words into the control's accessible name, so a screen reader read
 * them out every time the field was announced (issue #784).
 *
 * Nothing failed. The layout hole only appears at one breakpoint with that
 * particular string length, and `/onboard` had no capture.
 *
 * So the ceiling is stated here instead. The bound is deliberately generous —
 * it is not a style rule about brevity, it is the line past which `hint` is
 * the wrong prop and `description` is the right one, which is a question of
 * *where the text renders*, not of taste.
 */
const HINT_WORD_CEILING = 15;

/** Every `hint={t("…")}` in the app, with the words it resolves to. */
function hintsWithText(): { file: string; key: string; words: number; text: string }[] {
  const messages = new Map<string, string>();
  const flatten = (node: unknown, path: string) => {
    if (typeof node === "string") messages.set(path, node);
    else if (node && typeof node === "object")
      for (const [key, value] of Object.entries(node))
        flatten(value, path ? `${path}.${key}` : key);
  };
  // Both vocabularies, keyed the way a translator call spells them. `diver.json`
  // is namespaced by its own top-level keys; a staff bundle is one file per
  // area and the **filename** is the namespace (`staff/boats.json` →
  // `boats.…`), which is the composition `staff/index.ts` performs.
  const localeRoot = path.join(process.cwd(), "src/i18n/locales/en-US");
  flatten(JSON.parse(readFileSync(path.join(localeRoot, "diver.json"), "utf8")), "");
  const staffRoot = path.join(localeRoot, "staff");
  for (const entry of readdirSync(staffRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    flatten(
      JSON.parse(readFileSync(path.join(staffRoot, entry.name), "utf8")),
      entry.name.replace(/\.json$/, ""),
    );
  }

  const found: { file: string; key: string; words: number; text: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")) {
        const source = readFileSync(full, "utf8");
        for (const match of source.matchAll(/\bhint=\{t\(\s*"([^"]+)"/g)) {
          const key = match[1];
          if (!key) continue;
          const text = messages.get(key);
          // A key this scan cannot resolve is not a finding: staff bundles are
          // composed under their own namespace and a few hints are computed.
          if (!text) continue;
          found.push({
            file: path.relative(process.cwd(), full),
            key,
            words: text.trim().split(/\s+/).length,
            text,
          });
        }
      }
    }
  };
  for (const root of ["src/app", "src/components"]) walk(path.join(process.cwd(), root));
  return found;
}

describe("Field's hint stays a qualifier", () => {
  it("finds enough hints to be worth asserting on", () => {
    // A scan that silently resolves nothing would pass forever.
    expect(hintsWithText().length).toBeGreaterThan(20);
  });

  it("refuses a hint long enough to belong in `description`", () => {
    const overlong = hintsWithText()
      .filter((hint) => hint.words > HINT_WORD_CEILING)
      // Named, not counted: the fix is per call site and needs the key.
      .map(
        (hint) => `${hint.file} — ${hint.key} (${hint.words} words): ${hint.text.slice(0, 60)}…`,
      );
    expect(overlong).toEqual([]);
  });
});

/**
 * Issue #1022. Under `cacheComponents`, a client-side navigation resumes a
 * prerendered shell beside streamed dynamic content — two render passes, each
 * starting React's server `useId` counter at 1 — so two `Field`s can be handed
 * the same generated id and `<label for>` then names the wrong control. Folding
 * the control's own `name` into the id separates every pair those two counters
 * can produce.
 *
 * jsdom renders one pass, so it cannot stage the collision itself; what it can
 * pin is the property the fix rests on — that the id carries the name, and that
 * the whole `label`/`aria-describedby` triple still points at the control.
 */
describe("Field id scoping", () => {
  it("folds the control's name into the generated id", () => {
    render(
      <Field label="Maximum depth" description="Metres.">
        <input name="maxDepthMeters" className={controlClass} />
      </Field>,
    );
    const input = screen.getByLabelText("Maximum depth");
    expect(input.id).toMatch(/-maxDepthMeters$/);
    // The description travels with it, so nothing is left pointing at the
    // unscoped id.
    expect(input.getAttribute("aria-describedby")).toBe(`${input.id}-description`);
  });

  it("gives two same-named controls ids that differ anyway", () => {
    render(
      <>
        <Field label="First note">
          <input name="note" className={controlClass} />
        </Field>
        <Field label="Second note">
          <input name="note" className={controlClass} />
        </Field>
      </>,
    );
    expect(screen.getByLabelText("First note").id).not.toBe(
      screen.getByLabelText("Second note").id,
    );
  });

  // A name may legally hold characters an id may not.
  it("does not put whitespace or brackets from a name into an id", () => {
    render(
      <Field label="Diver note">
        <input name="party[0].note text" className={controlClass} />
      </Field>,
    );
    const input = screen.getByLabelText("Diver note");
    expect(input.id).toMatch(/^[A-Za-z0-9_\-«»:]+$/);
    expect(input.id).toContain("party_0__note_text");
  });

  it("leaves a caller-supplied id alone", () => {
    render(
      <Field label="Name" htmlFor="chosen-by-the-caller">
        <input id="chosen-by-the-caller" name="name" className={controlClass} />
      </Field>,
    );
    expect(screen.getByLabelText("Name").id).toBe("chosen-by-the-caller");
  });
});
