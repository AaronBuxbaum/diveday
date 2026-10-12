// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PrivateNoteForm } from "./PrivateNoteForm";

afterEach(cleanup);

const copy = { label: "Private note", add: "Add note", adding: "Adding…" };

describe("PrivateNoteForm", () => {
  it("draws no required asterisk on its one field, but still refuses an empty note", () => {
    const { container } = render(<PrivateNoteForm action={() => {}} copy={copy} />);
    // UX review 2026-10-10, item 12: the `*` made a note look mandatory.
    expect(container.textContent).not.toContain("*");
    expect(screen.getByRole("textbox", { name: "Private note" })).toBeRequired();
  });
});
