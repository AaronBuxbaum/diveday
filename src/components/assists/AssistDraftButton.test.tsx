// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistDraftButton } from "./AssistDraftButton";

afterEach(cleanup);

const words = { label: "Draft", pendingLabel: "Drafting…" };

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("AssistDraftButton", () => {
  it("fills the field with the draft and hands it focus", async () => {
    render(
      <>
        <AssistDraftButton draft={async () => "Yes, two seats left."} fieldId="reply" {...words} />
        <textarea id="reply" defaultValue="" />
      </>,
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Draft" })));
    const field = document.getElementById("reply") as HTMLTextAreaElement;
    expect(field.value).toBe("Yes, two seats left.");
    expect(document.activeElement).toBe(field);
  });

  it("shows its pending words and refuses a second tap while the draft is coming", async () => {
    const answer = deferred<string | null>();
    const draft = vi.fn(() => answer.promise);
    render(<AssistDraftButton draft={draft} fieldId="reply" {...words} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Draft" })));
    const button = screen.getByRole("button", { name: "Drafting…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await act(async () => answer.resolve(null));
    expect(screen.getByRole("button", { name: "Draft" })).toBeEnabled();
    expect(draft).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the assist is dark, failed or empty", async () => {
    for (const draft of [
      async () => null,
      async () => "   ",
      async () => {
        throw new Error("network");
      },
    ]) {
      render(
        <>
          <AssistDraftButton draft={draft} fieldId="reply" {...words} />
          <textarea id="reply" defaultValue="What I typed" />
        </>,
      );
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Draft" })));
      expect((document.getElementById("reply") as HTMLTextAreaElement).value).toBe("What I typed");
      cleanup();
    }
  });

  it("says so beside the button when the answer came back empty, and clears it on a good draft", async () => {
    const answers: (string | null)[] = [null, "Yes, two seats left."];
    render(
      <>
        <AssistDraftButton
          draft={async () => answers.shift() ?? null}
          fieldId="reply"
          emptyLabel="Nothing came back to use."
          {...words}
        />
        <textarea id="reply" defaultValue="" />
      </>,
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Draft" })));
    expect(screen.getByText("Nothing came back to use.")).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Draft" })));
    expect(screen.queryByText("Nothing came back to use.")).toBeNull();
    expect((document.getElementById("reply") as HTMLTextAreaElement).value).toBe(
      "Yes, two seats left.",
    );
  });

  it("reaches a controlled field through React's own change path", async () => {
    function Controlled() {
      const [text, setText] = useState("");
      return (
        <>
          <AssistDraftButton draft={async () => "Drafted."} fieldId="note" {...words} />
          <input id="note" value={text} onChange={(event) => setText(event.target.value)} />
          <output>{text}</output>
        </>
      );
    }
    render(<Controlled />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Draft" })));
    expect(screen.getByRole("status")).toHaveTextContent("Drafted.");
  });

  it("hands the draft to a parent that holds the text itself", async () => {
    const onDraft = vi.fn();
    render(<AssistDraftButton draft={async () => "Drafted."} onDraft={onDraft} {...words} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Draft" })));
    expect(onDraft).toHaveBeenCalledWith("Drafted.");
  });

  it("leaves a read-only field alone", async () => {
    render(
      <>
        <AssistDraftButton draft={async () => "Drafted."} fieldId="locked" {...words} />
        <input id="locked" readOnly defaultValue="Signed" />
      </>,
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Draft" })));
    expect((document.getElementById("locked") as HTMLInputElement).value).toBe("Signed");
  });
});
