// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PostcardImage } from "@/lib/postcard-image";
import { SaveTicket } from "./SaveTicket";

vi.mock("@/lib/postcard-image", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/postcard-image")>();
  return { ...actual, drawPostcard: vi.fn() };
});
const { drawPostcard } = await import("@/lib/postcard-image");

const TICKET: PostcardImage = {
  shopName: "Blue Mantis Divers",
  heading: "Priya Sharma",
  diveDayLine: "Sun, Oct 11",
  facts: [{ label: "Departure", value: "Morning Two-Tank — Molasses Reef" }],
  privateLine: null,
  recordedBy: "Booked with Blue Mantis Divers",
};
const COPY = { save: "Save as image", saving: "Saving…", failed: "That didn’t save." };

let clicked: HTMLAnchorElement[];

beforeEach(() => {
  clicked = [];
  vi.mocked(drawPostcard).mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    scale: () => {},
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,QUJD");
  delete (navigator as Partial<Navigator>).share;
  delete (navigator as Partial<Navigator>).canShare;
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

// Issue #4386: the ticket leaves through the recap postcard's own export.
describe("SaveTicket", () => {
  it("draws the ticket with no borrowed drawing and hands the browser a PNG", async () => {
    render(<SaveTicket postcard={TICKET} fileName="dive-ticket.png" copy={COPY} />);
    fireEvent.click(screen.getByRole("button", { name: COPY.save }));
    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(vi.mocked(drawPostcard).mock.calls[0][1]).toEqual(TICKET);
    expect(vi.mocked(drawPostcard).mock.calls[0][3]).toBeNull();
    expect(clicked[0].getAttribute("download")).toBe("dive-ticket.png");
  });

  it("says so when the export fails", async () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    render(<SaveTicket postcard={TICKET} fileName="dive-ticket.png" copy={COPY} />);
    fireEvent.click(screen.getByRole("button", { name: COPY.save }));
    expect(await screen.findByText(COPY.failed)).toBeTruthy();
    expect(clicked).toHaveLength(0);
  });
});
