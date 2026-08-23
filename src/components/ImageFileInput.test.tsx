// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ImageFileInput } from "./ImageFileInput";

afterEach(cleanup);

/**
 * **The control is the app's, not the operating system's** (issue #807).
 *
 * A bare `<input type="file">` paints the platform's grey "Choose Files / No
 * file chosen" — in the *device's* language, whatever the reader's is — so a
 * Spanish diver on `/recap/[token]` met one English control on an otherwise
 * Spanish page, on the most carefully designed surface in the product. What a
 * screenshot cannot check is underneath: that the visible button is the input's
 * own label, that it stays one control rather than two, and that the input is
 * still a real submittable `type="file"` carrying `required`.
 */
const COPY = {
  choose: "Add a photo",
  chooseAnother: "Add another photo",
  wrongTypeSuffix: ": use a JPG.",
  tooBigSuffix: ": too big.",
  tooMany: "Two at a time.",
};

const file = (name: string, type = "image/jpeg", size = 1000) => {
  const made = new File(["x"], name, { type });
  Object.defineProperty(made, "size", { value: size });
  return made;
};

const pick = (input: HTMLElement, files: File[]) => fireEvent.change(input, { target: { files } });

describe("ImageFileInput", () => {
  it("shows the app's own words on a control that is still a real file input", () => {
    render(<ImageFileInput name="photo" required copy={COPY} />);
    const input = screen.getByLabelText("Add a photo");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("name", "photo");
    expect(input).toBeRequired();
    // `sr-only`, never `hidden`: a display:none control carrying `required`
    // makes Chrome refuse the whole submit as "not focusable" rather than
    // reporting the field.
    expect(input).toHaveClass("sr-only");
    expect(input).not.toHaveAttribute("hidden");
  });

  it("names what was picked, and offers to swap it rather than repeating the ask", () => {
    render(<ImageFileInput name="photo" copy={COPY} />);
    pick(screen.getByLabelText("Add a photo"), [file("reef.jpg")]);

    expect(screen.getByText("reef.jpg")).toBeInTheDocument();
    expect(screen.getByLabelText("Add another photo")).toBeInTheDocument();
  });

  it("lists every file when several are picked at once", () => {
    render(<ImageFileInput name="photos" multiple maxFiles={3} copy={COPY} />);
    pick(screen.getByLabelText("Add a photo"), [file("one.jpg"), file("two.jpg")]);

    expect(screen.getByText("one.jpg, two.jpg")).toBeInTheDocument();
  });

  it("refuses a wrong-type file by name, keeps nothing, and asks again", () => {
    render(<ImageFileInput name="photo" copy={COPY} />);
    const input = screen.getByLabelText("Add a photo") as HTMLInputElement;
    pick(input, [file("notes.pdf", "application/pdf")]);

    expect(screen.getByRole("alert")).toHaveTextContent("notes.pdf: use a JPG.");
    expect(input.value).toBe("");
    // Still "Add a photo" — nothing was accepted, so nothing was swapped.
    expect(screen.getByLabelText("Add a photo")).toBe(input);
    expect(input.getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
  });

  it("forgets a refusal, and its filename, once a good file replaces it", () => {
    render(<ImageFileInput name="photo" copy={COPY} />);
    const input = screen.getByLabelText("Add a photo");
    pick(input, [file("huge.jpg", "image/jpeg", 99_000_000)]);
    expect(screen.getByRole("alert")).toHaveTextContent("huge.jpg: too big.");

    pick(input, [file("reef.jpg")]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/huge\.jpg/)).toBeNull();
  });

  it("clears the named file when the picker is dismissed with nothing chosen", () => {
    render(<ImageFileInput name="photo" copy={COPY} />);
    pick(screen.getByLabelText("Add a photo"), [file("reef.jpg")]);
    pick(screen.getByLabelText("Add another photo"), []);

    expect(screen.queryByText("reef.jpg")).toBeNull();
    expect(screen.getByLabelText("Add a photo")).toBeInTheDocument();
  });

  it("is one control, not a button beside a field", () => {
    const { container } = render(<ImageFileInput name="photo" copy={COPY} />);
    // The thing that looks like a button *is* the input's label, so there is
    // exactly one focusable control and one tap target.
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelectorAll("input")).toHaveLength(1);
    expect(container.querySelector("label")?.contains(container.querySelector("input"))).toBe(true);
  });
});
