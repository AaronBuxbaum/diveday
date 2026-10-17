// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { FieldErrorFocus } from "@/components/ui/FieldErrorFocus";
import { EditorSection, sectionPreview } from "./EditorSection";

afterEach(cleanup);

/** A class list's tokens that draw a box edge or pad one: `border-t`, `pt-6`. */
function shellTokens(element: Element | null): string[] {
  return [...(element?.classList ?? [])].filter((token) => /^(border|p[tbxy]?-)/.test(token));
}

/**
 * **One heading geometry for both kinds of section** (docs/design/
 * pixel-craft.md, class 12). A `<fieldset>` draws its `<legend>` *in* its own
 * top border, so the hairline and `pt-6` on the fieldset itself put the label
 * on the rule and the 24px between the label and the fields: 27–28px from the
 * previous section to the label and 40px from the label to its fields, where a
 * `<section>`'s label sits 29px under its rule. The rule belongs above the label
 * in both.
 */
describe("EditorSection", () => {
  it("draws a fieldset section's rule and air above its label, on the legend, not the fieldset", () => {
    render(
      <EditorSection id="block-route" label="The route you swim" as="fieldset">
        <input aria-label="Entry" />
      </EditorSection>,
    );
    const fieldset = screen.getByRole("group", { name: "The route you swim" });
    const legend = fieldset.firstElementChild;

    expect(legend?.tagName).toBe("LEGEND");
    // The full measure, so the hairline spans the column as a section's does.
    // `lg:pt-6`: below `lg` the header is a 48px button carrying its own air.
    expect(legend).toHaveClass("w-full", "border-t", "border-border", "lg:pt-6");
    expect(shellTokens(fieldset)).toEqual([]);
  });

  it("opens the form's first fieldset with no rule above its label", () => {
    render(
      <EditorSection id="block-pitch" label="The pitch" as="fieldset" lead>
        <input aria-label="Subhead" />
      </EditorSection>,
    );
    const legend = screen.getByRole("group", { name: "The pitch" }).firstElementChild;
    expect(shellTokens(legend)).toEqual([]);
  });

  it("anchors the rail and the unsaved note on the named group itself", () => {
    // The rail links to the id and the unsaved note traces a typed control back
    // through the marker, so both sit on the section's outermost element, and
    // for a fieldset that is the group a screen reader names.
    const { container } = render(
      <EditorSection id="block-route" label="The route you swim" as="fieldset">
        <input aria-label="Entry" />
      </EditorSection>,
    );
    const group = screen.getByRole("group", { name: "The route you swim" });
    expect(container.firstElementChild).toBe(group);
    expect(group).toHaveAttribute("id", "block-route");
    expect(group).toHaveAttribute("data-editor-section", "block-route");
    expect(group).toHaveClass("scroll-mt-6");
  });

  /**
   * The course editor's refused day-by-day save redirects with
   * `?field=scheduleDaysJson`, the section's id, and `FieldErrorFocus` focuses
   * whatever carries it. On an unnamed box around the fieldset, focus landed on
   * a generic element with no role or name; it lands on the group, so a screen
   * reader hears which section it has to fix.
   */
  it("lands a refused save's focus on the named group", () => {
    render(
      <>
        <EditorSection id="scheduleDaysJson" label="Day by day" as="fieldset">
          <input type="hidden" name="scheduleDaysJson" value="[]" />
        </EditorSection>
        <FieldErrorFocus field="scheduleDaysJson" />
      </>,
    );
    expect(document.activeElement).toBe(screen.getByRole("group", { name: "Day by day" }));
  });

  it("draws a section's rule on the section itself, the geometry the fieldset now matches", () => {
    const { container } = render(
      <EditorSection id="block-dive" label="The dive">
        <input aria-label="Depth" />
      </EditorSection>,
    );
    const shell = container.firstElementChild;
    expect(shell?.tagName).toBe("SECTION");
    expect(shell).toHaveClass("border-t", "border-border", "lg:pt-6");
  });
});

/**
 * **A long editor folds on a phone** (UX review 2026-10-10, item 15): 7,440px
 * and 8,098px of form under a rail of pills four rows deep. Below `lg` each
 * section is a header naming it, with a line saying what is in it, and one
 * section stands open at a time, the first by default. What was typed in a
 * folded section is still there and still posts: the body is hidden by a
 * class, never unmounted.
 */
describe("an editor section on a phone", () => {
  function Form() {
    return (
      <form>
        <EditorSection id="pitch" label="The pitch" lead>
          <input aria-label="Subhead" name="subhead" defaultValue="Learn to dive" />
        </EditorSection>
        <EditorSection id="pricing" label="Pricing" as="fieldset">
          <input aria-label="Price" name="price" type="number" defaultValue="450" />
          <select aria-label="Currency" name="currency" defaultValue="usd">
            <option value="">Pick one</option>
            <option value="usd">US dollars</option>
          </select>
          <input aria-label="Secret" type="hidden" name="secret" value="x" />
        </EditorSection>
        <EditorSection id="faq" label="Questions">
          <input aria-label="Question" name="q" required />
        </EditorSection>
      </form>
    );
  }
  const header = (name: RegExp) => screen.getByRole("button", { name });
  const body = (id: string) => document.getElementById(`${id}-body`);

  it("opens the first section and folds the rest, keeping their fields in the form", () => {
    render(<Form />);
    expect(header(/The pitch/)).toHaveAttribute("aria-expanded", "true");
    expect(header(/Pricing/)).toHaveAttribute("aria-expanded", "false");
    expect(header(/Pricing/)).toHaveAttribute("aria-controls", "pricing-body");
    expect(body("pitch")).not.toHaveClass("max-lg:hidden");
    expect(body("pricing")).toHaveClass("max-lg:hidden");
    // Folded, not gone: the value is in the DOM and posts with Save.
    const form = document.querySelector("form") as HTMLFormElement;
    expect(new FormData(form).get("price")).toBe("450");
  });

  it("is a header only below lg, the plain label above it, and named by the label alone", () => {
    render(<Form />);
    expect(header(/Pricing/)).toHaveClass("lg:hidden");
    expect(document.getElementById("pricing-label")).toHaveClass("max-lg:hidden");
    expect(screen.getByRole("group", { name: "Pricing" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "The pitch" })).toBeInTheDocument();
  });

  it("says what a folded section holds, in its own words, and nothing for a hidden payload", () => {
    render(<Form />);
    expect(header(/Pricing/)).toHaveTextContent("450 · US dollars");
    expect(header(/Pricing/)).not.toHaveTextContent("x");
    // An open section shows its fields instead.
    expect(header(/The pitch/).querySelector("[data-section-preview]")).toHaveTextContent("");
  });

  /**
   * The preview line is read off the fields once the section's wiring runs,
   * which is after hydration: the server's markup carries an empty line. The
   * visual suite shot `course-edit` with blank previews on one run and filled
   * ones on the next (#2509), so a filled line says so, and the capture waits
   * for every line to say it.
   */
  it("marks every preview line ready once it has been read, and none in the server's markup", () => {
    const markup = renderToString(<Form />);
    expect(markup).toContain("data-section-preview");
    expect(markup).not.toContain("data-preview-ready");
    render(<Form />);
    const lines = document.querySelectorAll("[data-section-preview]");
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line).toHaveAttribute("data-preview-ready");
  });

  it("opens one section at a time", () => {
    render(<Form />);
    fireEvent.click(header(/Pricing/));
    expect(header(/Pricing/)).toHaveAttribute("aria-expanded", "true");
    expect(header(/The pitch/)).toHaveAttribute("aria-expanded", "false");
    expect(body("pitch")).toHaveClass("max-lg:hidden");
    fireEvent.click(header(/Pricing/));
    expect(header(/Pricing/)).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the section a link jumps to", () => {
    render(
      <>
        <a href="#faq">Questions</a>
        <Form />
      </>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Questions" }));
    expect(header(/Questions/)).toHaveAttribute("aria-expanded", "true");
    expect(header(/The pitch/)).toHaveAttribute("aria-expanded", "false");
  });

  it("survives a malformed fragment in the address and in a link, and still opens nothing", () => {
    // `decodeURIComponent("%E0%A4%A")` throws URIError; thrown inside the
    // layout effect it took every section's wiring down with it.
    window.history.replaceState(null, "", "#%E0%A4%A");
    try {
      render(
        <>
          <a href="#%E0%A4%A">Broken</a>
          <Form />
        </>,
      );
      expect(() => fireEvent.click(screen.getByRole("link", { name: "Broken" }))).not.toThrow();
      expect(header(/The pitch/)).toHaveAttribute("aria-expanded", "true");
      // The wiring is still up: a well-formed jump still opens its section.
      fireEvent.click(header(/Questions/));
      expect(header(/Questions/)).toHaveAttribute("aria-expanded", "true");
    } finally {
      window.history.replaceState(null, "", window.location.pathname);
    }
  });

  it("names a folded section's ticked boxes by their labels, and says nothing for an unticked one", () => {
    render(
      <form>
        <EditorSection id="lead" label="Lead" lead>
          <input aria-label="Name" name="name" />
        </EditorSection>
        <EditorSection id="certs" label="Certification" as="fieldset">
          <label>
            <input type="checkbox" name="nitrox" defaultChecked /> Nitrox
          </label>
          <label>
            <input type="checkbox" name="deep" /> Deep
          </label>
          <label>
            <input type="checkbox" name="wreck" defaultChecked /> Wreck
          </label>
        </EditorSection>
      </form>,
    );
    expect(header(/Certification/).querySelector("[data-section-preview]")).toHaveTextContent(
      /^Nitrox · Wreck$/,
    );
  });

  it("opens a folded section the browser refuses a required field in", () => {
    render(<Form />);
    act(() => {
      (document.querySelector("form") as HTMLFormElement).checkValidity();
    });
    expect(body("faq")).not.toHaveClass("max-lg:hidden");
    expect(header(/Questions/)).toHaveAttribute("aria-expanded", "true");
  });

  it("opens the section holding a refused save's field before the focus lands", () => {
    render(
      <>
        <Form />
        <FieldErrorFocus field="faq" />
      </>,
    );
    expect(body("faq")).not.toHaveClass("max-lg:hidden");
    expect(document.activeElement).toBe(document.getElementById("faq"));
  });

  /**
   * **A folded header says it holds edits** (#2438). The sentence beside Save
   * names the section, but a staffer scanning folded headers could not see
   * where their edits were. The tag is in the header button, so its name
   * carries it to a screen reader; saving clears it.
   */
  it("tags a section with unsaved edits in its header until the form is saved", () => {
    render(
      <form onSubmit={(event) => event.preventDefault()}>
        <EditorSection id="pitch" label="The pitch" lead unsavedTag="Unsaved">
          <input aria-label="Subhead" name="subhead" />
        </EditorSection>
        <EditorSection id="pricing" label="Pricing" unsavedTag="Unsaved">
          <input aria-label="Price" name="price" />
        </EditorSection>
      </form>,
    );
    expect(header(/Pricing/)).not.toHaveTextContent("Unsaved");
    fireEvent.input(screen.getByLabelText("Price"), { target: { value: "500" } });
    expect(header(/Pricing/)).toHaveAccessibleName(/Pricing\s*Unsaved/);
    expect(header(/The pitch/)).not.toHaveTextContent("Unsaved");
    // Still a 48px target with the tag in it.
    expect(header(/Pricing/)).toHaveClass("min-h-12");
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    expect(header(/Pricing/)).not.toHaveTextContent("Unsaved");
  });
});

describe("sectionPreview with a paired depth", () => {
  const body = (shallow: string, deep: string) => {
    const el = document.createElement("div");
    el.innerHTML = `<input value="Beginner" />
      <input type="number" value="${shallow}" data-preview-pair="depth" data-preview-one="{value} ft" data-preview-range="{min}–{max} ft" />
      <input type="number" value="${deep}" data-preview-pair="depth" data-preview-one="{value} ft" data-preview-range="{min}–{max} ft" />`;
    return el;
  };

  it("names a range with its unit when both ends are set", () => {
    expect(sectionPreview(body("20", "130"))).toBe("Beginner · 20–130 ft");
  });
  it("names the maximum alone when only it is set", () => {
    expect(sectionPreview(body("", "130"))).toBe("Beginner · 130 ft");
  });
  it("says nothing of depth when neither is set", () => {
    expect(sectionPreview(body("", ""))).toBe("Beginner");
  });
});
