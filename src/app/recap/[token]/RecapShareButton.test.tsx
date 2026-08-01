// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecapShareButton } from "./RecapShareButton";

afterEach(() => {
  cleanup();
});

const copy = {
  shareTitle: "Two-Tank Reef",
  shareText: "Here's my dive recap from Blue Mantis — take a look.",
  label: "Share this recap",
  copiedLabel: "Link copied",
  copiedAnnouncement: "Recap link copied to clipboard.",
  failedLabel: "Couldn’t copy — copy it from the address bar instead",
};

describe("RecapShareButton (task 59)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the Web Share API when the browser supports it", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, share, clipboard: { writeText: vi.fn() } });

    render(<RecapShareButton {...copy} />);
    fireEvent.click(screen.getByRole("button", { name: "Share this recap" }));
    await vi.waitFor(() => expect(share).toHaveBeenCalled());
    expect(share.mock.calls[0][0]).toMatchObject({
      title: "Two-Tank Reef",
      text: copy.shareText,
    });
  });

  it("falls back to copying the link when the Web Share API is unavailable", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, share: undefined, clipboard: { writeText } });

    render(<RecapShareButton {...copy} />);
    fireEvent.click(screen.getByRole("button", { name: "Share this recap" }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: "Link copied" })).toBeInTheDocument();
  });
});
