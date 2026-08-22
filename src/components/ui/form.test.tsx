// @vitest-environment jsdom
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
