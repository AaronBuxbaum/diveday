// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FormStatus } from "./form";

afterEach(cleanup);

describe("FormStatus", () => {
  it("sends a refusal to an error toast, with no line left in the form", () => {
    const { container } = render(<FormStatus tone="danger">That code is in use.</FormStatus>);
    expect(screen.getByRole("alert")).toHaveTextContent("That code is in use.");
    expect(container.querySelector("p")).toBeNull();
  });

  it("keeps a field's own hint (one wired by id) beside the field, mark out of the text", () => {
    render(
      <FormStatus id="f" tone="danger">
        Tick the box.
      </FormStatus>,
    );
    const status = screen.getByRole("alert");
    expect(status.id).toBe("f");
    expect(status).toHaveClass("items-start");
    expect(status.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    expect(status.textContent).toBe("Tick the box.");
  });
});
