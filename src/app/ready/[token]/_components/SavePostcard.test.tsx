// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PostcardImage } from "@/lib/postcard-image";
import { SavePostcard } from "./SavePostcard";

vi.mock("@/lib/postcard-image", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/postcard-image")>();
  return { ...actual, drawPostcard: vi.fn() };
});
const { drawPostcard } = await import("@/lib/postcard-image");

/**
 * **D33's promise, enforced rather than described** (issue #1193), and the
 * export it rides on (issue #1081).
 *
 * The row says the line "stays on your phone". The only thing that makes that
 * true is that there is no path off it, so the three assertions in the first
 * block are the feature: no `name`, no enclosing `<form>`, and no form or
 * action rendered by the component at all. A later change that gave the
 * textarea a `name` would keep every other test in this file green.
 */

const POSTCARD: PostcardImage = {
  shopName: "Blue Mantis Divers",
  heading: "Dive log entry",
  diveDayLine: "Dive day № 3",
  facts: [{ label: "Diver", value: "Yara Halabi" }],
  privateLine: null,
  recordedBy: "Recorded by Blue Mantis Divers",
};

const COPY = {
  lineLabel: "A line for yourself",
  lineHint: "It goes on the picture and stays on your phone.",
  linePlaceholder: "The eagle ray on the second tank",
  save: "Save as image",
  saving: "Saving…",
  failed: "That didn’t save. Try again in a moment.",
};

let clicked: HTMLAnchorElement[];

beforeEach(() => {
  clicked = [];
  vi.mocked(drawPostcard).mockClear();
  // jsdom has no canvas and no font loading; both are stubbed so the save path
  // runs end to end and the assertions are about what it *did*, not what it drew.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    scale: () => {},
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,QUJD");
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push(this);
  });
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const line = () => screen.getByLabelText(COPY.lineLabel) as HTMLTextAreaElement;

describe("the private line", () => {
  it("carries no name, so it cannot enter any FormData", () => {
    render(
      <SavePostcard
        postcard={POSTCARD}
        fileName="dive-day.png"
        copy={COPY}
        recordedBy={<p>Recorded by Blue Mantis Divers</p>}
      >
        <button type="button">Print log entry</button>
      </SavePostcard>,
    );
    expect(line().getAttribute("name")).toBeNull();
    expect(new FormData(document.createElement("form")).has("privateLine")).toBe(false);
  });

  it("sits inside no form, and the component renders none", () => {
    const { container } = render(
      <SavePostcard
        postcard={POSTCARD}
        fileName="dive-day.png"
        copy={COPY}
        recordedBy={<p>Recorded by Blue Mantis Divers</p>}
      >
        <button type="button">Print log entry</button>
      </SavePostcard>,
    );
    expect(line().closest("form")).toBeNull();
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("[formaction]")).toBeNull();
    // Nothing that submits, either — the only control here is a plain button.
    expect(container.querySelector('button[type="submit"], input[type="submit"]')).toBeNull();
  });

  it("says nothing about the link the page was reached by", () => {
    const { container } = render(
      <SavePostcard
        postcard={POSTCARD}
        fileName="dive-day.png"
        copy={COPY}
        recordedBy={<p>Recorded by Blue Mantis Divers</p>}
      >
        <button type="button">Print log entry</button>
      </SavePostcard>,
    );
    expect(container.innerHTML).not.toMatch(/\/recap\/|\/ready\/|token/i);
  });
});

describe("saving the picture", () => {
  it("draws the typed line into the card and hands the browser a PNG", async () => {
    render(
      <SavePostcard
        postcard={POSTCARD}
        fileName="blue-mantis-dive-day.png"
        copy={COPY}
        recordedBy={<p>Recorded by Blue Mantis Divers</p>}
      >
        <button type="button">Print log entry</button>
      </SavePostcard>,
    );
    fireEvent.change(line(), { target: { value: "  The eagle ray on the second tank  " } });
    fireEvent.click(screen.getByRole("button", { name: COPY.save }));

    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(drawPostcard).toHaveBeenCalledTimes(1);
    // The typed line reaches `drawPostcard` — trimmed — and nothing else.
    expect(vi.mocked(drawPostcard).mock.calls[0][1]).toEqual({
      ...POSTCARD,
      privateLine: "The eagle ray on the second tank",
    });
    const anchor = clicked[0];
    expect(anchor.getAttribute("download")).toBe("blue-mantis-dive-day.png");
    expect(anchor.getAttribute("href")).toMatch(/^data:image\/png/);
    // The anchor is transient: nothing is left in the document to be clicked twice.
    expect(document.body.querySelector("a[download]")).toBeNull();
  });

  it("leaves the card's line null when the diver typed nothing", async () => {
    render(
      <SavePostcard
        postcard={POSTCARD}
        fileName="dive-day.png"
        copy={COPY}
        recordedBy={<p>Recorded by Blue Mantis Divers</p>}
      >
        <button type="button">Print log entry</button>
      </SavePostcard>,
    );
    fireEvent.click(screen.getByRole("button", { name: COPY.save }));
    await waitFor(() => expect(drawPostcard).toHaveBeenCalledTimes(1));
    expect(vi.mocked(drawPostcard).mock.calls[0][1].privateLine).toBeNull();
  });

  it("says so when the export fails instead of pretending it saved", async () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    render(
      <SavePostcard
        postcard={POSTCARD}
        fileName="dive-day.png"
        copy={COPY}
        recordedBy={<p>Recorded by Blue Mantis Divers</p>}
      >
        <button type="button">Print log entry</button>
      </SavePostcard>,
    );
    fireEvent.click(screen.getByRole("button", { name: COPY.save }));

    expect(await screen.findByRole("alert")).toHaveTextContent(COPY.failed);
    expect(clicked).toHaveLength(0);
  });
});
