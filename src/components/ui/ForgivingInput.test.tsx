// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ForgivingInput } from "./ForgivingInput";

afterEach(cleanup);

const copy = { typedAs: "typed as “{raw}”" };

function hidden(name: string): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`);
  if (!el) throw new Error(`no hidden ${name}`);
  return el;
}

/**
 * ADR 20260906-before-you-ask, decision 3: the three tests a forgiving field
 * passes, as tests.
 */
describe("ForgivingInput", () => {
  it("shows the reading beneath the box while focused, with what was typed beside it", async () => {
    const user = userEvent.setup();
    render(
      <>
        <label htmlFor="leaves">Leaves</label>
        <ForgivingInput kind="time" id="leaves" name="startTime" locale="en-US" copy={copy} />
      </>,
    );
    const box = screen.getByLabelText("Leaves");
    await user.type(box, "7");
    expect(box).toHaveValue("7");
    expect(screen.getByText("7:00 AM")).toBeInTheDocument();
    expect(screen.getByText(/typed as “7”/)).toBeInTheDocument();
    // What the form submits is the canonical value, never the raw text.
    expect(hidden("startTime")).toHaveValue("07:00");
    // The reading is the box's description for assistive tech, not a floating line.
    const reading = screen.getByText(/typed as “7”/).closest("p");
    expect(reading?.id).toBeTruthy();
    expect(box).toHaveAttribute("aria-describedby", reading?.id);
  });

  it("settles the box to the reading on blur, and Escape brings the typed text back", async () => {
    const user = userEvent.setup();
    render(
      <>
        <label htmlFor="phone">Phone</label>
        <ForgivingInput
          kind="phone"
          id="phone"
          name="phone"
          locale="en-US"
          country="US"
          copy={copy}
        />
        <button type="button">elsewhere</button>
      </>,
    );
    const box = screen.getByLabelText("Phone");
    await user.type(box, "3055550142");
    await user.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(box).toHaveValue("+1 305 555 0142");
    expect(hidden("phone")).toHaveValue("+1 305 555 0142");
    expect(screen.queryByText(/typed as/)).toBeNull();

    box.focus();
    await user.keyboard("{Escape}");
    expect(box).toHaveValue("3055550142");
  });

  it("leaves text it cannot read exactly as typed, so the server refuses it on the field", async () => {
    const user = userEvent.setup();
    render(
      <>
        <label htmlFor="back">Back</label>
        <ForgivingInput kind="time" id="back" name="endTime" locale="en-US" copy={copy} />
        <button type="button">elsewhere</button>
      </>,
    );
    const box = screen.getByLabelText("Back");
    await user.type(box, "noonish");
    expect(screen.queryByText(/typed as/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(box).toHaveValue("noonish");
    expect(hidden("endTime")).toHaveValue("noonish");
  });

  it("opens with a value already on file settled to its label", () => {
    render(
      <ForgivingInput
        kind="money"
        name="price"
        locale="en-US"
        currency="usd"
        defaultValue="62.5"
        copy={copy}
      />,
    );
    expect(screen.getByRole("textbox")).toHaveValue("$62.50");
    expect(hidden("price")).toHaveValue("62.5");
  });
});
