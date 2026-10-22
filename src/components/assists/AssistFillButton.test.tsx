// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AssistFillButton } from "./AssistFillButton";

afterEach(cleanup);

const words = { label: "Draft", pendingLabel: "Drafting…", emptyLabel: "Nothing came back." };

describe("AssistFillButton", () => {
  it("fills the form's boxes with the answer", async () => {
    render(
      <form>
        <AssistFillButton draft={async () => ({ description: "A reef." })} {...words} />
        <textarea name="description" defaultValue="" />
      </form>,
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Draft" })));
    expect((document.querySelector("textarea") as HTMLTextAreaElement).value).toBe("A reef.");
    expect(screen.queryByText("Nothing came back.")).toBeNull();
  });

  it.each([
    ["null", async () => null],
    ["no fields", async () => ({})],
    [
      "a failed action",
      async () => {
        throw new Error("network");
      },
    ],
  ])("says so beside the button for %s, and leaves the boxes as typed", async (_name, draft) => {
    render(
      <form>
        <AssistFillButton draft={draft} {...words} />
        <textarea name="description" defaultValue="What I typed" />
      </form>,
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Draft" })));
    expect(screen.getByText("Nothing came back.")).toBeInTheDocument();
    expect((document.querySelector("textarea") as HTMLTextAreaElement).value).toBe("What I typed");
  });
});
