// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageUploadTile } from "./ImageUploadTile";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const copy = {
  add: "Add a photo",
  adding: "Uploading photo…",
  wrongTypeSuffix: ": use a JPG, PNG, WebP, or HEIC photo.",
  tooBigSuffix: ": that’s over 10 MB, so try a smaller photo.",
};

// jsdom cannot hold a real picked file, so the `required` input would fail
// constraint validation; what is under test is that the pick asks to submit.
function renderInForm() {
  const submit = vi
    .spyOn(HTMLFormElement.prototype, "requestSubmit")
    .mockImplementation(() => undefined);
  render(
    <form>
      <ImageUploadTile name="crewPhoto" copy={copy} />
    </form>,
  );
  return { submit, input: screen.getByLabelText("Add a photo") as HTMLInputElement };
}

function pick(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

describe("ImageUploadTile", () => {
  it("submits its form the moment a good photo is picked", () => {
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    const { submit, input } = renderInForm();
    pick(input, new File(["x"], "reef.jpg", { type: "image/jpeg" }));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("refuses a file that is not a photo without submitting, and says why", () => {
    const { submit, input } = renderInForm();
    pick(input, new File(["x"], "notes.pdf", { type: "application/pdf" }));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "notes.pdf: use a JPG, PNG, WebP, or HEIC photo.",
    );
    expect(input).toHaveAttribute("aria-describedby");
  });
});
